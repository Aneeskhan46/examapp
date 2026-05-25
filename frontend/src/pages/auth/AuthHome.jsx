import { Link } from "react-router-dom";

const portals = [
  {
    role: "student",
    title: "Student Portal",
    text: "Attend exams and check your score after submission.",
    login: "/student-login",
    signup: "/student-signup",
  },
  {
    role: "admin",
    title: "Admin Portal",
    text: "Create MCQs and review student exam results.",
    login: "/admin-login",
    signup: "/admin-signup",
  },
];

export default function AuthHome() {
  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">MERN Exam System</p>
        <h1>Choose your exam workspace</h1>
        <p className="hero-copy">
          Login or create an account for the correct role before entering the exam app.
        </p>
      </section>

      <section className="portal-grid" aria-label="Login and signup options">
        {portals.map((portal) => (
          <article className={`portal-card ${portal.role}`} key={portal.role}>
            <div>
              <p className="portal-kicker">{portal.role}</p>
              <h2>{portal.title}</h2>
              <p>{portal.text}</p>
            </div>

            <div className="portal-actions">
              <Link className="button primary" to={portal.login}>
                Login
              </Link>
              <Link className="button secondary" to={portal.signup}>
                Signup
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
