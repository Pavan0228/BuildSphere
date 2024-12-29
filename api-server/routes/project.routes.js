import { Router } from "express";
import { createProject } from "../controllers/project.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";


const router = Router();
router.post("/", verifyJWT, createProject);

export default router;