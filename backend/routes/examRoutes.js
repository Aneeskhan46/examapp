import express from "express";
import {
  createExam,
  getAssignedExams,
  getDashboardStats,
  getExamQuestions,
  getExams,
  getStudents,
} from "../controllers/examController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import roleMiddleware from "../middleware/roleMiddleware.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, roleMiddleware("admin"), getDashboardStats);
router.get("/students", authMiddleware, roleMiddleware("admin"), getStudents);
router.post("/", authMiddleware, roleMiddleware("admin"), createExam);
router.get("/", authMiddleware, roleMiddleware("admin"), getExams);
router.get("/assigned", authMiddleware, roleMiddleware("student"), getAssignedExams);
router.get("/:examId/questions", authMiddleware, getExamQuestions);

export default router;
