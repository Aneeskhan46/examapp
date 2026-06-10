import { useEffect, useState,useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";


// katex
import 'katex/dist/katex.min.css';
import katex from "katex";
import 'katex/contrib/mhchem'; // chemistry rendering support
import "mathlive";


/* ─────────────────────────────────────────────────────────────
   Serialization constants — must match CustomTextEditor.jsx
───────────────────────────────────────────────────────────── */
const MATH_OPEN = "§MATH§";
const MATH_CLOSE = "§END§";

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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Appends sanitized HTML content to a parent element */
function appendHtmlContent(parent, html) {
  if (!html) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const allowed = new Set([
    "B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN", "UL", "OL", "LI",
    "SUB", "SUP", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "A", "TABLE", "THEAD",
    "TBODY", "TR", "TH", "TD", "FIGURE", "FIGCAPTION", "COLGROUP", "COL",
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
          // Copy table-related attributes for proper rendering
          const tableAttrs = ["style", "class", "colspan", "rowspan"];
          tableAttrs.forEach((attr) => {
            if (node.getAttribute(attr)) {
              el.setAttribute(attr, node.getAttribute(attr));
            }
          });
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

export default function Exam() {
  const navigate = useNavigate();
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadQuestions() {
      try {
        const token = localStorage.getItem("token");

        const res = await API.get(`/exams/${examId}/questions`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!ignore) {
          setExam(res.data.exam);
          setQuestions(res.data.questions);
        }
      } catch (error) {
        console.log(error);
      }
    }

    loadQuestions();

    return () => {
      ignore = true;
    };
  }, [examId]);

  const handleAnswer = (questionId, selectedAnswer) => {
    const newAnswers = answers.filter((ans) => ans.questionId !== questionId);
    newAnswers.push({ questionId, selectedAnswer });
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    try {
      const token = localStorage.getItem("token");

      await API.post(
        "/results/submit",
        { examId, answers },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      alert("Exam Submitted");
      navigate("/my-result");
    } catch (error) {
      console.log(error);
      alert(error.response?.data?.message || "Exam submit failed");
    }
  };

  

  return (
    <>
      <Navbar />
      <main className="page stack">
        <section className="dashboard-hero">
          <div>
            <p className="eyebrow">MCQ Exam</p>
            <h1>{exam?.name || "Exam"}</h1>
            {exam && <p>Exam Date: {new Date(exam.examDate).toLocaleDateString()}</p>}
          </div>
        </section>
        {questions.map((question,index) => (
          <article className="question-preview" key={question._id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
              <strong>{index + 1}.</strong>
              <QuestionPreview value={question.question} />
            </div>

            <div className="option-list">
              {Object.entries(question.options).map(([key, value]) => (
                <label className="option-row" key={key}>
                  <input
                    type="radio"
                    name={question._id}
                    value={key}
                    onChange={() => handleAnswer(question._id, key)}
                  />
                  <strong>{key}.</strong>
                  <span style={{ display: 'inline', verticalAlign: 'middle' }}>{value}</span>
                </label>
              ))}
            </div>
          </article>
        ))}
        <button className="button primary" type="button" onClick={handleSubmit}>
          Submit Exam
        </button>
      </main>
    </>
  );
}
