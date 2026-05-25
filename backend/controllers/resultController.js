import Question from "../models/Question.js";
import Result from "../models/Result.js";

export const submitResult = async (req, res) => {
  try {
    const { examId, answers } = req.body;
    const existingResult = await Result.findOne({
      student: req.user.id,
      exam: examId,
    });

    if (existingResult) {
      return res.status(400).json({ message: "Exam already submitted" });
    }

    const questions = await Question.find({ exam: examId });
    let correctAnswers = 0;

    questions.forEach((question) => {
      const studentAnswer = answers.find(
        (ans) => ans.questionId === question._id.toString(),
      );

      if (studentAnswer && studentAnswer.selectedAnswer === question.correctAnswer) {
        correctAnswers++;
      }
    });

    const wrongAnswers = questions.length - correctAnswers;
    const marksObtained = correctAnswers * 2;

    const result = await Result.create({
      student: req.user.id,
      exam: examId,
      correctAnswers,
      wrongAnswers,
      marksObtained,
      totalQuestions: questions.length,
      answers,
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const getAllResults = async (req, res) => {
  try {
    const results = await Result.find()
      .populate("student", "name email")
      .populate("exam", "name")
      .sort({ createdAt: -1 });
    res.json(results);
  } catch (error) {
    res.status(500).json(error);
  }
};

export const myResult = async (req, res) => {
  try {
    const results = await Result.find({ student: req.user.id })
      .populate("exam", "name examDate")
      .sort({ createdAt: -1 });
    res.json(results);
  } catch (error) {
    res.status(500).json(error);
  }
};
