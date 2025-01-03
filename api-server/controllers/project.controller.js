import { z } from "zod";
import { generateSlug } from "random-word-slugs";
import { Project } from "../models/project.model.js";

export const createProject = async (req, res) => {
    const projectSchema = z.object({
        name: z.string(),
        gitURL: z.string().url().regex(/^https?:\/\/github\.com\/[\w-]+\/[\w-]+$/),
        slug: z.string().optional(),
    });

    const safeParse = projectSchema.safeParse(req.body);

    if (!safeParse.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: safeParse.error.errors,
        });
    }

    const { name, gitURL, slug } = safeParse.data;

    try {
        const existingProject = await Project.findOne({ owner: req.user._id, gitURL });
        
        if (existingProject) {
            return res.status(201).json({
                status: "success",
                data: existingProject,
            });
        }

        const subdomain = slug || generateSlug();
        const project = new Project({
            name,
            gitURL,
            subdomain,
            owner: req.user._id,
        });
        
        await project.save();

        return res.status(201).json({
            status: "success",
            data: project,
        });
    } catch (error) {
        console.error("Failed to create project:", error);
        return res.status(500).json({
            error: "Failed to create project",
            message: error.message,
        });
    }
};

export const getUserAllProjects = async (req, res) => {

    const userId = req.user._id;

    try {
        const projects = await Project.find({ owner: userId }).sort({ createdAt: -1 });

        return res.status(200).json({
            status: "success",
            data: projects,
        });
        
    } catch (error) {
        console.error("Failed to get user projects:", error);
        return res.status(500).json({
            error: "Failed to get user projects",
            message: error.message
        });
        
    }
}

export const getProjectById = async (req, res) => {
    const userId = req.user._id;
    const projectId = req.params.projectId;
    try {
        const project = await Project.findOne({ _id: projectId, owner: userId });

        if (!project) {
            return res.status(404).json({
                error: "Project not found",
            });
        }

        return res.status(200).json({
            status: "success",
            data: project,
        });

    } catch (error) {
        console.error("Failed to get project by id:", error);
        return res.status(500).json({
            error: "Failed to get project by id",
            message: error.message
        });
    }
}