const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const { Kafka } = require("kafkajs");

require("dotenv").config({
    path: path.join(__dirname, ".env"),
});

const s3Client = new S3Client({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;

const kafka = new Kafka({
    clientId: `build-server-${DEPLOYMENT_ID}`,
    brokers: [process.env.KAFKA_BROKER],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, "kafka.pem"), "utf-8")],
    },
    sasl: {
        mechanism: "plain",
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
    },
});

const producer = kafka.producer();

async function publishMessage(log, status = "info") {
    try {
        await producer.send({
            topic: `container-logs`,
            messages: [
                {
                    key: "log",
                    value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log, status }),
                },
            ],
        });
    } catch (error) {
        console.error("Failed to publish message:", error);
    }
}

async function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function executeBuild(outDirPath) {
    return new Promise((resolve, reject) => {
        const buildProcess = exec(
            `cd ${outDirPath} && npm install && npm run build`
        );

        buildProcess.stdout.on("data", (data) => {
            const message = data.toString().trim();
            console.log(message);
            // Using void to handle the promise without awaiting
            void publishMessage(`Build output: ${message}`,'info');
        });

        buildProcess.stderr.on("data", (data) => {
            const error = data.toString().trim();
            console.error("Error:", error);
            void publishMessage(`Build error: ${error}`, 'failed');
        });

        buildProcess.on("error", (error) => {
            console.error("Process error:", error);
            void publishMessage(`Process error: ${error.message}`, 'failed');
            reject(error);
        });

        buildProcess.on("close", (code) => {
            if (code !== 0) {
                const error = new Error(`Build process exited with code ${code}`, 'failed');
                console.error(error.message);
                void publishMessage(`Build failed with exit code ${code}`, 'failed');
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function uploadDistFolder(distFolderPath) {
    if (!fs.existsSync(distFolderPath)) {
        throw new Error("Dist folder not found after build");
    }

    const distFolderContents = fs.readdirSync(distFolderPath, {
        recursive: true,
    });

    console.log("Starting to upload");
    await publishMessage("Beginning process");

    for (const file of distFolderContents) {
        const filePath = path.join(distFolderPath, file);
        if (fs.lstatSync(filePath).isDirectory()) {
            continue;
        }

        console.log("uploading", filePath);

        const s3Key = `__outputs/${PROJECT_ID}/${file}`;
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3Key,
            Body: fs.createReadStream(filePath),
            ContentType: mime.lookup(filePath),
        });

        await s3Client.send(command);
        console.log("uploaded", filePath);
    }
}

async function init() {
    try {
        await producer.connect();
        await publishMessage("Build process initiated" , 'started');
        
        console.log("Executing script.js");
        console.log("Build Started...");

        const outDirPath = path.join(__dirname, "output");
        await ensureDirectoryExists(outDirPath);
        await publishMessage("Starting npm install and build" , 'running');
        
        await executeBuild(outDirPath);
        await publishMessage("Build completed successfully", 'success');
        console.log("Build Complete");

        const distFolderPath = path.join(__dirname, "output", "dist");
        await uploadDistFolder(distFolderPath);

        console.log("Done...");
        await publishMessage("Website is Live 🥳🎉🎊", 'completed');
        await producer.disconnect();
        process.exit(0);
    } catch (error) {
        console.error("Script error:", error);
        await publishMessage(`Fatal script error: ${error.message}`, 'failed');
        await producer.disconnect();
        process.exit(1);
    }
}

init().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});