import Exam from "../models/Exam.js";
import Question from "../models/Question.js";
import Result from "../models/Result.js";
import User from "../models/User.js";

export const getDashboardStats = async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: "student" });
    const totalExams = await Exam.countDocuments();
    const totalCompletedExams = await Result.countDocuments();
    const recentResults = await Result.find()
      .populate("student", "name email")
      .populate("exam", "name")
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({ totalStudents, totalExams, totalCompletedExams, recentResults });
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getStudents = async (req, res) => {
  try {
    const students = await User.find({ role: "student" }).select("name email");
    res.json(students);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const createExam = async (req, res) => {
  try {
    const { name, examDate, totalQuestions, assignedStudents } = req.body;

    const exam = await Exam.create({
      name,
      examDate,
      totalQuestions,
      assignedStudents,
      createdBy: req.user.id,
    });

    res.status(201).json(exam);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getExams = async (req, res) => {
  try {
    const exams = await Exam.find()
      .populate("assignedStudents", "name email")
      .sort({ createdAt: -1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getAssignedExams = async (req, res) => {
  try {
    const results = await Result.find({ student: req.user.id }).select("exam");
    const completedExamIds = results.map((result) => result.exam.toString());
    const exams = await Exam.find({ assignedStudents: req.user.id }).sort({ examDate: 1 });

    const examsWithStatus = await Promise.all(
      exams.map(async (exam) => {
        const questionCount = await Question.countDocuments({ exam: exam._id });

        return {
        ...exam.toObject(),
        questionCount,
        ready: questionCount === exam.totalQuestions,
        completed: completedExamIds.includes(exam._id.toString()),
      };
      }),
    );

    res.json(examsWithStatus);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getExamQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (
      req.user.role === "student" &&
      !exam.assignedStudents.map(String).includes(req.user.id)
    ) {
      return res.status(403).json({ message: "Exam not assigned to you" });
    }

    const questions = await Question.find({ exam: examId });

    if (req.user.role === "student" && questions.length !== exam.totalQuestions) {
      return res.status(400).json({ message: "Exam questions are not ready yet" });
    }

    res.json({ exam, questions });
  } catch (error) {
    res.status(500).json(error);
  }
};
