/**
 * CustomMathEditor — A WIRIS/MathType-inspired Math & Chemistry editor
 * powered by MathLive for interactive WYSIWYG visual editing.
 *
 * The cursor lives directly inside the rendered math preview.
 * No raw LaTeX text input is shown to the user.
 *
 * Props:
 *   value    {string}   — current LaTeX string
 *   onChange {function} — called with new LaTeX string on every change
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "mathlive";
import "./CustomMathEditor.css";

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
   MathLive insert tokens:
     #0  = wraps/replaces current selection (cursor placeholder if nothing selected)
     #?  = an empty interactive placeholder the user can tab into
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
];

const CHEM_GROUPS = [
  {
    label: "Elements (Period 1-2)",
    isChem: true,
    items: ["H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne"].map((el) => ({
      label: el,
      insert: el,
      cls: "chem-element",
    })),
  },
  {
    label: "Period 3-4",
    isChem: true,
    items: ["Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca"].map((el) => ({
      label: el,
      insert: el,
      cls: "chem-element",
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
    label: "Charges & Subscripts",
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
    label: "Common Compounds",
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
   SVG icons
───────────────────────────────────────────────────────────── */
const MathIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 5H5L3 12l5-2 5 2-2-7H8z" />
    <path d="M21 5h-3l-2 7 5-2 5 2-2-7h-3z" />
    <path d="M5 19h14" />
  </svg>
);

const ChemIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 3H5L3 21h18L19 3h-4" />
    <path d="M9 3a3 3 0 0 0 6 0" />
    <path d="M8 12h8" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────────── */
export default function CustomMathEditor({ value = "", onChange }) {
  const [mode, setMode] = useState("math"); // "math" | "chem"
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  
  const modeRef = useRef(mode);
  const mainMfRef = useRef(null);
  const popupMfRef = useRef(null);
  const suppressSync = useRef(false);

  const [activeMathGroup, setActiveMathGroup] = useState(0);
  const [activeChemGroup, setActiveChemGroup] = useState(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /* ── Configure popup math-field when mode tab switches ── */
  useEffect(() => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;
    popupMf.defaultMode = mode === "chem" ? "text" : "math";
    if (isEditorOpen) {
      popupMf.focus();
    }
  }, [mode, isEditorOpen]);

  /* ── Setup Main MathField (Sync & Events) ── */
  useEffect(() => {
    const mainMf = mainMfRef.current;
    if (!mainMf) return;

    if (!suppressSync.current && mainMf.value !== value) {
      mainMf.value = value;
    }

    const handleInput = (e) => {
      suppressSync.current = true;
      onChange?.(e.target.value);
      requestAnimationFrame(() => {
        suppressSync.current = false;
      });
    };

    const handleKeyDown = (e) => {
      if (e.key === " ") {
        e.preventDefault();
        mainMf.executeCommand(["insert", "\\text{ }"]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        mainMf.executeCommand(["insert", "\\\\"]);
      }
    };

    mainMf.addEventListener("input", handleInput);
    mainMf.addEventListener("keydown", handleKeyDown);
    return () => {
      mainMf.removeEventListener("input", handleInput);
      mainMf.removeEventListener("keydown", handleKeyDown);
    };
  }, [value, onChange]);

  /* ── Keyboard shortcuts for Popup ── */
  useEffect(() => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;

    const handleKeyDown = (e) => {
      if (mode === "chem") return; // Allow natural space and enter in text mode

      if (e.key === " ") {
        e.preventDefault();
        popupMf.executeCommand(["insert", "\\text{ }"]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        popupMf.executeCommand(["insert", "\\\\"]);
      }
    };

    popupMf.addEventListener("keydown", handleKeyDown);
    return () => {
      popupMf.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditorOpen, mode]); // Re-attach when editor opens/closes or mode changes

  /* ── Insert symbol / template at the current cursor in Popup ── */
  const insertAtCursor = useCallback((insertText) => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;
    popupMf.focus();
    popupMf.executeCommand(["insert", insertText]);
  }, []);

  const handleModeSwitch = (newMode) => {
    setMode(newMode);
    setIsEditorOpen(true);
  };

  const handleInsert = () => {
    const popupMf = popupMfRef.current;
    const mainMf = mainMfRef.current;
    if (!popupMf || !mainMf) return;

    let mathValue = popupMf.value;
    if (mode === "chem" && mathValue) {
      mathValue = serializeChemValue(mathValue);
    }
    
    // Insert into main math field at cursor
    mainMf.focus();
    mainMf.executeCommand(["insert", mathValue]);

    onChange?.(mainMf.value);
    
    // Clear the popup math field and close the editor
    popupMf.value = "";
    setIsEditorOpen(false);
  };

  const handleClose = () => {
    setIsEditorOpen(false);
  };

  const groups = mode === "math" ? MATH_GROUPS : CHEM_GROUPS;

  return (
    <div className="cme-wrapper">

      {/* ── Tab Bar ───────────────────────────────────────── */}
      <div className="cme-tabs" role="tablist" aria-label="Editor mode">
        <button
          className={`cme-tab${mode === "math" && isEditorOpen ? " active" : ""}`}
          role="tab"
          aria-selected={mode === "math" && isEditorOpen}
          onClick={() => handleModeSwitch("math")}
          type="button"
          title="Math Editor (MathType)"
        >
          <MathIcon />
          MathType
        </button>
        <button
          className={`cme-tab${mode === "chem" && isEditorOpen ? " active" : ""}`}
          role="tab"
          aria-selected={mode === "chem" && isEditorOpen}
          onClick={() => handleModeSwitch("chem")}
          type="button"
          title="Chemistry Editor (ChemType)"
        >
          <ChemIcon />
          ChemType
        </button>
      </div>

      <div className="Input-question-box" >
        <math-field
          
          ref={mainMfRef}
          class="cme-main-mathfield"
          math-virtual-keyboard-policy="manual"
         
        />
      </div>

      {/* ── MathLive Visual Editor Popup ──── */}
      {isEditorOpen && (
        <div className="cme-editor-popup">
          <div className="cme-popup-header">
            <span>{mode === "math" ? "Math Editor" : "Chemistry Editor"}</span>
            <button className="cme-popup-close" onClick={handleClose} type="button">×</button>
          </div>

          {/* ── Symbol / Template Toolbar ─────────────────────── */}
          <div className="cme-toolbar" role="toolbar" aria-label="Symbol palette">
            {/* Group tabs */}
            <div className="cme-toolbar-groups">
              {groups.map((group, index) => {
                const isActive = mode === "math" ? activeMathGroup === index : activeChemGroup === index;
                return (
                  <button 
                    key={group.label}
                    className={`cme-group-tab ${isActive ? "active" : ""}`}
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

            {/* Active group items */}
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

          <div className="cme-mathfield-container">
            <math-field
              ref={popupMfRef}
              class="cme-mathfield"
              math-virtual-keyboard-policy="manual"
              placeholder={
                mode === "math"
                  ? "Click here and start typing your formula…"
                  : "Click here and type your chemical formula…"
              }
            />
          </div>

          <div className="cme-popup-footer">
            <button type="button" className="cme-insert-btn" onClick={handleInsert}>
              Insert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
