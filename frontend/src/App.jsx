import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AdminRoute from "./components/AdminRoute";
import StudentRoute from "./components/StudentRoute";
import AdminDashboard from "./pages/admin/AdminDashboard";
import CreateExam from "./pages/admin/CreateExam";
import Results from "./pages/admin/Results";
import AuthHome from "./pages/auth/AuthHome";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import MyResult from "./pages/student/MyResult";
import StudentDashboard from "./pages/student/StudentDashboard";

const CreateQuestion = lazy(() => import("./pages/admin/CreateQuestion"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<main className="page">Loading...</main>}>
        <Routes>
          <Route path="/" element={<AuthHome />} />
          <Route path="/student-login" element={<Login role="student" />} />
          <Route path="/student-signup" element={<Signup role="student" />} />
          <Route path="/admin-login" element={<Login role="admin" />} />
          <Route path="/admin-signup" element={<Signup role="admin" />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />
          <Route
            path="/results"
            element={
              <AdminRoute>
                <Results />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/create-exam"
            element={
              <AdminRoute>
                <CreateExam />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/questions"
            element={
              <AdminRoute>
                <CreateQuestion />
              </AdminRoute>
            }
          />
          <Route
            path="/student"
            element={
              <StudentRoute>
                <StudentDashboard />
              </StudentRoute>
            }
          />
          <Route
            path="/student/exams/:examId"
            element={
              <StudentRoute>
                <StudentDashboard mode="exam" />
              </StudentRoute>
            }
          />
          <Route
            path="/my-result"
            element={
              <StudentRoute>
                <MyResult />
              </StudentRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
