import { Link, useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/");
  };

  return (
    <nav className="app-nav">
      <div className="nav-brand">Exam App</div>
      <div className="nav-links">
        <Link to={role === "admin" ? "/admin" : "/student"}>Dashboard</Link>
        {role === "admin" && <Link to="/admin/create-exam">Create Exam</Link>}
        {role === "admin" && <Link to="/admin/questions">Questions</Link>}
        {role === "admin" && <Link to="/results">Results</Link>}
        {role === "student" && <Link to="/my-result">My Result</Link>}
        {role ? (
          <button className="button secondary" type="button" onClick={handleLogout}>
            Logout
          </button>
        ) : (
          <Link to="/">Auth</Link>
        )}
      </div>
    </nav>
  );
}
