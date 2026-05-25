import express from "express";
import {
  createQuestion,
  getQuestions,
  getQuestionsByExam,
} from "../controllers/questionController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import roleMiddleware from "../middleware/roleMiddleware.js";

const router = express.Router();

router.post("/create", authMiddleware, roleMiddleware("admin"), createQuestion);
router.get("/", authMiddleware, getQuestions);
router.get("/exam/:examId", authMiddleware, roleMiddleware("admin"), getQuestionsByExam);

export default router;
