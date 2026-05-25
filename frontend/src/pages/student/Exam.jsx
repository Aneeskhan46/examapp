import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";


// katex
import 'katex/dist/katex.min.css';
import katex from "katex";
import 'katex/contrib/mhchem'; // chemistry rendering support

function MathBlock({ math }) {

  // clean unsupported latex commands
  const cleanedMath = (math || "")
    .replace(/\\displaylines/g, "")
    .trim();

  let html;

  try {
    html = katex.renderToString(cleanedMath, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
      trust: true,
    });
  } catch {
    html = cleanedMath;
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}


export default function Exam() {
  const navigate = useNavigate();
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadQuestions() {
      try {
        const token = localStorage.getItem("token");

        const res = await API.get(`/exams/${examId}/questions`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setExam(res.data.exam);
          setQuestions(res.data.questions);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadQuestions();

    return () => {
      ignore = true;
    };
  }, [examId]);

  const handleAnswer = (questionId, selectedAnswer) => {
    const newAnswers = answers.filter((ans) => ans.questionId !== questionId);
    newAnswers.push({ questionId, selectedAnswer });
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    try {
      const token = localStorage.getItem("token");

      await API.post(
        "/results/submit",
        { examId, answers },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      alert("Exam Submitted");
      navigate("/my-result");
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Exam submit failed");
    }
  };

  return (
    <>
      <Navbar />
      <main className="page stack">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow">MCQ Exam</p>
            <h1>{exam?.name || "Exam"}</h1>
            {exam && <p>Exam Date: {new Date(exam.examDate).toLocaleDateString()}</p>}
          </div>
        </section>
        {questions.map((question,index) => (
          <article className="question-preview" key={question._id}>

            {/* //i change this */}
            {/* <h3>{question.question}</h3> */}
            {/* <MathBlock math={question.question} /> */}
            
        <div>
          <strong>{index + 1}.</strong>

          <MathBlock math={question.question} />
        </div>


            <div className="option-list">
              {Object.entries(question.options).map(([key, value]) => (
                <label className="option-row" key={key}>
                  <input
                    type="radio"
                    name={question._id}
                    value={key}
                    onChange={() => handleAnswer(question._id, key)}
                  />
                  <strong>{key}.</strong> <MathBlock math={value} />
                </label>
              ))}
            </div>
          </article>
        ))}
        <button className="button primary" type="button" onClick={handleSubmit}>
          Submit Exam
        </button>
      </main>
    </>
  );
}
