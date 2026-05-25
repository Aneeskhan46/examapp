import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";
import MathEditor from "../../components/MathEditor";


import 'katex/dist/katex.min.css';
import katex from "katex";
import 'katex/contrib/mhchem'; // chemistry rendering support

export default function CreateQuestion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedExamId = searchParams.get("examId") || "";  
  const [exams, setExams] = useState([]);
  const [existingQuestions, setExistingQuestions] = useState([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState("A");

  const selectedExam = useMemo(
    () => exams.find((exam) => exam._id === selectedExamId),
    [exams, selectedExamId],
  );

  function MathBlock({ math }) {
    const mfRef = useRef(null);
    useEffect(() => {
      if (mfRef.current) {
        mfRef.current.value = math || "";
      }
    }, [math]);

    return (
      <math-field
        ref={mfRef}
        read-only
        style={{
          border: "none",
          background: "transparent",
          outline: "none",
          padding: 0,
          minHeight: "auto",
        }}
      />
    );
  }

  useEffect(() => {
    let ignore = false;



    async function loadExams() {
      try {
        const token = localStorage.getItem("token");
        const res = await API.get("/exams", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setExams(res.data);
          if (!selectedExamId && res.data[0]?._id) {
            setSearchParams({ examId: res.data[0]._id });
          }
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadExams();

    return () => {
      ignore = true;
    };
  }, [selectedExamId, setSearchParams]);

  useEffect(() => {
    let ignore = false;

    async function loadQuestions() {
      if (!selectedExamId) {
        setExistingQuestions([]);
        return;
      }

      try {
        const token = localStorage.getItem("token");
        const res = await API.get(`/questions/exam/${selectedExamId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setExistingQuestions(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadQuestions();

    return () => {
      ignore = true;
    };
  }, [selectedExamId]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem("token");

      await API.post(
        "/questions/create",
        { examId: selectedExamId, question, options, correctAnswer },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      alert("Question Created");
      setQuestion("");
      setOptions({ A: "", B: "", C: "", D: "" });
      setCorrectAnswer("A");
      const res = await API.get(`/questions/exam/${selectedExamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setExistingQuestions(res.data);
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Question create failed");
    }
  };

  return (
    <>
      <Navbar />
      <main className="page split-layout">
        <form className="content-card stack" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">Question Management</p>
            <h1>Create MCQ</h1>
            {selectedExam && (
              <p>
                {existingQuestions.length} of {selectedExam.totalQuestions} questions added
              </p>
            )}
          </div>

        

          <label>
            Select Exam
            <select
              value={selectedExamId}
              onChange={(e) => setSearchParams({ examId: e.target.value })}
              required
            >
              <option value="">Choose exam</option>
              {exams.map((exam) => (
                <option key={exam._id} value={exam._id}>
                  {exam.name}
                </option>
              ))}
            </select>
          </label>


{/* //question title with math editor */}
         <label>
  Question Title 

  <MathEditor
    value={question}
    onChange={setQuestion}
  />
</label>

          {["A", "B", "C", "D"].map((optionKey) => (
            <label key={optionKey}>
              Option  {optionKey}
              <input
                placeholder={`Option ${optionKey}`}
                value={options[optionKey]}
                onChange={(e) => {
                  setOptions({ ...options, [optionKey]: e.target.value });
                }}
                required
              />
            </label>
          ))}

          <label>
            Correct Answer
            <select
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              required
            >
              <option value="A">Option A</option>
              <option value="B">Option B</option>
              <option value="C">Option C</option>
              <option value="D">Option D</option>
            </select>
          </label>

          <button className="button primary" type="submit" disabled={!selectedExamId}>
            Add Question
          </button>
        </form>

       <section className="content-card stack">
  <div className="section-heading">
    <p className="eyebrow">Added Questions</p>
    <h2>{selectedExam?.name || "No exam selected"}</h2>
  </div>

  {existingQuestions.length === 0 ? (
    <p>No questions added yet.</p>
  ) : (
    existingQuestions.map((item, index) => (
      <article className="question-preview" key={item._id}>

        <div>
          <strong>{index + 1}.</strong>

          <MathBlock math={item.question} />
        </div>

        <p>
          Correct answer: Option {item.correctAnswer}
        </p>

      </article>
    ))
  )}
</section>
      </main>
    </>
  );
}
