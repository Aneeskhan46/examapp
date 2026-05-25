import mongoose from "mongoose";

const resultSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
  },
  correctAnswers: Number,
  wrongAnswers: Number,
  marksObtained: Number,
  totalQuestions: Number,
  answers: [
    {
      questionId: String,
      selectedAnswer: String,
    },
  ],
}, { timestamps: true });

export default mongoose.model("Result", resultSchema);
