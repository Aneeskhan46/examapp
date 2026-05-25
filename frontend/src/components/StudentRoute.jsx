import { Navigate } from "react-router-dom";

export default function StudentRoute({ children }) {
  const role = localStorage.getItem("role");

  return role === "student" ? children : <Navigate to="/" />;
}
