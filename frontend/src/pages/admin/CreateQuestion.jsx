import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";
import MathEditor from "../../components/MathEditor";
import "mathlive";
import CkEditor from "../../components/Ckeditor";


/* ─────────────────────────────────────────────────────────────
   Serialization constants — must match CustomTextEditor.jsx
───────────────────────────────────────────────────────────── */
const MATH_OPEN = "§MATH§";
const MATH_CLOSE = "§END§";

/* ─────────────────────────────────────────────────────────────
   QuestionPreview
   Parses the serialized question string and renders:
     - plain text segments as <span>
     - §MATH§...§END§ segments as read-only <math-field>
───────────────────────────────────────────────────────────── */
function QuestionPreview({ value = "" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clear previous render
    el.innerHTML = "";

    // First pass: handle §MATH§...§END§ markers (from CustomMathEditor)
    const regex = new RegExp(
      escapeRegex(MATH_OPEN) + "([\\s\\S]*?)" + escapeRegex(MATH_CLOSE),
      "g"
    );

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(value)) !== null) {
      // Text before this math block
      if (match.index > lastIndex) {
        const text = value.slice(lastIndex, match.index);
        appendHtmlContent(el, text);
      }

      // Math block — read-only math-field
      const latex = match[1];
      el.appendChild(createPreviewMathField(latex));

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last math block
    if (lastIndex < value.length) {
      appendHtmlContent(el, value.slice(lastIndex));
    }

    // Second pass: find any <span class="math-tex"> elements
    // that came from CKEditor HTML and upgrade them to math-fields
    el.querySelectorAll("span.math-tex").forEach((span) => {
      const latex = span.getAttribute("data-latex") || span.textContent || "";
      if (latex) {
        const mf = createPreviewMathField(latex);
        span.replaceWith(mf);
      }
    });
  }, [value]);

  return (
    <span
      ref={containerRef}
      style={{ display: "inline", lineHeight: 1.7, verticalAlign: "middle" }}
    />
  );
}

/* Creates a read-only math-field for preview */
function createPreviewMathField(latex) {
  const mf = document.createElement("math-field");
  mf.setAttribute("read-only", "");
  mf.setAttribute("style", [
    "display:inline-block",
    "vertical-align:middle",
    "border:none",
    "background:transparent",
    "outline:none",
    "padding:0 2px",
    "margin:0 1px",
    "font-size:inherit",
    "min-height:auto",
    "--primary-color:#0f766e",
  ].join(";"));
  // Set value after upgrade
  requestAnimationFrame(() => {
    if (mf.setValue) mf.setValue(latex);
    else mf.value = latex;
  });
  return mf;
}

/* Appends sanitized HTML content to a parent element */
function appendHtmlContent(parent, html) {
  if (!html) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const allowed = new Set([
    "B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN", "UL", "OL", "LI",
    "SUB", "SUP", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "A", "TABLE", "THEAD",
    "TBODY", "TR", "TH", "TD",
  ]);
  const copy = (src, dest) => {
    Array.from(src.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        dest.appendChild(document.createTextNode(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.nodeName;
        if (tag === "MATH-FIELD") {
          // Preserve math-field elements as-is
          dest.appendChild(node.cloneNode(true));
        } else if (tag === "BR") {
          dest.appendChild(document.createElement("br"));
        } else if (tag === "SPAN" && node.classList.contains("math-tex")) {
          // Keep math-tex spans so they can be upgraded in the second pass
          const span = document.createElement("span");
          span.className = "math-tex";
          if (node.getAttribute("data-latex")) {
            span.setAttribute("data-latex", node.getAttribute("data-latex"));
          }
          span.textContent = node.textContent;
          dest.appendChild(span);
        } else if (allowed.has(tag)) {
          const map = { STRONG: "b", EM: "i" };
          const el = document.createElement(map[tag] || tag.toLowerCase());
          // Copy href for links
          if (tag === "A" && node.getAttribute("href")) {
            el.setAttribute("href", node.getAttribute("href"));
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
          copy(node, el);
          dest.appendChild(el);
        } else {
          copy(node, dest);
        }
      }
    });
  };
  const clean = document.createElement("span");
  copy(tmp, clean);
  while (clean.firstChild) parent.appendChild(clean.firstChild);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ─────────────────────────────────────────────────────────────
   CreateQuestion page
───────────────────────────────────────────────────────────── */
export default function CreateQuestion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedExamId = searchParams.get("examId") || "";

  const [exams, setExams] = useState([]);
  const [existingQuestions, setExistingQuestions] = useState([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState("A");

  const selectedExam = useMemo(
    () => exams.find((exam) => exam._id === selectedExamId),
    [exams, selectedExamId]
  );

  /* ── Load exams ── */
  useEffect(() => {
    let ignore = false;
    async function loadExams() {
      try {
        const token = localStorage.getItem("token");
        const res = await API.get("/exams", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!ignore) {
          setExams(res.data);
          if (!selectedExamId && res.data[0]?._id) {
            setSearchParams({ examId: res.data[0]._id });
          }
        }
      } catch (error) {
        console.log(error);
      }
    }
    loadExams();
    return () => { ignore = true; };
  }, [selectedExamId, setSearchParams]);

  /* ── Load questions ── */
  useEffect(() => {
    let ignore = false;
    async function loadQuestions() {
      if (!selectedExamId) {
        setExistingQuestions([]);
        return;
      }
      try {
        const token = localStorage.getItem("token");
        const res = await API.get(`/questions/exam/${selectedExamId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!ignore) setExistingQuestions(res.data);
      } catch (error) {
        console.log(error);
      }
    }
    loadQuestions();
    return () => { ignore = true; };
  }, [selectedExamId]);

  /* ── Submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      await API.post(
        "/questions/create",
        { examId: selectedExamId, question, options, correctAnswer },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert("Question Created");
      setQuestion("");
      setOptions({ A: "", B: "", C: "", D: "" });
      setCorrectAnswer("A");
      const res = await API.get(`/questions/exam/${selectedExamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setExistingQuestions(res.data);
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Question create failed");
    }
  };

  return (
    <>
      <Navbar />
      <main className="page split-layout">

        {/* ── Create Form ── */}
        <form className="content-card stack" onSubmit={handleSubmit}>
          <div className="section-heading">
            <p className="eyebrow">Question Management</p>
            <h1>Create MCQ</h1>
            {selectedExam && (
              <p>
                {existingQuestions.length} of {selectedExam.totalQuestions} questions added
              </p>
            )}
          </div>

          <label>
            Select Exam
            <select
              value={selectedExamId}
              onChange={(e) => setSearchParams({ examId: e.target.value })}
              required
            >
              <option value="">Choose exam</option>
              {exams.map((exam) => (
                <option key={exam._id} value={exam._id}>
                  {exam.name}
                </option>
              ))}
            </select>
          </label>

          {/* Question Title with Math Editor */}
          <div style={{ display: "grid", gap: "7px", color: "var(--heading)", fontWeight: 700 }}>
            Question Title

            <br></br>

            <h2>Custom Text editor</h2>
            <MathEditor
              value={question}
              onChange={setQuestion}
            />
          </div>

  <br></br>
  
          {/* //cke editor */}
          <h2>CkEditor Text editor</h2>
           <div>
             <CkEditor value={question} onChange={setQuestion} />   
           </div>


          {["A", "B", "C", "D"].map((optionKey) => (
            <label key={optionKey}>
              Option {optionKey}
              <input
                placeholder={`Option ${optionKey}`}
                value={options[optionKey]}
                onChange={(e) => setOptions({ ...options, [optionKey]: e.target.value })}
                required
              />
            </label>
          ))}

          <label>
            Correct Answer
            <select
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              required
            >
              <option value="A">Option A</option>
              <option value="B">Option B</option>
              <option value="C">Option C</option>
              <option value="D">Option D</option>
            </select>
          </label>

          <button className="button primary" type="submit" disabled={!selectedExamId}>
            Add Question
          </button>
        </form>

        {/* ── Added Questions Preview ── */}
        <section className="content-card stack">
          <div className="section-heading">
            <p className="eyebrow">Added Questions </p>
            <h2>{selectedExam?.name || "No exam selected"}</h2>
          </div>

          {existingQuestions.length === 0 ? (
            <p>No questions added yet.</p>
          ) : (
            existingQuestions.map((item, index) => (
              <article className="question-preview" key={item._id}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                  <strong>{index + 1}.</strong>
                  {/* Renders plain text + math-field blocks */}
                  <QuestionPreview value={item.question} />
                </div>
                <p>Correct answer: Option {item.correctAnswer}</p>
              </article>
            ))
          )}
        </section>

      </main>
    </>
  );
}
