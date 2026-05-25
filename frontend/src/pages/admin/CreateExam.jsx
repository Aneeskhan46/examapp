import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";

export default function CreateExam() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState({
    name: "",
    examDate: "",
    totalQuestions: "",
    assignedStudents: [],
  });

  useEffect(() => {
    let ignore = false;

    async function loadStudents() {
      try {
        const token = localStorage.getItem("token");
        const res = await API.get("/exams/students", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setStudents(res.data);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadStudents();

    return () => {
      ignore = true;
    };
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const toggleStudent = (studentId) => {
    setForm((current) => {
      const assignedStudents = current.assignedStudents.includes(studentId)
        ? current.assignedStudents.filter((id) => id !== studentId)
        : [...current.assignedStudents, studentId];

      return { ...current, assignedStudents };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem("token");
      const res = await API.post(
        "/exams",
        {
          ...form,
          totalQuestions: Number(form.totalQuestions),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      navigate(`/admin/questions?examId=${res.data._id}`);
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Exam create failed");
    }
  };

  return (
    <>
      <Navbar />
      <main className="page">
        <form className="content-card stack" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">Admin</p>
            <h1>Create Exam</h1>
          </div>

          <label>
            Exam Name
            <input
              name="name"
              placeholder="JavaScript Basics Test"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Exam Date
            <input
              name="examDate"
              type="date"
              value={form.examDate}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Total Number of MCQ Questions
            <input
              min="1"
              name="totalQuestions"
              type="number"
              placeholder="10"
              value={form.totalQuestions}
              onChange={handleChange}
              required
            />
          </label>

          <section className="student-picker">
            <h2>Assign Students</h2>
            {students.length === 0 ? (
              <p>No students found.</p>
            ) : (
              <div className="student-grid">
                {students.map((student) => (
                  <label className="check-card" key={student._id}>
                    <input
                      type="checkbox"
                      checked={form.assignedStudents.includes(student._id)}
                      onChange={() => toggleStudent(student._id)}
                    />
                    <span>
                      <strong>{student.name}</strong>
                      <small>{student.email}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <button className="button primary" type="submit">
            Create Exam and Add Questions
          </button>
        </form>
      </main>
    </>
  );
}
