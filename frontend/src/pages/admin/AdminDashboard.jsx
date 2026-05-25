import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalExams: 0,
    totalCompletedExams: 0,
    recentResults: [],
  });

  useEffect(() => {
    let ignore = false;

    async function loadStats() {
      try {
        const token = localStorage.getItem("token");
        const res = await API.get("/exams/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setStats(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadStats();

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <>
      <Navbar />
      <main className="page stack">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow">Admin Dashboard</p>
            <h1>Exam control center</h1>
            <p>Track students, create exams, manage questions, and review results.</p>
          </div>
          <div className="dashboard-actions">
            <Link className="button primary" to="/admin/create-exam">
              Create Exam
            </Link>
            <Link className="button secondary" to="/results">
              View Results
            </Link>
            <Link className="button secondary" to="/admin/questions">
              Manage Questions
            </Link>
          </div>
        </section>

        <section className="stat-grid">
          <article className="stat-card">
            <span>Total Students</span>
            <strong>{stats.totalStudents}</strong>
          </article>
          <article className="stat-card">
            <span>Total Exams Created</span>
            <strong>{stats.totalExams}</strong>
          </article>
          <article className="stat-card">
            <span>Total Completed Exams</span>
            <strong>{stats.totalCompletedExams}</strong>
          </article>
        </section>

        <section className="content-card stack">
          <div className="section-heading">
            <p className="eyebrow">Result management</p>
            <h2>Recent submissions</h2>
          </div>
          {stats.recentResults.length === 0 ? (
            <p>No completed exams yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Exam</th>
                    <th>Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentResults.map((result) => (
                    <tr key={result._id}>
                      <td>{result.student?.name}</td>
                      <td>{result.exam?.name}</td>
                      <td>{result.marksObtained}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
