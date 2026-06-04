import { useEffect, useState,useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import API from "../../services/api";


// katex
import 'katex/dist/katex.min.css';
import katex from "katex";
import 'katex/contrib/mhchem'; // chemistry rendering support

function MathBlock({ math }) {

  // clean unsupported latex commands
  const cleanedMath = (math || "")
    .replace(/\\displaylines/g, "")
    .trim();

  let html;

  try {
    html = katex.renderToString(cleanedMath, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
      trust: true,
    });
  } catch {
    html = cleanedMath;
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function QuestionPreview({ value = "" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clear previous render
    el.innerHTML = "";

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
        appendTextFragment(el, text);
      }

      // Math block — read-only math-field
      const latex = match[1];
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
      el.appendChild(mf);

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last math block
    if (lastIndex < value.length) {
      appendTextFragment(el, value.slice(lastIndex));
    }
  }, [value]);

  return (
    <span
      ref={containerRef}
      style={{ display: "inline", lineHeight: 1.7, verticalAlign: "middle" }}
    />
  );
}
/* ─────────────────────────────────────────────────────────────
   Serialization constants — must match CustomTextEditor.jsx
───────────────────────────────────────────────────────────── */
const MATH_OPEN = "§MATH§";
const MATH_CLOSE = "§END§";


//escape regexfunction
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


//appendTextFragment
function appendTextFragment(parent, text) {
  if (!text) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = text;
  const allowed = new Set([
    "B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN", "UL", "OL", "LI",
  ]);
  const copy = (src, dest) => {
    Array.from(src.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        dest.appendChild(document.createTextNode(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.nodeName;
        if (tag === "BR") {
          dest.appendChild(document.createElement("br"));
        } else if (allowed.has(tag)) {
          const el = document.createElement(
            tag === "STRONG" ? "b" : tag === "EM" ? "i" : tag.toLowerCase()
          );
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

            {/* //i change this */}
            {/* <h3>{question.question}</h3> */}
            {/* <MathBlock math={question.question} /> */}
            
        <div>
          <strong>{index + 1}.</strong>
           <QuestionPreview value={question.question} />
          {/* <MathBlock math={question.question} /> */}
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
                  <strong>{key}.</strong> <MathBlock math={value} />
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
