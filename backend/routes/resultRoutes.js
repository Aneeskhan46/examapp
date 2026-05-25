import express from "express";
import { getAllResults, myResult, submitResult } from "../controllers/resultController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import roleMiddleware from "../middleware/roleMiddleware.js";

const router = express.Router();

router.post("/submit", authMiddleware, roleMiddleware("student"), submitResult);
router.get("/", authMiddleware, roleMiddleware("admin"), getAllResults);
router.get("/my-result", authMiddleware, roleMiddleware("student"), myResult);

export default router;
