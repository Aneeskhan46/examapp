import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";

export default function Login({ role = "student" }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const isAdmin = role === "admin";
  const title = isAdmin ? "Admin Login" : "Student Login";
  const signupPath = isAdmin ? "/admin-signup" : "/student-signup";

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const res = await API.post("/auth/login", form);

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("role", res.data.user.role);

      if (res.data.user.role !== role) {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        alert(`This account is registered as ${res.data.user.role}.`);
        return;
      }

      if (res.data.user.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/student");
      }
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Login failed");
    }
  };

  return (
    <main className="auth-shell compact">
      <form className="auth-form" onSubmit={handleSubmit}>
        <Link className="back-link" to="/">
          Back
        </Link>
        <p className="eyebrow">{role} access</p>
        <h1>{title}</h1>
        <label>
          Email
          <input type="email" name="email" placeholder="you@example.com" onChange={handleChange} />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            placeholder="Enter password"
            onChange={handleChange}
          />
        </label>
        <button className="button primary" type="submit">
          Login
        </button>
        <p className="form-switch">
          New here? <Link to={signupPath}>Create {role} account</Link>
        </p>
      </form>
    </main>
  );
}
