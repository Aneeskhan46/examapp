import Exam from "../models/Exam.js";
import Question from "../models/Question.js";

export const createQuestion = async (req, res) => {
  try {
    const { examId, question, options, correctAnswer } = req.body;
    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    const questionCount = await Question.countDocuments({ exam: examId });

    if (questionCount >= exam.totalQuestions) {
      return res.status(400).json({
        message: `This exam already has ${exam.totalQuestions} questions`,
      });
    }

    const newQuestion = await Question.create({
      exam: examId,
      question,
      options,
      correctAnswer,
      createdBy: req.user.id,
    });

    res.status(201).json(newQuestion);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getQuestions = async (req, res) => {
  try {
    const questions = await Question.find().populate("exam", "name totalQuestions");
    res.json(questions);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getQuestionsByExam = async (req, res) => {
  try {
    const questions = await Question.find({ exam: req.params.examId });
    res.json(questions);
  } catch (error) {
    res.status(500).json(error);
  }
};
