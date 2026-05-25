import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";
import Exam from "./Exam";

export default function StudentDashboard({ mode }) {
  const [exams, setExams] = useState([]);

  useEffect(() => {
    if (mode === "exam") {
      return undefined;
    }

    let ignore = false;

    async function loadAssignedExams() {
      try {
        const token = localStorage.getItem("token");
        const res = await API.get("/exams/assigned", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setExams(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadAssignedExams();

    return () => {
      ignore = true;
    };
  }, [mode]);

  if (mode === "exam") {
    return <Exam />;
  }

  return (
    <>
      <Navbar />
      <main className="page stack">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow">Student Dashboard</p>
            <h1>Assigned exams</h1>
            <p>Start your assigned MCQ exams and submit answers for marking.</p>
          </div>
        </section>

        {exams.length === 0 ? (
          <section className="content-card">
            <p>No exams assigned yet.</p>
          </section>
        ) : (
          <section className="exam-grid">
            {exams.map((exam) => (
              <article className="content-card stack" key={exam._id}>
                <div>
                  <p className="eyebrow">{exam.completed ? "Completed" : "Pending"}</p>
                  <h2>{exam.name}</h2>
                  <p>Exam Date: {new Date(exam.examDate).toLocaleDateString()}</p>
                  <p>
                    Questions Ready: {exam.questionCount} / {exam.totalQuestions}
                  </p>
                </div>
                {exam.completed ? (
                  <Link className="button secondary" to="/my-result">
                    View Result
                  </Link>
                ) : !exam.ready ? (
                  <button className="button secondary" type="button" disabled>
                    Not Ready
                  </button>
                ) : (
                  <Link className="button primary" to={`/student/exams/${exam._id}`}>
                    Start Exam
                  </Link>
                )}
              </article>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
