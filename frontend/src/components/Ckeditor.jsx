import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor,
  Essentials,
  Bold,
  Italic,
  Underline,
  Paragraph,
  Heading,
  Table,
  TableToolbar,
  TableCellProperties,
  TableProperties,
  List,
  Link,
  Undo,
  Plugin,
  ButtonView,
  Widget,
  toWidget,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import 'mathlive';
import './CustomMathEditor.css';
import SpecialCharacterModal from './SpecialCharacterModal';

// Global map + handler ref for widget click → edit popup
window.__ckMathWidgets = window.__ckMathWidgets || new Map();
window.__ckMathWidgetClickHandler = null;

function findMathWidgetFromEventTarget(target) {
  if (!target) return null;

  const path = typeof target.composedPath === 'function' ? target.composedPath() : [target];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList?.contains('ck-math-widget')) return node;
    if (node.dataset?.mathId) return node;
    if (node.classList?.contains('ck-widget') && node.querySelector?.('.ck-math-widget-inner')) {
      return node;
    }
  }

  return target instanceof Element ? target.closest?.('.ck-math-widget, [data-math-id]') : null;
}

function getLatexFromWidgetDom(widgetEl) {
  if (!widgetEl) return '';

  const dataLatex = widgetEl.getAttribute('data-latex');
  if (dataLatex) return dataLatex;

  const mf = widgetEl.querySelector('math-field');
  if (mf) return mf.getValue ? mf.getValue() : mf.value || '';

  return '';
}

function isModelElementLive(editor, modelElement) {
  if (!editor || !modelElement) return false;
  try {
    editor.model.createPositionBefore(modelElement);
    return true;
  } catch {
    return false;
  }
}

function findMathModelInDocument(editor, widgetEl) {
  if (!editor || !widgetEl) return null;

  const selected = editor.model.document.selection.getSelectedElement();
  if (selected?.name === 'mathInline') return selected;

  const widgetId = widgetEl.getAttribute('data-math-id');
  if (widgetId) {
    const mapped = window.__ckMathWidgets.get(widgetId);
    if (isModelElementLive(editor, mapped)) return mapped;
  }

  const viewElement = editor.editing.view.domConverter.mapDomToView(widgetEl);
  if (viewElement) {
    const mapped = editor.editing.mapper.toModelElement(viewElement);
    if (mapped?.name === 'mathInline') return mapped;
  }

  const latex = getLatexFromWidgetDom(widgetEl);
  if (!latex) return null;

  const root = editor.model.document.getRoot();
  for (const { item } of editor.model.createRangeIn(root)) {
    if (item.is?.('element', 'mathInline') && item.getAttribute('latex') === latex) {
      return item;
    }
  }

  return null;
}

function triggerWidgetEdit(editor, modelElement, latex, widgetEl) {
  if (!editor || editor._mathWidgetOpening) return;
  editor._mathWidgetOpening = true;
  queueMicrotask(() => {
    editor._mathWidgetOpening = false;
  });

  const resolvedModel = isModelElementLive(editor, modelElement)
    ? modelElement
    : findMathModelInDocument(editor, widgetEl);

  const resolvedLatex =
    resolvedModel?.getAttribute('latex') ||
    latex ||
    getLatexFromWidgetDom(widgetEl);

  if (!resolvedLatex) return;

  if (resolvedModel) {
    editor.model.change((writer) => {
      writer.setSelection(resolvedModel, 'on');
    });
  }

  const handler = editor.mathWidgetClickHandler || window.__ckMathWidgetClickHandler;
  handler?.(resolvedModel, resolvedLatex);
}

function bindWidgetClickTarget(editor, container) {
  if (!container || container._ckMathClickBound) return;
  container._ckMathClickBound = true;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    triggerWidgetEdit(editor, null, getLatexFromWidgetDom(container), container);
  };

  container.addEventListener('mousedown', onPointerDown, true);
  container.addEventListener('click', onPointerDown, true);
}

/* ══════════════════════════════════════════════════════════
   Symbol groups — same as CustomMathEditor.jsx
══════════════════════════════════════════════════════════ */
const MATH_GROUPS = [
  {
    label: '√(□)', items: [
      // 1. Root & Fraction Group (3 cols)
      { label: '√', insert: '\\sqrt{#0}', title: 'Square Root' },
      { label: '√□', insert: '\\sqrt{#0}', title: 'Root with Placeholder' },
      { label: 'ⁿ√', insert: '\\sqrt[#?]{#0}', title: 'Nth Root' },
      { label: '□/□', insert: '\\frac{#0}{#?}', title: 'Fraction' },

      { type: 'sep', cols: 2 },
      // 2. Brackets & Delimiters Group (2 cols)
      { label: '()', insert: '\\left(#0\\right)', title: 'Parentheses' },
      { label: '[]', insert: '\\left[#0\\right]', title: 'Square Brackets' },
      { label: '||', insert: '\\left|#0\\right|', title: 'Absolute Value' },

      { type: 'sep', cols: 3 },
      // 3. Basic Arithmetic Operators (3 cols)
      { label: '+', insert: '+' },
      { label: '−', insert: '-' },
      { label: '×', insert: '\\times' },
      { label: '÷', insert: '\\div' },
      { label: '±', insert: '\\pm' },

      { type: 'sep', cols: 3 },
      // 4. Comparison & Relation Operators (3 cols)
      { label: '≥', insert: '\\geq' },
      { label: '≤', insert: '\\leq' },
      { label: '∈', insert: '\\in' },
      { label: '≠', insert: '\\neq' },
      { label: '≈', insert: '\\approx' },
      { label: '∞', insert: '\\infty' },

      { type: 'sep', cols: 2 },
      // 5. Greek Letters (2 cols)
      { label: 'α', insert: '\\alpha' },
      { label: 'β', insert: '\\beta' },
      { label: 'π', insert: '\\pi' },

      { type: 'sep', cols: 1 },
      // 6. Undo / Redo (1 col)
      { label: '↶', action: 'UNDO', title: 'Undo' },
      { label: '↷', action: 'REDO', title: 'Redo' },

      { type: 'sep', cols: 2 },
      // 7. Formatting Group (2 cols)
      { label: 'B', action: 'BOLD', cls: 'template', title: 'Bold' },
      { label: '〖Ω〗', title: 'Insert Special Character', action: 'SPECIAL_CHARS' },
      { label: '🅰️', action: 'TEXT_COLOR', title: 'Text Color' },

      { type: 'sep', cols: 1 },
      // 8. Text Style Group (1 col)
      { label: 'T₁', insert: '#0_{#?}', title: 'Subscript' },
      { label: 'T¹', insert: '#0^{#?}', title: 'Superscript' },

      { type: 'sep', cols: 1 },
      // 9. Font Controls (1 col)
      { type: 'dropdown', label: 'Font...' },
      { type: 'dropdown', label: 'Size' }
    ]
  },
  {
    label: '±×÷', items: [
      { label: '±', insert: '\\pm' }, { label: '∓', insert: '\\mp' },
      { label: '×', insert: '\\times' }, { label: '÷', insert: '\\div' },
      { label: '≠', insert: '\\neq' }, { label: '≤', insert: '\\leq' },
      { label: '≥', insert: '\\geq' }, { label: '≈', insert: '\\approx' },
      { label: '≅', insert: '\\cong' }, { label: '∝', insert: '\\propto' },
      { label: '≡', insert: '\\equiv' }, { label: 'sim', insert: '\\sim' },
      { label: '∞', insert: '\\infty' }, { label: '∑', insert: '\\sum' },
      { label: '∏', insert: '\\prod' },
      { label: '∫', insert: '\\int' }, { label: '∮', insert: '\\oint' },
      { label: '∂', insert: '\\partial' }, { label: '∇', insert: '\\nabla' },
      { label: '⊕', insert: '\\oplus' }, { label: '⊗', insert: '\\otimes' },
      { label: '⊙', insert: '\\odot' },
      { label: '∈', insert: '\\in' }, { label: '∉', insert: '\\notin' },
      { label: '⊂', insert: '\\subset' }, { label: '∪', insert: '\\cup' },
      { label: '∩', insert: '\\cap' }, { label: '∅', insert: '\\emptyset' },
      { label: '√', insert: '\\sqrt{#0}' }, { label: '∛', insert: '\\sqrt[3]{#0}' },
      { label: '□±□', insert: '#? \\pm #?' }, { label: '□≠□', insert: '#? \\neq #?' },
      { label: '□≈□', insert: '#? \\approx #?' },
    ]
  },
  {
    label: '□/□', isTemplate: true, items: [
      { label: 'a/b', insert: '\\frac{#0}{#?}' }, { label: 'xⁿ', insert: '#0^{#?}' },
      { label: 'xₙ', insert: '#0_{#?}' }, { label: '√x', insert: '\\sqrt{#0}' },
      { label: 'ⁿ√x', insert: '\\sqrt[#?]{#0}' }, { label: '()', insert: '\\left(#0\\right)' },
      { label: '[]', insert: '\\left[#0\\right]' }, { label: '{}', insert: '\\left\\{#0\\right\\}' },
      { label: '⟨⟩', insert: '\\left\\langle #0 \\right\\rangle' }, { label: '|x|', insert: '\\left|#0\\right|' },
      { label: 'x̅', insert: '\\overline{#0}' }, { label: 'x̲', insert: '\\underline{#0}' },
      { label: '□!', insert: '{#0}!' }, { label: 'mod', insert: '#0 \\pmod{#?}' },
      { label: 'lim', insert: '\\lim_{#?}' }, { label: '∫dx', insert: '\\int_{#?}^{#?}' },
      { label: '∑', insert: '\\sum_{#?}^{#?}' }, { label: 'vec', insert: '\\vec{#0}' },
      { label: 'hat', insert: '\\hat{#0}' }, { label: 'bar', insert: '\\bar{#0}' },
      { label: '(a/b)', insert: '\\left(\\frac{#0}{#?}\\right)' },
      { label: '[a/b]', insert: '\\left[\\frac{#0}{#?}\\right]' },
      { label: '{a/b}', insert: '\\left\\{\\frac{#0}{#?}\\right\\}' },
      { label: 'xᵃ/ᵇ', insert: '#0^{\\frac{#?}{#?}}' },
      { label: 'xₐᵇ', insert: '#0_{#?}^{#?}' },
    ]
  },
  {
    label: 'sin/cos', items: [
      { label: 'sin', insert: '\\sin' }, { label: 'cos', insert: '\\cos' },
      { label: 'tan', insert: '\\tan' }, { label: 'cot', insert: '\\cot' },
      { label: 'sec', insert: '\\sec' }, { label: 'csc', insert: '\\csc' },
      { label: 'sin(x)', insert: '\\sin\\left(#0\\right)' },
      { label: 'cos(x)', insert: '\\cos\\left(#0\\right)' },
      { label: 'tan(x)', insert: '\\tan\\left(#0\\right)' },
      { label: 'sin⁻¹', insert: '\\sin^{-1}' }, { label: 'cos⁻¹', insert: '\\cos^{-1}' },
      { label: 'tan⁻¹', insert: '\\tan^{-1}' },
      { label: 'sin²x', insert: '\\sin^{2}\\left(#0\\right)' },
      { label: 'cos²x', insert: '\\cos^{2}\\left(#0\\right)' },
      { label: 'tan²x', insert: '\\tan^{2}\\left(#0\\right)' },
      { label: 'sinh', insert: '\\sinh' }, { label: 'cosh', insert: '\\cosh' },
      { label: 'tanh', insert: '\\tanh' },
      { label: 'log', insert: '\\log' }, { label: 'ln', insert: '\\ln' },
      { label: 'exp', insert: '\\exp' },
    ]
  },
  {
    label: '→', items: [
      { label: '→', insert: '\\rightarrow' }, { label: '←', insert: '\\leftarrow' },
      { label: '↔', insert: '\\leftrightarrow' }, { label: '⇒', insert: '\\Rightarrow' },
      { label: '⇐', insert: '\\Leftarrow' }, { label: '⇔', insert: '\\Leftrightarrow' },
      { label: '⇄', insert: '\\rightleftarrows' }, { label: '⇌', insert: '\\rightleftharpoons' },
      { label: '↑', insert: '\\uparrow' }, { label: '↓', insert: '\\downarrow' },
      { label: '↗', insert: '\\nearrow' }, { label: '↘', insert: '\\searrow' },
      { label: '⟵', insert: '\\longleftarrow' }, { label: '⟶', insert: '\\longrightarrow' },
      { label: '⟷', insert: '\\longleftrightarrow' },
      { label: '⎯⎯>', insert: '\\xrightarrow{#0}' },
      { label: '<⎯⎯', insert: '\\xleftarrow{#0}' },
      { label: '<⎯⎯>', insert: '\\xleftrightarrow{#0}' },
    ]
  },
  {
    label: '∫ ∯', isTemplate: true, items: [
      { label: '∫', insert: '\\int' }, { label: '∬', insert: '\\iint' },
      { label: '∭', insert: '\\iiint' }, { label: '∮', insert: '\\oint' },
      { label: '∯', insert: '\\oiint' }, { label: '∰', insert: '\\oiiint' },
      { label: '∫dx', insert: '\\int #0 \\, d#?' },
      { label: '∫ₐᵇ', insert: '\\int_{#?}^{#?} #0 \\, d#?' },
      { label: '∫∫dA', insert: '\\iint_{#?} #0 \\, dA' },
      { label: '∮C', insert: '\\oint_{#?} #0 \\, d#?' },
      { label: '∫∫∫dV', insert: '\\iiint_{#?} #0 \\, dV' },
      { label: '∫_C', insert: '\\int_{C} #0 \\, d#?' },
      { label: '∮_C', insert: '\\oint_{C} #0 \\, d#?' },
      { label: '∫∫_D', insert: '\\iint_{D} #0 \\, dA' },
      { label: 'F(b)-F(a)', insert: '\\left[#0\\right]_{#?}^{#?}' },
      { label: 'u-sub', insert: '\\int #0 \\, du' },
    ]
  },
  {
    label: 'd/dx', isTemplate: true, items: [
      { label: 'd/dx', insert: '\\frac{d}{dx}' },
      { label: 'dy/dx', insert: '\\frac{dy}{dx}' },
      { label: 'df/dx', insert: '\\frac{df}{dx}' },
      { label: 'd/dt', insert: '\\frac{d}{dt}' },
      { label: 'dy/dt', insert: '\\frac{dy}{dt}' },
      { label: 'd²y/dx²', insert: '\\frac{d^{2}y}{dx^{2}}' },
      { label: 'd²y/dt²', insert: '\\frac{d^{2}y}{dt^{2}}' },
      { label: 'dⁿy/dxⁿ', insert: '\\frac{d^{#?}#0}{dx^{#?}}' },
      { label: '∂/∂x', insert: '\\frac{\\partial}{\\partial x}' },
      { label: '∂f/∂x', insert: '\\frac{\\partial #0}{\\partial x}' },
      { label: '∂²f/∂x²', insert: '\\frac{\\partial^{2} #0}{\\partial x^{2}}' },
      { label: '∂²f/∂y²', insert: '\\frac{\\partial^{2} #0}{\\partial y^{2}}' },
      { label: '∂²f/∂x∂y', insert: '\\frac{\\partial^{2} #0}{\\partial x \\partial y}' },
      { label: "f'(x)", insert: '#0^{\\prime}(#?)' },
      { label: "f''(x)", insert: '#0^{\\prime\\prime}(#?)' },
      { label: "f'''(x)", insert: '#0^{\\prime\\prime\\prime}(#?)' },
      { label: "y'", insert: 'y^{\\prime}' }, { label: "y''", insert: 'y^{\\prime\\prime}' },
      { label: 'ẋ', insert: '\\dot{#0}' }, { label: 'ẍ', insert: '\\ddot{#0}' },
      { label: '∇f', insert: '\\nabla #0' }, { label: '∇²f', insert: '\\nabla^{2} #0' },
    ]
  },
  {
    label: 'log/ln', isTemplate: true, items: [
      { label: 'log', insert: '\\log' }, { label: 'ln', insert: '\\ln' },
      { label: 'log₁₀', insert: '\\log_{10}' }, { label: 'log₂', insert: '\\log_{2}' },
      { label: 'logₐ', insert: '\\log_{#?}' },
      { label: 'logₐ(x)', insert: '\\log_{#?}\\left(#0\\right)' },
      { label: 'log₁₀(x)', insert: '\\log_{10}\\left(#0\\right)' },
      { label: 'ln(x)', insert: '\\ln\\left(#0\\right)' },
      { label: 'log|x|', insert: '\\log\\left|#0\\right|' },
      { label: 'eˣ', insert: 'e^{#0}' }, { label: 'eⁱˣ', insert: 'e^{i #0}' },
      { label: '10ˣ', insert: '10^{#0}' }, { label: '2ˣ', insert: '2^{#0}' },
      { label: 'aˣ', insert: '#?^{#0}' },
      { label: 'log(ab)', insert: '\\log\\left(#0 \\cdot #?\\right)' },
      { label: 'log(a/b)', insert: '\\log\\left(\\frac{#0}{#?}\\right)' },
      { label: 'log(aⁿ)', insert: '\\log\\left(#0^{#?}\\right)' },
    ]
  },
  {
    label: 'π,e', items: [
      { label: 'e', insert: 'e' }, { label: 'i', insert: 'i' },
      { label: 'π', insert: '\\pi' },
      { label: 'ℝ', insert: '\\mathbb{R}' }, { label: 'ℤ', insert: '\\mathbb{Z}' },
      { label: 'ℕ', insert: '\\mathbb{N}' }, { label: 'ℚ', insert: '\\mathbb{Q}' },
      { label: 'ℂ', insert: '\\mathbb{C}' }, { label: '∅', insert: '\\emptyset' },
      { label: 'ℵ₀', insert: '\\aleph_0' },
      { label: 'ξ', insert: '\\xi' },
      { label: 'ρ', insert: '\\rho' }, { label: 'σ', insert: '\\sigma' },
      { label: 'τ', insert: '\\tau' }, { label: 'υ', insert: '\\upsilon' },
      { label: 'φ', insert: '\\varphi' }, { label: 'χ', insert: '\\chi' },
      { label: 'ψ', insert: '\\psi' }, { label: 'ω', insert: '\\omega' },
      { label: 'Γ', insert: '\\Gamma' }, { label: 'Δ', insert: '\\Delta' },
      { label: 'Θ', insert: '\\Theta' }, { label: 'Λ', insert: '\\Lambda' },
      { label: 'Ξ', insert: '\\Xi' }, { label: 'Σ', insert: '\\Sigma' },
      { label: 'Φ', insert: '\\Phi' }, { label: 'Ψ', insert: '\\Psi' },
      { label: 'Ω', insert: '\\Omega' },
      { label: 'θᵢ', insert: '\\theta_{#?}' }, { label: 'λₙ', insert: '\\lambda_{#?}' },
      { label: 'μₓ', insert: '\\mu_{#?}' }, { label: 'σ²', insert: '\\sigma^{2}' },
      { label: 'Δx', insert: '\\Delta #?' },
    ]
  },
  {
    label: '∈∪∩', items: [
      { label: 'Ω', title: 'Insert Special Character', action: 'SPECIAL_CHARS' },
      { label: '⊆', insert: '\\subseteq' }, { label: '⊇', insert: '\\supseteq' },
      { label: '∖', insert: '\\setminus' }, { label: '∩', insert: '\\cap' },
      { label: '∪', insert: '\\cup' }, { label: '∅', insert: '\\emptyset' },
      { label: '□⊂□', insert: '#? \\subset #?' }, { label: '□⊆□', insert: '#? \\subseteq #?' },
      { label: '□∈□', insert: '#? \\in #?' }, { label: '□∉□', insert: '#? \\notin #?' },
      { label: '□∪□', insert: '#? \\cup #?' }, { label: '□∩□', insert: '#? \\cap #?' },
    ]
  },
  {
    label: '∀∃', items: [
      { label: '∀', insert: '\\forall' }, { label: '∃', insert: '\\exists' },
      { label: '¬', insert: '\\neg' }, { label: '∧', insert: '\\land' },
      { label: '∨', insert: '\\lor' },
      { label: '□⇒□', insert: '#? \\Rightarrow #?' }, { label: '□⇔□', insert: '#? \\Leftrightarrow #?' },
      { label: '□∧□', insert: '#? \\land #?' }, { label: '□∨□', insert: '#? \\lor #?' },
      { label: '¬□', insert: '\\neg #?' },
    ]
  },
  {
    label: (
      <>
        ⎡□ □⎤
      </>
    ),
    isMatrix: true,
    items: [
      { label: '□', insert: 'matrix', cls: 'template' },
      { label: '[]', insert: 'bmatrix', cls: 'template' },
      { label: '()', insert: 'pmatrix', cls: 'template' },
      { label: '||', insert: 'vmatrix', cls: 'template' },
      { label: '□ □ □', insert: '\\begin{matrix} #? & #? & #? \\end{matrix}', cls: 'template', directInsert: true },
      { label: '□ \\ □', insert: '\\begin{bmatrix} #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: '□ & □', insert: '\\begin{bmatrix} #? & #? \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: '□ \\ □', insert: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true },
      { label: '□ & □', insert: '\\begin{pmatrix} #? & #? \\end{pmatrix}', cls: 'template', directInsert: true },
      { label: '□ \\ □ \\ □', insert: '\\begin{bmatrix} #? \\\\ #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: '□ \\ □ \\ □', insert: '\\begin{pmatrix} #? \\\\ #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true },
      { label: 'I₂', insert: '\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: 'I₃', insert: '\\begin{bmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: 'O₂', insert: '\\begin{bmatrix} 0 & 0 \\\\ 0 & 0 \\end{bmatrix}', cls: 'template', directInsert: true },
      { label: 'O₃', insert: '\\begin{bmatrix} 0 & 0 & 0 \\\\ 0 & 0 & 0 \\\\ 0 & 0 & 0 \\end{bmatrix}', cls: 'template', directInsert: true },
    ]
  },
];

const CHEM_GROUPS = [
  {
    label: 'H-Ne', isChem: true,
    items: ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne'].map(el => ({ label: el, insert: el, cls: 'chem-element' }))
  },
  {
    label: 'Na-Ca', isChem: true,
    items: ['Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca'].map(el => ({ label: el, insert: el, cls: 'chem-element' }))
  },
  {
    label: 'Fe-Zn', isChem: true,
    items: ['Fe', 'Cu', 'Zn', 'Mn', 'Cr', 'Ni', 'Co', 'Ag', 'Au', 'Hg', 'Pb', 'Sn', 'Br', 'I', 'Ba', 'Pt', 'Xe'].map(el => ({ label: el, insert: el, cls: 'chem-element' }))
  },
  {
    label: '→⇌', isChem: true, items: [
      { label: '→', insert: '->', cls: 'chem-arrow' }, { label: '⇌', insert: '<=>', cls: 'chem-arrow' },
      { label: '←', insert: '<-', cls: 'chem-arrow' }, { label: '⇄', insert: '<->', cls: 'chem-arrow' },
      { label: '↑', insert: '^', cls: 'chem-arrow' }, { label: '↓', insert: 'v', cls: 'chem-arrow' },
      { label: '+', insert: ' + ', cls: 'chem-arrow' },
      { label: '→(Δ)', insert: '->[\\Delta]', cls: 'chem-arrow' },
      { label: '→(aq)', insert: '->[aq]', cls: 'chem-arrow' },
    ]
  },
  {
    label: '(s)(l)', isChem: true, items: [
      { label: '(s)', insert: '(s)', cls: 'chem-state' }, { label: '(l)', insert: '(l)', cls: 'chem-state' },
      { label: '(g)', insert: '(g)', cls: 'chem-state' }, { label: '(aq)', insert: '(aq)', cls: 'chem-state' },
      { label: '(conc)', insert: '(conc)', cls: 'chem-state' },
      { label: '(dil)', insert: '(dil)', cls: 'chem-state' }, { label: '(ppt)', insert: '(ppt)', cls: 'chem-state' },
    ]
  },
  {
    label: '⁺/⁻', isChem: true, items: [
      { label: '⁺', insert: '^{+}', cls: 'chem-element' }, { label: '⁻', insert: '^{-}', cls: 'chem-element' },
      { label: '²⁺', insert: '^{2+}', cls: 'chem-element' }, { label: '²⁻', insert: '^{2-}', cls: 'chem-element' },
      { label: '³⁺', insert: '^{3+}', cls: 'chem-element' }, { label: '³⁻', insert: '^{3-}', cls: 'chem-element' },
      { label: '₂', insert: '2', cls: 'chem-element' }, { label: '₃', insert: '3', cls: 'chem-element' },
      { label: '₄', insert: '4', cls: 'chem-element' }, { label: '₅', insert: '5', cls: 'chem-element' },
      { label: '₆', insert: '6', cls: 'chem-element' }, { label: '₇', insert: '7', cls: 'chem-element' },
      { label: '₈', insert: '8', cls: 'chem-element' }, { label: 'ₓ', insert: 'x', cls: 'chem-element' },
      { label: 'ₙ', insert: 'n', cls: 'chem-element' },
    ]
  },
  {
    label: 'H₂O', isChem: true, items: [
      { label: 'H₂O', insert: 'H2O', cls: 'chem-element' }, { label: 'CO₂', insert: 'CO2', cls: 'chem-element' },
      { label: 'NH₃', insert: 'NH3', cls: 'chem-element' }, { label: 'H₂SO₄', insert: 'H2SO4', cls: 'chem-element' },
      { label: 'HCl', insert: 'HCl', cls: 'chem-element' }, { label: 'NaOH', insert: 'NaOH', cls: 'chem-element' },
      { label: 'NaCl', insert: 'NaCl', cls: 'chem-element' }, { label: 'CaCO₃', insert: 'CaCO3', cls: 'chem-element' },
      { label: 'HNO₃', insert: 'HNO3', cls: 'chem-element' }, { label: 'H₃PO₄', insert: 'H3PO4', cls: 'chem-element' },
      { label: 'CH₃COOH', insert: 'CH3COOH', cls: 'chem-element' }, { label: 'C₆H₁₂O₆', insert: 'C6H12O6', cls: 'chem-element' },
      { label: 'CH₄', insert: 'CH4', cls: 'chem-element' }, { label: 'C₂H₅OH', insert: 'C2H5OH', cls: 'chem-element' },
      { label: 'CO₃²⁻', insert: 'CO3^{2-}', cls: 'chem-element' }, { label: 'SO₄²⁻', insert: 'SO4^{2-}', cls: 'chem-element' },
      { label: 'NO₃⁻', insert: 'NO3^-', cls: 'chem-element' }, { label: 'PO₄³⁻', insert: 'PO4^{3-}', cls: 'chem-element' },
      { label: 'NH₄⁺', insert: 'NH4^+', cls: 'chem-element' }, { label: 'OH⁻', insert: 'OH^-', cls: 'chem-element' },
    ]
  },
];

function serializeChemValue(latex = '') {
  const match = String(latex).match(/^\\ce\{([\s\S]*)\}$/);
  if (match) return latex;
  const normalized = latex.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\$/g, '').trim();
  return normalized ? `\\ce{${normalized}}` : '';
}

/* ══════════════════════════════════════════════════════════
   CKEditor inline widget plugin for MathLive rendering
   Uses createRawElement so CKEditor won't touch the DOM inside
══════════════════════════════════════════════════════════ */
class MathInlinePlugin extends Plugin {
  static get pluginName() {
    return 'MathInlinePlugin';
  }

  static get requires() {
    return [Widget];
  }

  init() {
    const editor = this.editor;

    // 1) Register model element — isObject: true treats it as one atomic block
    editor.model.schema.register('mathInline', {
      isInline: true,
      isObject: true,
      allowWhere: '$text',
      allowAttributes: ['latex'],
    });

    // Allow mathInline in all text-containing elements
    editor.model.schema.addChildCheck((context, childDefinition) => {
      if (childDefinition.name === 'mathInline') {
        return true;
      }
    });

    // 2) Editing downcast — what the user SEES in the editor
    //    createRawElement lets us manage the DOM ourselves (MathLive web component)
    editor.conversion.for('editingDowncast').elementToElement({
      model: 'mathInline',
      view: (modelElement, { writer }) => {
        const latex = modelElement.getAttribute('latex') || '';
        const widgetId = 'math-' + Math.random().toString(36).substr(2, 9);

        // Save mapping to bypass domConverter later
        window.__ckMathWidgets.set(widgetId, modelElement);

        const container = writer.createContainerElement('span', {
          class: 'ck-math-widget ck-math-inline-word',
          contenteditable: 'false',
          'data-math-id': widgetId,
          'data-latex': latex,
        });

        const rawElement = writer.createRawElement(
          'span',
          {
            class: 'ck-math-widget-inner',
            style: 'display:inline-block;vertical-align:middle;margin:0 2px;cursor:pointer;width:auto;max-width:100%;pointer-events:none;',
          },
          (domElement) => {
            const mf = document.createElement('math-field');
            mf.setAttribute('read-only', '');
            mf.setAttribute('math-virtual-keyboard-policy', 'manual');
            mf.setAttribute('tabindex', '-1');
            mf.style.display = 'inline-block';
            mf.style.width = 'auto';
            mf.style.maxWidth = '100%';
            mf.style.verticalAlign = 'middle';
            mf.style.border = 'none';
            mf.style.background = 'transparent';
            mf.style.outline = 'none';
            mf.style.fontSize = 'inherit';
            mf.style.minHeight = 'auto';
            mf.style.padding = '0 2px';
            mf.style.margin = '0';
            mf.style.pointerEvents = 'none';

            const setLatex = () => {
              if (mf.setValue) mf.setValue(latex, { silenceNotifications: true });
              else mf.value = latex;
            };

            if (customElements.get('math-field')) {
              requestAnimationFrame(setLatex);
            } else {
              customElements.whenDefined('math-field').then(() => requestAnimationFrame(setLatex));
            }

            domElement.appendChild(mf);

            const bindContainer = () => {
              const container = domElement.parentElement;
              if (!container) return;
              bindWidgetClickTarget(editor, container);
            };

            bindContainer();
            requestAnimationFrame(bindContainer);
          }
        );

        writer.insert(writer.createPositionAt(container, 0), rawElement);

        return toWidget(container, writer, { label: 'math formula' });
      },
    });

    const viewDocument = editor.editing.view.document;
    this.listenTo(viewDocument, 'mousedown', (evt, data) => {
      const widgetEl = findMathWidgetFromEventTarget(data.domTarget);
      if (!widgetEl) return;
      if (data.domEvent.button !== 0) return;

      evt.stop();
      data.preventDefault();
      triggerWidgetEdit(
        editor,
        null,
        getLatexFromWidgetDom(widgetEl),
        widgetEl
      );
    }, { priority: 'high' });

    // 3) Data downcast — what getData() returns (HTML output)
    editor.conversion.for('dataDowncast').elementToElement({
      model: 'mathInline',
      view: (modelElement, { writer }) => {
        const latex = modelElement.getAttribute('latex') || '';
        const span = writer.createContainerElement('span', {
          class: 'math-tex',
          'data-latex': latex,
          style: 'display:inline;',
        });
        writer.insert(writer.createPositionAt(span, 0), writer.createText(latex));
        return span;
      },
    });

    // 4) Upcast — recognize HTML from getData() and convert back to model
    editor.conversion.for('upcast').elementToElement({
      view: {
        name: 'span',
        classes: 'math-tex',
      },
      model: (viewElement, { writer }) => {
        const latex = viewElement.getAttribute('data-latex') || '';
        return writer.createElement('mathInline', { latex });
      },
    });
  }
}

/* ══════════════════════════════════════════════════════════
   Toolbar buttons plugin — Math + Chem
══════════════════════════════════════════════════════════ */
/* SVG icons for toolbar — matches the MathType / ChemType icons */
const MATH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path d="M4 12h3l3 6l5-12h5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CHEM_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor" font-family="system-ui, sans-serif">C</text><text x="6" y="8" font-size="4" font-weight="bold" fill="currentColor" font-family="system-ui, sans-serif">6</text></svg>';

function makeToolbarPlugin(onOpenPopup) {
  return class MathChemToolbarPlugin extends Plugin {
    init() {
      const editor = this.editor;

      editor.ui.componentFactory.add('mathType', () => {
        const btn = new ButtonView();
        btn.set({ label: 'Math', icon: MATH_ICON_SVG, tooltip: 'Insert Math Formula' });
        btn.on('execute', () => onOpenPopup('math'));
        return btn;
      });

      editor.ui.componentFactory.add('chemType', () => {
        const btn = new ButtonView();
        btn.set({ label: 'Chemistry', icon: CHEM_ICON_SVG, tooltip: 'Insert Chemistry Formula' });
        btn.on('execute', () => onOpenPopup('chem'));
        return btn;
      });
    }
  };
}

/* ══════════════════════════════════════════════════════════
   MathChemPopup — same as CustomMathEditor popup
══════════════════════════════════════════════════════════ */
function MatrixHoverGrid({ matrixType, x, y, onSelect, onMouseEnter, onMouseLeave }) {
  const [hoverGrid, setHoverGrid] = useState({ r: 2, c: 2 });
  const labelMap = {
    matrix: 'Plain Matrix',
    bmatrix: 'Square Matrix',
    pmatrix: 'Parenthesis Matrix',
    vmatrix: 'Vertical Matrix'
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(hoverGrid.r, hoverGrid.c);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hoverGrid.r, hoverGrid.c, onSelect]);

  return (
    <div
      className="cme-matrix-hover-popover ck-only"
      style={{ top: `${y}px`, left: `${x}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="cme-matrix-hover-grid">
        {Array.from({ length: 6 }).map((_, rIndex) => (
          <div key={rIndex} className="cme-matrix-hover-row">
            {Array.from({ length: 6 }).map((_, cIndex) => {
              const isSelected = rIndex < hoverGrid.r && cIndex < hoverGrid.c;
              return (
                <div
                  key={`${rIndex}-${cIndex}`}
                  className={`cme-matrix-hover-cell${isSelected ? ' selected' : ''}`}
                  onMouseEnter={() => setHoverGrid({ r: rIndex + 1, c: cIndex + 1 })}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(rIndex + 1, cIndex + 1);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="cme-matrix-hover-footer">
        <div className="cme-matrix-counter">
          <span>R</span>
          <span className="cme-counter-val">{hoverGrid.r}</span>
          <div className="cme-counter-btns">
            <button type="button" onClick={() => setHoverGrid(prev => ({ ...prev, r: Math.min(10, prev.r + 1) }))}>▲</button>
            <button type="button" onClick={() => setHoverGrid(prev => ({ ...prev, r: Math.max(1, prev.r - 1) }))}>▼</button>
          </div>
        </div>
        <div className="cme-matrix-counter">
          <span>C</span>
          <span className="cme-counter-val">{hoverGrid.c}</span>
          <div className="cme-counter-btns">
            <button type="button" onClick={() => setHoverGrid(prev => ({ ...prev, c: Math.min(10, prev.c + 1) }))}>▲</button>
            <button type="button" onClick={() => setHoverGrid(prev => ({ ...prev, c: Math.max(1, prev.c - 1) }))}>▼</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MathChemPopup — same as CustomMathEditor popup
   ══════════════════════════════════════════════════════════ */
function MathChemPopup({ mode, onInsert, onClose, initialLatex, isEditing }) {
  const popupMfRef = useRef(null);
  const [activeGroup, setActiveGroup] = useState(0);
  const [activeMatrix, setActiveMatrix] = useState(null); // { type, x, y }
  const [showSpecialChars, setShowSpecialChars] = useState(null); // { x, y } or null
  const [showColorPicker, setShowColorPicker] = useState(null); // { x, y } or null
  const groups = mode === 'math' ? MATH_GROUPS : CHEM_GROUPS;

  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    color: 'none',
    fontFamily: 'none',
    fontSize: 'auto'
  });

  const updateActiveStyles = useCallback(() => {
    const mf = popupMfRef.current;
    if (!mf || typeof mf.queryStyle !== 'function') return;
    try {
      const bold = (
        mf.queryStyle({ fontSeries: 'b' }) === 'all' ||
        mf.queryStyle({ variantStyle: 'bold' }) === 'all'
      );

      const currentFont = ['roman', 'sans-serif', 'monospace'].find(
        (f) => mf.queryStyle({ fontFamily: f }) === 'all'
      ) || 'none';

      const currentSize = [5, 7, 9].find(
        (sz) => mf.queryStyle({ fontSize: sz }) === 'all'
      ) || 'auto';

      const currentColor = [
        'black', 'dimgray', 'gray', 'darkgray', 'silver', 'white',
        'red', 'orange', 'yellow', 'lime', 'cyan', 'blue',
        'purple', 'magenta', 'pink', 'brown', 'maroon', 'olive',
        'green', 'teal', 'navy', 'indigo', 'violet', 'gold'
      ].find(
        (c) => mf.queryStyle({ color: c }) === 'all'
      ) || 'none';

      setActiveStyles({
        bold,
        fontFamily: currentFont,
        fontSize: String(currentSize),
        color: currentColor,
      });
    } catch (e) {
      console.warn("Failed to query active styles:", e);
    }
  }, []);


  useEffect(() => {
    if (!activeMatrix && !showColorPicker) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.cme-matrix-hover-popover') && !e.target.closest('.cme-matrix-btn-wrapper')) {
        setActiveMatrix(null);
      }
      if (!e.target.closest('.cme-color-picker-popup') && !e.target.closest('[title="Text Color"]')) {
        setShowColorPicker(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick, true);
      window.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [activeMatrix, showColorPicker]);

  useEffect(() => {
    const mf = popupMfRef.current;
    if (!mf) return;
    mf.defaultMode = mode === 'chem' ? 'text' : 'math';

    // Pre-fill with existing value when editing
    const prefill = () => {
      if (initialLatex) {
        // For chem, unwrap \ce{...} so user edits raw content
        let valueToSet = initialLatex;
        if (mode === 'chem') {
          const ceMatch = valueToSet.match(/^\\ce\{([\s\S]*)\}$/);
          if (ceMatch) valueToSet = ceMatch[1];
        }
        if (mf.setValue) mf.setValue(valueToSet, { silenceNotifications: true });
        else mf.value = valueToSet;
      }
      requestAnimationFrame(() => mf.focus());
    };

    if (customElements.get('math-field')) {
      requestAnimationFrame(prefill);
    } else {
      customElements.whenDefined('math-field').then(() => requestAnimationFrame(prefill));
    }
  }, [mode, initialLatex]);

  useEffect(() => {
    const mf = popupMfRef.current;
    if (!mf) return;
    const handleKeyDown = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        mf.executeCommand(['insert', '\\, ']);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        mf.executeCommand(['insert', '\\\\']);
        // Re-apply active styles on new line
        setTimeout(() => {
          if (typeof mf.applyStyle === 'function') {
            if (activeStyles.bold) {
              mf.applyStyle({
                variantStyle: 'bold',
                fontSeries: 'b'
              });
            }
            if (activeStyles.color !== 'none') {
              mf.applyStyle({ color: activeStyles.color });
            }
            if (activeStyles.fontFamily !== 'none') {
              mf.applyStyle({ fontFamily: activeStyles.fontFamily });
            }
            if (activeStyles.fontSize !== 'auto') {
              mf.applyStyle({
                fontSize: parseInt(activeStyles.fontSize, 10),
                size: parseInt(activeStyles.fontSize, 10)
              });
            }
            updateActiveStyles();
          }
        }, 10);
      }
    };
    mf.addEventListener('keydown', handleKeyDown);
    return () => mf.removeEventListener('keydown', handleKeyDown);
  }, [mode, activeStyles, updateActiveStyles]);



  /* ── Auto-scroll caret into view ── */
  useEffect(() => {
    const popupMf = popupMfRef.current;
    if (!popupMf) return;

    const handleSelectionChange = () => {
      // Small timeout to let MathLive update the DOM caret position first
      setTimeout(() => {
        const shadow = popupMf.shadowRoot;
        if (!shadow) return;
        const caret = shadow.querySelector('.ML__caret') || shadow.querySelector('[class*="caret"]');
        if (caret) {
          caret.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        }
        updateActiveStyles();
      }, 0);
    };

    popupMf.addEventListener('selection-change', handleSelectionChange);
    popupMf.addEventListener('input', handleSelectionChange);
    popupMf.addEventListener('keydown', handleSelectionChange);

    // Initial check
    setTimeout(updateActiveStyles, 50);

    return () => {
      popupMf.removeEventListener('selection-change', handleSelectionChange);
      popupMf.removeEventListener('input', handleSelectionChange);
      popupMf.removeEventListener('keydown', handleSelectionChange);
    };
  }, [updateActiveStyles]);

  const insertAtCursor = useCallback((sym) => {
    const mf = popupMfRef.current;
    if (!mf) return;
    mf.focus();
    mf.executeCommand(['insert', sym]);
  }, []);

  const handleMatrixInsert = useCallback((type, rows, cols) => {
    let latex = `\\begin{${type}} `;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        latex += '#?';
        if (j < cols - 1) latex += ' & ';
      }
      if (i < rows - 1) latex += ' \\\\ ';
    }
    latex += ` \\end{${type}}`;
    insertAtCursor(latex);
  }, [insertAtCursor]);

  const handleInsert = () => {
    const mf = popupMfRef.current;
    if (!mf) return;
    let latex = mf.getValue ? mf.getValue() : mf.value;
    if (!latex || latex.trim() === '') { onClose(); return; }
    if (mode === 'chem') latex = serializeChemValue(latex);
    onInsert(latex);
    if (mf.setValue) mf.setValue(''); else mf.value = '';
    onClose();
  };

  return (
    <div className="cme-editor-popup" onMouseDown={(e) => e.stopPropagation()}>
      <div className="cme-popup-header">
        <span>{isEditing ? (mode === 'math' ? 'Edit Math Formula' : 'Edit Chemistry Formula') : (mode === 'math' ? 'Math Editor' : 'Chemistry Editor')}</span>
        <button type="button" className="cme-popup-close" onClick={onClose}>×</button>
      </div>

      <div className="cme-toolbar" role="toolbar" aria-label="Symbol palette">
        <div className="cme-toolbar-groups">
          {groups.map((group, index) => (
            <button
              key={group.label}
              className={`cme-group-tab${activeGroup === index ? ' active' : ''}`}
              type="button"
              onClick={() => {
                setActiveGroup(index);
                setActiveMatrix(null);
              }}
            >
              {group.label}
            </button>
          ))}
        </div>

        <div className="cme-toolbar-items">
          {(() => {
            const activeItems = groups[activeGroup]?.items || [];

            // Subgroups support: split by { type: 'sep' }
            const hasSep = activeItems.some(item => item.type === 'sep');
            const subgroups = [];

            if (hasSep) {
              let currentSub = { cols: 2, items: [] };
              for (const item of activeItems) {
                if (item.type === 'sep') {
                  if (currentSub.items.length > 0) {
                    subgroups.push(currentSub);
                  }
                  currentSub = { cols: item.cols || 2, items: [] };
                } else {
                  currentSub.items.push(item);
                }
              }
              if (currentSub.items.length > 0) {
                subgroups.push(currentSub);
              }
            } else {
              // Legacy grouping for tabs without explicit separators (chunk by 4 items = 2x2 grid)
              const size = 4;
              for (let i = 0; i < activeItems.length; i += size) {
                subgroups.push({
                  cols: 2,
                  items: activeItems.slice(i, i + size)
                });
              }
            }

            return subgroups.map((subgroup, chunkIndex) => (
              <div
                key={chunkIndex}
                className="cme-symbol-subgroup"
                style={{ gridTemplateColumns: `repeat(${subgroup.cols}, auto)` }}
              >
                {subgroup.items.map((item, i) => {
                  const currentGroup = groups[activeGroup];
                  if (item.type === 'dropdown') {
                    const isFont = item.label === 'Font...';
                    const isSize = item.label === 'Size';

                    const isFontActive = isFont && activeStyles.fontFamily !== 'none';
                    const isSizeActive = isSize && activeStyles.fontSize !== 'auto' && activeStyles.fontSize !== '5';

                    const selectValue = isFont
                      ? (activeStyles.fontFamily === 'none' ? '' : activeStyles.fontFamily)
                      : (isSize
                        ? (activeStyles.fontSize === 'auto' || activeStyles.fontSize === '5' ? '' : activeStyles.fontSize)
                        : '');

                    return (
                      <select
                        key={i}
                        className={`cme-btn template${isFontActive || isSizeActive ? ' active' : ''}`}
                        value={selectValue}
                        style={{
                          width: item.width || '60px',
                          height: '18px',
                          minHeight: '18px',
                          maxHeight: '18px',
                          lineHeight: '18px',
                          boxSizing: 'border-box',
                          marginTop: "10px",
                          fontSize: '10px',
                          padding: '0',
                          margin: '2px 0',
                          gridColumn: (subgroup.cols === 3) ? 'span 1' : ((subgroup.cols === 1) ? 'span 1' : 'span 2')
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          const mf = popupMfRef.current;
                          if (!mf || typeof mf.applyStyle !== 'function') return;
                          mf.focus();
                          if (isFont) {
                            mf.applyStyle({ fontFamily: val || 'none' });
                          } else if (isSize) {
                            mf.applyStyle({ fontSize: val ? parseInt(val, 10) : 'auto' });
                          }
                          updateActiveStyles();
                        }}
                      >
                        <option value="">{item.label}</option>
                        {isFont && (
                          <>
                            <option value="roman">Times</option>
                            <option value="sans-serif">Helvetica</option>
                            <option value="monospace">Courier</option>
                          </>
                        )}
                        {isSize && (
                          <>
                            <option value="5">12px</option>
                            <option value="7">16px</option>
                            <option value="9">20px</option>
                          </>
                        )}
                      </select>
                    );
                  }

                  if (currentGroup.isMatrix && !item.directInsert) {
                    return (
                      <div
                        key={i}
                        className="cme-matrix-btn-wrapper"
                      >
                        <button
                          type="button"
                          className={`cme-btn template${item.cls ? ` ${item.cls}` : ''}`}
                          title={item.insert}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (activeMatrix?.type === item.insert) {
                              setActiveMatrix(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setActiveMatrix({
                                type: item.insert,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom
                              });
                            }
                          }}
                        >
                          {item.label}
                        </button>
                      </div>
                    );
                  }

                  const isBoldBtn = item.action === 'BOLD';
                  const isColorBtn = item.action === 'TEXT_COLOR';
                  const isBtnActive = (isBoldBtn && activeStyles.bold) || (isColorBtn && activeStyles.color !== 'none' && activeStyles.color !== 'black');

                  return (
                    <button
                      key={`${currentGroup.label}-${chunkIndex * 4 + i}`}
                      type="button"
                      className={`cme-btn${currentGroup.isTemplate ? ' template' : ''}${item.cls ? ` ${item.cls}` : ''}${isBtnActive ? ' active' : ''}`}
                      title={item.title || item.insert}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const mf = popupMfRef.current;
                        if (item.action === 'SPECIAL_CHARS') {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setShowSpecialChars({ x: rect.left, y: rect.bottom + 4 });
                        } else if (item.action === 'TEXT_COLOR') {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setShowColorPicker({ x: rect.left, y: rect.bottom + 4 });
                        } else if (item.action === 'BOLD') {
                          if (mf && typeof mf.applyStyle === 'function') {
                            mf.focus();
                            mf.applyStyle({
                              variantStyle: activeStyles.bold ? '' : 'bold',
                              fontSeries: activeStyles.bold ? 'auto' : 'b'
                            });
                            updateActiveStyles();
                          }
                        } else if (item.action === 'UNDO') {
                          popupMfRef.current?.executeCommand('undo');
                        } else if (item.action === 'REDO') {
                          popupMfRef.current?.executeCommand('redo');
                        } else {
                          insertAtCursor(item.insert);
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      </div>

      <div
        className="cme-mathfield-container"
        onMouseDown={(e) => {
          if (popupMfRef.current && (e.target === popupMfRef.current || popupMfRef.current.contains(e.target))) return;
          e.preventDefault();
          requestAnimationFrame(() => { popupMfRef.current?.focus?.(); });
        }}
      >
        <math-field
          ref={popupMfRef}
          class="cme-mathfield"
          tabIndex={0}
          math-virtual-keyboard-policy="manual"
          placeholder={mode === 'math' ? '' : ''}
        />
      </div>

      <div className="cme-popup-footer">

        <button type="button" className="cme-insert-btn" onClick={handleInsert}>
          {isEditing ? 'Update' : 'Insert'}
        </button>
        <button type="button" className="cme-cancel-btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      {activeMatrix && (
        <MatrixHoverGrid
          matrixType={activeMatrix.type}
          x={activeMatrix.x}
          y={activeMatrix.y}
          onSelect={(r, c) => {
            handleMatrixInsert(activeMatrix.type, r, c);
            setActiveMatrix(null);
          }}
          onMouseEnter={() => { }}
          onMouseLeave={() => { }}
        />
      )}

      {showSpecialChars && createPortal(
        <SpecialCharacterModal
          isOpen={!!showSpecialChars}
          position={showSpecialChars}
          onClose={() => setShowSpecialChars(null)}
          onInsert={(char) => {
            insertAtCursor(char);
            setShowSpecialChars(null);
          }}
        />,
        document.body
      )}

      {showColorPicker && createPortal(
        <div
          className="cme-color-picker-popup"
          style={{
            position: 'fixed',
            left: Math.min(showColorPicker.x, window.innerWidth - 160) + 'px',
            top: Math.min(showColorPicker.y, window.innerHeight - 100) + 'px',
            zIndex: 100000, background: '#fff', border: '1px solid #ccc', padding: '6px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
          }}
        >
          {[
            'black', 'dimgray', 'gray', 'darkgray', 'silver', 'white',
            'red', 'orange', 'yellow', 'lime', 'cyan', 'blue',
            'purple', 'magenta', 'pink', 'brown', 'maroon', 'olive',
            'green', 'teal', 'navy', 'indigo', 'violet', 'gold'
          ].map(c => {
            const isColorSelected = activeStyles.color === c || (c === 'black' && (activeStyles.color === 'none' || !activeStyles.color));
            return (
              <div
                key={c}
                title={c}
                style={{
                  width: '16px',
                  height: '16px',
                  backgroundColor: c,
                  cursor: 'pointer',
                  border: isColorSelected ? '2px solid #e6c229' : '1px solid #000',
                  boxSizing: 'border-box'
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const mf = popupMfRef.current;
                  if (mf && typeof mf.applyStyle === 'function') {
                    mf.focus();
                    mf.applyStyle({ color: c === 'black' ? 'none' : c });
                    updateActiveStyles();
                  }
                  setShowColorPicker(null);
                }}
              />
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   LaTeX → Unicode plain-text converter
   Converts LaTeX notation to readable Unicode so CKEditor
   treats each character individually (backspace works per-char)
══════════════════════════════════════════════════════════ */
function latexToPlainText(latex) {
  let text = latex;

  // Unwrap \ce{...}
  const ceMatch = text.match(/^\\ce\{([\s\S]*)\}$/);
  if (ceMatch) text = ceMatch[1];

  // Sort replacements longest-first to avoid partial matches
  const replacements = [
    // Greek lowercase
    ['\\varepsilon', 'ε'], ['\\varphi', 'φ'],
    ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'],
    ['\\epsilon', 'ε'], ['\\zeta', 'ζ'], ['\\eta', 'η'], ['\\theta', 'θ'],
    ['\\iota', 'ι'], ['\\kappa', 'κ'], ['\\lambda', 'λ'], ['\\mu', 'μ'],
    ['\\nu', 'ν'], ['\\xi', 'ξ'], ['\\pi', 'π'], ['\\rho', 'ρ'],
    ['\\sigma', 'σ'], ['\\tau', 'τ'], ['\\upsilon', 'υ'], ['\\phi', 'φ'],
    ['\\chi', 'χ'], ['\\psi', 'ψ'], ['\\omega', 'ω'],
    // Greek uppercase
    ['\\Gamma', 'Γ'], ['\\Delta', 'Δ'], ['\\Theta', 'Θ'], ['\\Lambda', 'Λ'],
    ['\\Xi', 'Ξ'], ['\\Pi', 'Π'], ['\\Sigma', 'Σ'], ['\\Upsilon', 'Υ'],
    ['\\Phi', 'Φ'], ['\\Psi', 'Ψ'], ['\\Omega', 'Ω'],
    // Operators
    ['\\pm', '±'], ['\\mp', '∓'], ['\\times', '×'], ['\\div', '÷'],
    ['\\cdot', '·'], ['\\neq', '≠'], ['\\leq', '≤'], ['\\geq', '≥'],
    ['\\approx', '≈'], ['\\equiv', '≡'], ['\\infty', '∞'],
    ['\\sum', '∑'], ['\\prod', '∏'], ['\\int', '∫'], ['\\oint', '∮'],
    ['\\iint', '∬'], ['\\iiint', '∭'], ['\\oiint', '∯'],
    ['\\partial', '∂'], ['\\nabla', '∇'],
    ['\\in', '∈'], ['\\notin', '∉'],
    ['\\subset', '⊂'], ['\\subseteq', '⊆'], ['\\supset', '⊃'], ['\\supseteq', '⊇'],
    ['\\cup', '∪'], ['\\cap', '∩'], ['\\emptyset', '∅'], ['\\setminus', '∖'],
    ['\\forall', '∀'], ['\\exists', '∃'], ['\\neg', '¬'],
    ['\\land', '∧'], ['\\lor', '∨'],
    // Arrows
    ['\\leftrightarrow', '↔'], ['\\Leftrightarrow', '⇔'],
    ['\\rightarrow', '→'], ['\\leftarrow', '←'],
    ['\\Rightarrow', '⇒'], ['\\Leftarrow', '⇐'],
    ['\\uparrow', '↑'], ['\\downarrow', '↓'],
    // Trig / log
    ['\\sin', 'sin'], ['\\cos', 'cos'], ['\\tan', 'tan'],
    ['\\cot', 'cot'], ['\\sec', 'sec'], ['\\csc', 'csc'],
    ['\\log', 'log'], ['\\ln', 'ln'], ['\\exp', 'exp'], ['\\lim', 'lim'],
    // Math sets
    ['\\mathbb{R}', 'ℝ'], ['\\mathbb{Z}', 'ℤ'], ['\\mathbb{N}', 'ℕ'], ['\\mathbb{Q}', 'ℚ'],
    ['\\mathbb{C}', 'ℂ'],
    // Delimiters
    ['\\left(', '('], ['\\right)', ')'],
    ['\\left[', '['], ['\\right]', ']'],
    ['\\left|', '|'], ['\\right|', '|'],
    ['\\left\\{', '{'], ['\\right\\}', '}'],
    // Spacing
    ['\\,', ' '], ['\\;', ' '], ['\\quad', ' '], ['\\qquad', '  '],
    // Misc
    ['\\prime', '′'], ['\\cdots', '⋯'], ['\\ldots', '…'],
  ];

  for (const [cmd, char] of replacements) {
    const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'g'), char);
  }

  // \frac{a}{b} → a/b
  text = text.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');

  // \sqrt[n]{x} → ⁿ√(x)  and  \sqrt{x} → √(x)
  text = text.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, '$1√($2)');
  text = text.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');

  // \vec{x} → x⃗  \hat{x} → x̂  \bar{x} → x̄  \dot{x} → ẋ  \ddot{x} → ẍ
  text = text.replace(/\\vec\{([^}]*)\}/g, '$1\u20D7');
  text = text.replace(/\\hat\{([^}]*)\}/g, '$1\u0302');
  text = text.replace(/\\bar\{([^}]*)\}/g, '$1\u0304');
  text = text.replace(/\\ddot\{([^}]*)\}/g, '$1\u0308');
  text = text.replace(/\\dot\{([^}]*)\}/g, '$1\u0307');

  // \text{...} → content
  text = text.replace(/\\text\{([^}]*)\}/g, '$1');

  // \begin{pmatrix}...\end{pmatrix} → [a, b; c, d]
  text = text.replace(/\\begin\{pmatrix\}([\s\S]*?)\\end\{pmatrix\}/g, (_, c) =>
    '[' + c.replace(/\\\\/g, '; ').replace(/&/g, ', ').trim() + ']'
  );

  // Superscripts ^{content}
  const supMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ' };
  text = text.replace(/\^\{([^}]*)\}/g, (_, content) =>
    content.split('').map(c => supMap[c] || c).join('')
  );
  text = text.replace(/\^([a-zA-Z0-9])/g, (_, c) => supMap[c] || c);

  // Subscripts _{content}
  const subMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'i': 'ᵢ', 'j': 'ⱼ', 'n': 'ₙ' };
  text = text.replace(/_\{([^}]*)\}/g, (_, content) =>
    content.split('').map(c => subMap[c] || c).join('')
  );
  text = text.replace(/_([a-zA-Z0-9])/g, (_, c) => subMap[c] || c);

  // Chem arrows
  text = text.replace(/->/g, '→');
  text = text.replace(/<=>/g, '⇌');

  // Clean up remaining LaTeX
  text = text.replace(/\\[a-zA-Z]+/g, '');   // remove unknown commands
  text = text.replace(/[{}]/g, '');           // remove remaining braces
  text = text.replace(/\s+/g, ' ');           // normalize whitespace
  text = text.replace(/\\\\/g, '\n');         // line breaks

  return text.trim();
}

/* ══════════════════════════════════════════════════════════
   Main CkEditor component
══════════════════════════════════════════════════════════ */
function CkEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const popupOpenRef = useRef(false);
  const [popup, setPopup] = useState(null);        // 'math' | 'chem' | null
  const [editingWidget, setEditingWidget] = useState(null); // { modelElement, latex } when editing existing widget

  useEffect(() => {
    popupOpenRef.current = !!popup;
  }, [popup]);

  useEffect(() => () => {
    window.__ckMathWidgetClickHandler = null;
  }, []);

  const openPopup = useCallback((mode) => {
    setEditingWidget(null); // toolbar button = fresh insert
    popupOpenRef.current = true;
    setPopup(mode);
  }, []);

  const closePopup = useCallback(() => {
    popupOpenRef.current = false;
    setPopup(null);
    setEditingWidget(null);

    // Clear the selection so that clicking the widget again registers as a change
    const editor = editorRef.current;
    if (editor) {
      editor.model.change(writer => {
        writer.setSelection(null);
      });
    }
  }, []);

  const [insertAsUnicode, setInsertAsUnicode] = useState(false);



  /* Insert new OR update existing widget */
  const handleInsert = useCallback((latex) => {
    const editor = editorRef.current;
    if (!editor || !latex?.trim()) return;

    if (editingWidget) {
      const targetModel = isModelElementLive(editor, editingWidget.modelElement)
        ? editingWidget.modelElement
        : null;

      if (targetModel) {
        // ── EDIT MODE: replace widget so the math-field re-renders with new latex ──
        editor.model.change((writer) => {
          const mathElement = writer.createElement('mathInline', { latex: latex.trim() });
          const position = writer.createPositionBefore(targetModel);
          writer.insert(mathElement, position);
          writer.remove(targetModel);
          writer.setSelection(writer.createPositionAfter(mathElement));
        });
      } else {
        // Fallback: insert updated value at cursor if model reference was lost
        editor.model.change((writer) => {
          const mathElement = writer.createElement('mathInline', { latex: latex.trim() });
          editor.model.insertContent(mathElement);
        });
      }
      setEditingWidget(null);
    } else if (insertAsUnicode) {
      const plainText = latexToPlainText(latex.trim());
      if (!plainText) return;

      editor.model.change((writer) => {
        const text = writer.createText(plainText);
        editor.model.insertContent(text);
      });
    } else {
      editor.model.change((writer) => {
        const mathElement = writer.createElement('mathInline', { latex: latex.trim() });
        editor.model.insertContent(mathElement);
        editor.model.insertContent(writer.createText(' '));
      });
    }

    editor.editing.view.focus();
  }, [insertAsUnicode, editingWidget]);

  const ToolbarPlugin = useMemo(() => makeToolbarPlugin(openPopup), [openPopup]);

  const handleEditorReady = useCallback((editor) => {
    editorRef.current = editor;

    const openEditPopup = (modelElement, latex) => {
      if (popupOpenRef.current || !latex) return;

      const isChem = /^\\ce\{/.test(latex);
      popupOpenRef.current = true;
      setEditingWidget({ modelElement, latex });
      setPopup(isChem ? 'chem' : 'math');
    };

    editor.mathWidgetClickHandler = openEditPopup;
    window.__ckMathWidgetClickHandler = openEditPopup;

    const editable = editor.ui.getEditableElement();
    if (!editable || editable._ckMathClickAttached) return;
    editable._ckMathClickAttached = true;

    const onEditablePointerDown = (e) => {
      const widgetEl = findMathWidgetFromEventTarget(e.target);
      if (!widgetEl) return;
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      triggerWidgetEdit(editor, null, getLatexFromWidgetDom(widgetEl), widgetEl);
    };

    editable.addEventListener('mousedown', onEditablePointerDown, true);
    editable.addEventListener('click', onEditablePointerDown, true);
  }, []);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <style>{`
        .ck-powered-by { display: none !important; }
        .ck-math-widget {
          display: inline-block !important;
          position: relative !important;
          width: auto !important;
          max-width: 100% !important;
          cursor: pointer !important;
          vertical-align: middle !important;
        }
        .ck-math-widget::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 2;
          cursor: pointer;
        }
        .ck-math-widget .ck-math-widget-inner,
        .ck-math-widget math-field {
          display: inline-block !important;
          width: auto !important;
          max-width: 100% !important;
          pointer-events: none !important;
        }
        .ck-math-widget:hover,
        .ck-math-widget.ck-widget_selected { outline: 2px solid #0f766e; outline-offset: 1px; border-radius: 4px; }
      `}</style>

      {/* Insert Options Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 4px' }}>
        <label style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', width: 'auto', fontSize: '13px', color: 'var(--text)', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={insertAsUnicode}
            onChange={(e) => setInsertAsUnicode(e.target.checked)}
            style={{ width: '16px', minHeight: '16px', cursor: 'pointer', margin: 0 }}
          />
          <span>Insert as editable Unicode text (allows character-by-character deletion)</span>
        </label>
      </div>

      <CKEditor
        editor={ClassicEditor}
        data={value}
        onReady={handleEditorReady}
        config={{
          licenseKey: 'GPL',
          plugins: [
            Essentials, Bold, Italic, Underline, Paragraph, Heading,
            Table, TableToolbar, TableCellProperties, TableProperties,
            List, Link, Undo,
            MathInlinePlugin,
            ToolbarPlugin,
          ],
          toolbar: {
            items: [
              'heading', '|',
              'bold', 'italic', 'underline', '|',
              'bulletedList', 'numberedList', '|',
              'insertTable', '|',
              'link', '|',
              'mathType', 'chemType', '|',
              'undo', 'redo',
            ],
          },
          table: {
            contentToolbar: [
              'tableColumn', 'tableRow', 'mergeTableCells',
              'tableProperties', 'tableCellProperties',
            ],
          },
        }}
        onChange={(event, editor) => {
          if (onChange) onChange(editor.getData());
        }}
      />

      {popup && (
        <MathChemPopup
          mode={popup}
          onInsert={handleInsert}
          onClose={closePopup}
          initialLatex={editingWidget?.latex || ''}
          isEditing={!!editingWidget}
        />
      )}
    </div>
  );
}

export default CkEditor;