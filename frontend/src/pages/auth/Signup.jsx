import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";

export default function Signup({ role = "student" }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const isAdmin = role === "admin";
  const title = isAdmin ? "Admin Signup" : "Student Signup";
  const loginPath = isAdmin ? "/admin-login" : "/student-login";

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await API.post("/auth/signup", { ...form, role });
      alert("Signup Successful");
      navigate(loginPath);
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Signup failed");
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
          Name
          <input type="text" name="name" placeholder="Full name" onChange={handleChange} />
        </label>
        <label>
          Email
          <input type="email" name="email" placeholder="you@example.com" onChange={handleChange} />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            placeholder="Create password"
            onChange={handleChange}
          />
        </label>
        <button className="button primary" type="submit">
          Signup
        </button>
        <p className="form-switch">
          Already registered? <Link to={loginPath}>Login as {role}</Link>
        </p>
      </form>
    </main>
  );
}
