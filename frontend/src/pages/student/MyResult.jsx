import { useEffect, useState } from "react";
import Navbar from "../../components/Navbar";
import API from "../../services/api";

export default function MyResult() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadResult() {
      try {
        const token = localStorage.getItem("token");

        const res = await API.get("/results/my-result", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setResults(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadResult();

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <>
      <Navbar />
      <main className="page stack">
        <h1>My Result</h1>
        {results.length > 0 ? (
          results.map((result) => (
            <article className="content-card result-card" key={result._id}>
              <div>
                <p className="eyebrow">{result.exam?.name}</p>
                <h2>{result.marksObtained} marks</h2>
                <p>Total Questions: {result.totalQuestions}</p>
              </div>
              <div className="result-metrics">
                <span>Correct: {result.correctAnswers}</span>
                <span>Wrong: {result.wrongAnswers}</span>
              </div>
            </article>
          ))
        ) : (
          <p>No result found</p>
        )}
      </main>
    </>
  );
}
