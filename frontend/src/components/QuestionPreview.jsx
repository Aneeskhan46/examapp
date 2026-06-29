import React, { useRef, useEffect } from "react";
import "mathlive";

const MATH_OPEN = "§MATH§";
const MATH_CLOSE = "§END§";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLatexForPreview(latex) {
  if (!latex) return "";
  return latex.replace(/\\placeholder(\[[^\]]*\])?({[^}]*})?/g, "\\text{ }");
}

function createPreviewMathField(latex) {
  const cleaned = cleanLatexForPreview(latex);
  if (!cleaned || cleaned.trim() === "") {
    return document.createTextNode(" ");
  }

  const mf = document.createElement("math-field");
  mf.setAttribute("read-only", "");
  mf.setAttribute(
    "style",
    [
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
    ].join(";")
  );
  requestAnimationFrame(() => {
    if (mf.setValue) mf.setValue(cleaned);
    else mf.value = cleaned;
  });
  return mf;
}

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
          const rawLatex = node.getAttribute("value") || node.value || node.textContent || "";
          const cleaned = cleanLatexForPreview(rawLatex);
          if (!cleaned || cleaned.trim() === "") {
            dest.appendChild(document.createTextNode(" "));
          } else {
            const mf = document.createElement("math-field");
            mf.setAttribute("read-only", "");
            mf.setAttribute(
              "style",
              [
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
              ].join(";")
            );
            requestAnimationFrame(() => {
              if (mf.setValue) mf.setValue(cleaned);
              else mf.value = cleaned;
            });
            dest.appendChild(mf);
          }
        } else if (tag === "BR") {
          dest.appendChild(document.createElement("br"));
        } else if (tag === "SPAN" && node.classList.contains("math-tex")) {
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
          if (tag === "A" && node.getAttribute("href")) {
            el.setAttribute("href", node.getAttribute("href"));
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
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

export default function QuestionPreview({ value = "" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = "";

    const regex = new RegExp(
      escapeRegex(MATH_OPEN) + "([\\s\\S]*?)" + escapeRegex(MATH_CLOSE),
      "g"
    );

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(value)) !== null) {
      if (match.index > lastIndex) {
        const text = value.slice(lastIndex, match.index);
        appendHtmlContent(el, text);
      }

      const latex = match[1];
      el.appendChild(createPreviewMathField(latex));

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
      appendHtmlContent(el, value.slice(lastIndex));
    }

    el.querySelectorAll("span.math-tex").forEach((span) => {
      const latex = span.getAttribute("data-latex") || span.textContent || "";
      const mf = createPreviewMathField(latex);
      span.replaceWith(mf);
    });
  }, [value]);

  return (
    <span
      ref={containerRef}
      style={{ display: "inline", lineHeight: 1.7, verticalAlign: "middle" }}
    />
  );
}
