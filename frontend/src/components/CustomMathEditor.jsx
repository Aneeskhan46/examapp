/**
 * CustomMathEditor — A WIRIS/MathType-inspired Math & Chemistry editor
 * powered by MathLive for interactive WYSIWYG visual editing.
 *
 * The main input area is a CustomTextEditor (contenteditable + inline math-fields).
 * Math/Chem snippets from the popup are inserted as editable <math-field> nodes.
 *
 * Props:
 *   value    {string}   — serialized string (plain text + §MATH§latex§END§ segments)
 *   onChange {function} — called with new serialized string on every change
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "mathlive";
import "./CustomMathEditor.css";
import CustomTextEditor from "./CustomTextEditor";

function unwrapChemValue(value = "") {
  const match = String(value).match(/^\\ce\{([\s\S]*)\}$/);
  return match ? match[1] : String(value);
}

function serializeChemValue(value = "") {
  const normalized = unwrapChemValue(value)
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\$/g, "")
    .trim();
  return normalized ? `\\ce{${normalized}}` : "";
}

/* ─────────────────────────────────────────────────────────────
   Symbol / Template definitions
───────────────────────────────────────────────────────────── */
const MATH_GROUPS = [
  {
    label: "Greek",
    items: [
      { label: "α", insert: "\\alpha" },
      { label: "β", insert: "\\beta" },
      { label: "γ", insert: "\\gamma" },
      { label: "δ", insert: "\\delta" },
      { label: "ε", insert: "\\varepsilon" },
      { label: "ζ", insert: "\\zeta" },
      { label: "η", insert: "\\eta" },
      { label: "θ", insert: "\\theta" },
      { label: "λ", insert: "\\lambda" },
      { label: "μ", insert: "\\mu" },
      { label: "π", insert: "\\pi" },
      { label: "ρ", insert: "\\rho" },
      { label: "σ", insert: "\\sigma" },
      { label: "τ", insert: "\\tau" },
      { label: "φ", insert: "\\varphi" },
      { label: "ω", insert: "\\omega" },
      { label: "Γ", insert: "\\Gamma" },
      { label: "Δ", insert: "\\Delta" },
      { label: "Θ", insert: "\\Theta" },
      { label: "Λ", insert: "\\Lambda" },
      { label: "Σ", insert: "\\Sigma" },
      { label: "Φ", insert: "\\Phi" },
      { label: "Ω", insert: "\\Omega" },
    ],
  },
  {
    label: "Operators",
    items: [
      { label: "±", insert: "\\pm" },
      { label: "×", insert: "\\times" },
      { label: "÷", insert: "\\div" },
      { label: "≠", insert: "\\neq" },
      { label: "≤", insert: "\\leq" },
      { label: "≥", insert: "\\geq" },
      { label: "≈", insert: "\\approx" },
      { label: "∞", insert: "\\infty" },
      { label: "∑", insert: "\\sum" },
      { label: "∏", insert: "\\prod" },
      { label: "∫", insert: "\\int" },
      { label: "∮", insert: "\\oint" },
      { label: "∂", insert: "\\partial" },
      { label: "∇", insert: "\\nabla" },
      { label: "∈", insert: "\\in" },
      { label: "∉", insert: "\\notin" },
      { label: "⊂", insert: "\\subset" },
      { label: "∪", insert: "\\cup" },
      { label: "∩", insert: "\\cap" },
      { label: "∅", insert: "\\emptyset" },
      { label: "√", insert: "\\sqrt{#0}" },
      { label: "∛", insert: "\\sqrt[3]{#0}" },
    ],
  },
  {
    label: "Templates",
    isTemplate: true,
    items: [
      { label: "a/b",    insert: "\\frac{#0}{#?}" },
      { label: "xⁿ",    insert: "#0^{#?}" },
      { label: "xₙ",    insert: "#0_{#?}" },
      { label: "√x",    insert: "\\sqrt{#0}" },
      { label: "ⁿ√x",   insert: "\\sqrt[#?]{#0}" },
      { label: "()",    insert: "\\left(#0\\right)" },
      { label: "[]",    insert: "\\left[#0\\right]" },
      { label: "|x|",   insert: "\\left|#0\\right|" },
      { label: "lim",   insert: "\\lim_{#?}" },
      { label: "∫dx",   insert: "\\int_{#?}^{#?}" },
      { label: "∑",     insert: "\\sum_{#?}^{#?}" },
      { label: "matrix",insert: "\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}" },
      { label: "vec",   insert: "\\vec{#0}" },
      { label: "hat",   insert: "\\hat{#0}" },
      { label: "bar",   insert: "\\bar{#0}" },
    ],
  },
  {
    label: "Trig / Log",
    items: [
      { label: "sin",   insert: "\\sin" },
      { label: "cos",   insert: "\\cos" },
      { label: "tan",   insert: "\\tan" },
      { label: "cot",   insert: "\\cot" },
      { label: "sec",   insert: "\\sec" },
      { label: "csc",   insert: "\\csc" },
      { label: "sin⁻¹", insert: "\\sin^{-1}" },
      { label: "cos⁻¹", insert: "\\cos^{-1}" },
      { label: "tan⁻¹", insert: "\\tan^{-1}" },
      { label: "log",   insert: "\\log" },
      { label: "ln",    insert: "\\ln" },
      { label: "exp",   insert: "\\exp" },
    ],
  },
  {
    label: "Arrows",
    items: [
      { label: "→", insert: "\\rightarrow" },
      { label: "←", insert: "\\leftarrow" },
      { label: "↔", insert: "\\leftrightarrow" },
      { label: "⇒", insert: "\\Rightarrow" },
      { label: "⇔", insert: "\\Leftrightarrow" },
      { label: "↑", insert: "\\uparrow" },
      { label: "↓", insert: "\\downarrow" },
    ],
  },
  {
    label: "Integrals",
    isTemplate: true,
    items: [
      { label: "∫",       insert: "\\int" },
      { label: "∬",       insert: "\\iint" },
      { label: "∭",       insert: "\\iiint" },
      { label: "∮",       insert: "\\oint" },
      { label: "∯",       insert: "\\oiint" },
      { label: "∫dx",     insert: "\\int #0 \\, d#?" },
      { label: "∫ₐᵇ",    insert: "\\int_{#?}^{#?} #0 \\, d#?" },
      { label: "∫∫dA",   insert: "\\iint_{#?} #0 \\, dA" },
      { label: "∮C",     insert: "\\oint_{#?} #0 \\, d#?" },
      { label: "∫∫∫dV",  insert: "\\iiint_{#?} #0 \\, dV" },
      { label: "F(b)-F(a)", insert: "\\left[#0\\right]_{#?}^{#?}" },
      { label: "u-sub",   insert: "\\int #0 \\, du" },
    ],
  },
  {
    label: "Derivatives",
    isTemplate: true,
    items: [
      { label: "d/dx",       insert: "\\frac{d}{dx}" },
      { label: "dy/dx",      insert: "\\frac{dy}{dx}" },
      { label: "d²y/dx²",   insert: "\\frac{d^{2}y}{dx^{2}}" },
      { label: "dⁿy/dxⁿ",  insert: "\\frac{d^{#?}#0}{dx^{#?}}" },
      { label: "∂/∂x",      insert: "\\frac{\\partial}{\\partial x}" },
      { label: "∂f/∂x",     insert: "\\frac{\\partial #0}{\\partial x}" },
      { label: "∂²f/∂x²",  insert: "\\frac{\\partial^{2} #0}{\\partial x^{2}}" },
      { label: "∂²f/∂x∂y", insert: "\\frac{\\partial^{2} #0}{\\partial x \\partial y}" },
      { label: "f'(x)",      insert: "#0^{\\prime}(#?)" },
      { label: "f''(x)",     insert: "#0^{\\prime\\prime}(#?)" },
      { label: "ẋ",          insert: "\\dot{#0}" },
      { label: "ẍ",          insert: "\\ddot{#0}" },
      { label: "∇f",         insert: "\\nabla #0" },
      { label: "∇²f",        insert: "\\nabla^{2} #0" },
    ],
  },
  {
    label: "Logarithmic",
    isTemplate: true,
    items: [
      { label: "log",       insert: "\\log" },
      { label: "ln",        insert: "\\ln" },
      { label: "log₁₀",    insert: "\\log_{10}" },
      { label: "log₂",     insert: "\\log_{2}" },
      { label: "logₐ",     insert: "\\log_{#?}" },
      { label: "logₐ(x)",  insert: "\\log_{#?}\\left(#0\\right)" },
      { label: "ln(x)",    insert: "\\ln\\left(#0\\right)" },
      { label: "log|x|",   insert: "\\log\\left|#0\\right|" },
      { label: "eˣ",       insert: "e^{#0}" },
      { label: "aˣ",       insert: "#?^{#0}" },
      { label: "log(ab)",  insert: "\\log\\left(#0 \\cdot #?\\right)" },
      { label: "log(a/b)", insert: "\\log\\left(\\frac{#0}{#?}\\right)" },
      { label: "log(aⁿ)",  insert: "\\log\\left(#0^{#?}\\right)" },
    ],
  },
  {
    label: "Constants",
    items: [
      { label: "e", insert: "e" },
      { label: "i", insert: "i" },
      { label: "ℝ", insert: "\\mathbb{R}" },
      { label: "ℤ", insert: "\\mathbb{Z}" },
      { label: "ℕ", insert: "\\mathbb{N}" },
      { label: "ℚ", insert: "\\mathbb{Q}" },
    ],
  },
  {
    label: "Sets",
    items: [
      { label: "⊆", insert: "\\subseteq" },
      { label: "⊇", insert: "\\supseteq" },
      { label: "∖", insert: "\\setminus" },
      { label: "∩", insert: "\\cap" },
      { label: "∪", insert: "\\cup" },
      { label: "∅", insert: "\\emptyset" },
    ],
  },
  {
    label: "Logic",
    items: [
      { label: "∀", insert: "\\forall" },
      { label: "∃", insert: "\\exists" },
      { label: "¬", insert: "\\neg" },
      { label: "∧", insert: "\\land" },
      { label: "∨", insert: "\\lor" },
    ],
  },
];

const CHEM_GROUPS = [
  {
    label: "Period 1-2",
    isChem: true,
    items: ["H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne"].map((el) => ({
      label: el, insert: el, cls: "chem-element",
    })),
  },
  {
    label: "Period 3-4",
    isChem: true,
    items: ["Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca"].map((el) => ({
      label: el, insert: el, cls: "chem-element",
    })),
  },
  {
    label: "Transition Metals",
    isChem: true,
    items: ["Fe", "Cu", "Zn", "Mn", "Cr", "Ni", "Co", "Ag", "Au", "Hg", "Pb", "Sn"].map(
      (el) => ({ label: el, insert: el, cls: "chem-element" })
    ),
  },
  {
    label: "Bonds & Arrows",
    isChem: true,
    items: [
      { label: "→",  insert: "->",  cls: "chem-arrow" },
      { label: "⇌",  insert: "<=>", cls: "chem-arrow" },
      { label: "↑",  insert: "^",   cls: "chem-arrow" },
      { label: "↓",  insert: "v",   cls: "chem-arrow" },
      { label: "+",  insert: "+",   cls: "chem-arrow" },
    ],
  },
  {
    label: "States",
    isChem: true,
    items: [
      { label: "(s)",  insert: "(s)",  cls: "chem-state" },
      { label: "(l)",  insert: "(l)",  cls: "chem-state" },
      { label: "(g)",  insert: "(g)",  cls: "chem-state" },
      { label: "(aq)", insert: "(aq)", cls: "chem-state" },
    ],
  },
  {
    label: "Charges",
    isChem: true,
    items: [
      { label: "⁺",  insert: "^{+}",  cls: "chem-element" },
      { label: "⁻",  insert: "^{-}",  cls: "chem-element" },
      { label: "²⁺", insert: "^{2+}", cls: "chem-element" },
      { label: "²⁻", insert: "^{2-}", cls: "chem-element" },
      { label: "₂",  insert: "2",     cls: "chem-element" },
      { label: "₃",  insert: "3",     cls: "chem-element" },
      { label: "₄",  insert: "4",     cls: "chem-element" },
      { label: "₆",  insert: "6",     cls: "chem-element" },
    ],
  },
  {
    label: "Compounds",
    isChem: true,
    items: [
      { label: "H₂O",   insert: "H2O",   cls: "chem-element" },
      { label: "CO₂",   insert: "CO2",   cls: "chem-element" },
      { label: "NH₃",   insert: "NH3",   cls: "chem-element" },
      { label: "H₂SO₄", insert: "H2SO4", cls: "chem-element" },
      { label: "HCl",   insert: "HCl",   cls: "chem-element" },
      { label: "NaOH",  insert: "NaOH",  cls: "chem-element" },
      { label: "NaCl",  insert: "NaCl",  cls: "chem-element" },
      { label: "CaCO₃", insert: "CaCO3", cls: "chem-element" },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────────── */
export default function CustomMathEditor({ value = "", onChange }) {
  const [mode, setMode] = useState("math");       // "math" | "chem"
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const mainTextEditorRef = useRef(null);
  const popupMfRef = useRef(null);

  const [activeMathGroup, setActiveMathGroup] = useState(0);
  const [activeChemGroup, setActiveChemGroup] = useState(0);

  /* ── Configure popup math-field when mode switches ── */
  useEffect(() => {
    const popupMf = popupMfRef.current;
    if (!popupMf || !isEditorOpen) return;
    popupMf.defaultMode = mode === "chem" ? "text" : "math";
    requestAnimationFrame(() => popupMf.focus());
  }, [mode, isEditorOpen]);

  /* ── Keyboard shortcuts for Popup ── */
  useEffect(() => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;

    const handleKeyDown = (e) => {
      if (e.key === " ") {
        e.preventDefault();
        if (mode === "chem") {
          popupMf.executeCommand(["insert", "\\, "]);
        } else {
          popupMf.executeCommand(["insert", "\\, "]);
        }
      } else if (e.key === "Enter") {
        if (mode === "chem") return;
        e.preventDefault();
        popupMf.executeCommand(["insert", "\\\\"]);
      }
    };

    popupMf.addEventListener("keydown", handleKeyDown);
    return () => popupMf.removeEventListener("keydown", handleKeyDown);
  }, [isEditorOpen, mode]);

  /* ── Insert symbol / template into popup math-field ── */
  const insertAtCursor = useCallback((insertText) => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;
    popupMf.focus();
    popupMf.executeCommand(["insert", insertText]);
  }, []);

  const toggleEditor = (newMode) => {
    if (isEditorOpen && mode === newMode) {
      setIsEditorOpen(false);
      requestAnimationFrame(() => mainTextEditorRef.current?.focus());
      return;
    }
    setMode(newMode);
    setIsEditorOpen(true);
  };

  /* ── Insert from popup into main editor ── */
  const handleInsert = () => {
    const popupMf = popupMfRef.current;
    const mainTextEditor = mainTextEditorRef.current;
    if (!popupMf || !mainTextEditor) return;

    let latex = popupMf.getValue ? popupMf.getValue() : popupMf.value;
    if (mode === "chem" && latex) {
      latex = serializeChemValue(latex);
    }

    if (!latex || latex.trim() === "") {
      if (popupMf.setValue) popupMf.setValue("");
      else popupMf.value = "";
      setIsEditorOpen(false);
      return;
    }

    mainTextEditor.insertMath(latex);

    if (popupMf.setValue) popupMf.setValue("");
    else popupMf.value = "";
   
    requestAnimationFrame(() => mainTextEditor.focus());
  };

  const handleClose = () => setIsEditorOpen(false);

  const groups = mode === "math" ? MATH_GROUPS : CHEM_GROUPS;

  return (
    <div className="cme-wrapper">
      <div className="Input-question-box">
        <CustomTextEditor
          ref={mainTextEditorRef}
          value={value}
          onChange={onChange}
          placeholder="Enter text here..."
          onMathType={() => toggleEditor("math")}
          onChemType={() => toggleEditor("chem")}
          mathTypeActive={isEditorOpen && mode === "math"}
          chemTypeActive={isEditorOpen && mode === "chem"}
        />
      </div>

      {/* ── MathLive Visual Editor Popup ──────────────────── */}
      {isEditorOpen && (
        <div className="cme-editor-popup">
          <div className="cme-popup-header">
            <span>{mode === "math" ? "Math Editor " : "Chemistry Editor"}</span>
           
          </div>

          {/* Symbol / Template Toolbar */}
          <div className="cme-toolbar" role="toolbar" aria-label="Symbol palette">
            <div className="cme-toolbar-groups">
              {groups.map((group, index) => {
                const isActive = mode === "math" ? activeMathGroup === index : activeChemGroup === index;
                return (
                  <button
                    key={group.label}
                    className={`cme-group-tab${isActive ? " active" : ""}`}
                    type="button"
                    onClick={() => {
                      if (mode === "math") setActiveMathGroup(index);
                      else setActiveChemGroup(index);
                    }}
                  >
                    {group.label}
                  </button>
                );
              })}
            </div>
            <div className="cme-toolbar-items">
              {groups[mode === "math" ? activeMathGroup : activeChemGroup]?.items.map((item, i) => {
                const currentGroup = groups[mode === "math" ? activeMathGroup : activeChemGroup];
                return (
                  <button
                    key={`${currentGroup.label}-${i}`}
                    type="button"
                    className={`cme-btn${currentGroup.isTemplate ? " template" : ""}${item.cls ? ` ${item.cls}` : ""}`}
                    title={item.insert}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertAtCursor(item.insert);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="cme-mathfield-container"
            onMouseDown={(e) => {
              // If the click landed on the math-field itself, let the browser
              // handle focus + caret placement natively (do NOT preventDefault).
              // If click landed on container padding, preventDefault to stop
              // focus theft, then manually focus the math-field.
              if (e.target === popupMfRef.current ||
                  (popupMfRef.current && popupMfRef.current.contains(e.target))) {
                return; // browser handles it
              }
              e.preventDefault();
              requestAnimationFrame(() => {
                try { popupMfRef.current?.focus(); } catch (_) {}
              });
            }}
          >
            <math-field
              ref={popupMfRef}
              class="cme-mathfield"
              tabIndex={0}
              math-virtual-keyboard-policy="manual"
              placeholder={
                mode === "math"
                  ? ""
                  : ""
              }
            />
          </div>

          {/* ///cancel and insert div */}
         <div  style={{display:"flex", justifyContent:"flex-end"}}>
           <div className="cme-popup-footer">
            <button type="button" style={{backgroundColor:"#9ca3af",color:"black"}} className="cme-insert-btn"  onClick={handleClose}>
              Cancel 
            </button>
          </div>

          <div className="cme-popup-footer">
            <button type="button" className="cme-insert-btn" onClick={handleInsert}>
              Insert 
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
