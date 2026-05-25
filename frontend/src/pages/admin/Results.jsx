import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import API from "../../services/api";

export default function Results() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadResults() {
      try {
        const token = localStorage.getItem("token");

        const res = await API.get("/results", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setResults(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadResults();

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
            <p className="eyebrow">Result Management</p>
            <h1>Exam Results</h1>
            <p>Each correct answer is worth 2 marks.</p>
          </div>
        </section>

        <section className="content-card">
          {results.length === 0 ? (
            <p>No results submitted yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Exam Name</th>
                    <th>Total Questions</th>
                    <th>Correct</th>
                    <th>Wrong</th>
                    <th>Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result._id}>
                      <td>{result.student?.name}</td>
                      <td>{result.exam?.name}</td>
                      <td>{result.totalQuestions}</td>
                      <td>{result.correctAnswers}</td>
                      <td>{result.wrongAnswers}</td>
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
