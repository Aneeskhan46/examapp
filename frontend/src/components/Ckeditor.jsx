import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBold, faItalic } from '@fortawesome/free-solid-svg-icons';

import OmegaIcon from "../assets/icons/omega.png";
import PaletteIcon from "../assets/icons/palette.png";

import { CKEditor } from '@ckeditor/ckeditor5-react';
import { initMathFieldCursorFix } from '../utils/mathFieldCursorFix.js';
import QuestionPreview from './QuestionPreview.jsx';
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
  isWidget,
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

/**
 * Strip \text{...} wrappers while respecting nested braces.
 * e.g. \text{\raisebox{-2.5px}{\,\,}} → \raisebox{-2.5px}{\,\,}
 */
function stripTextWrappers(latex) {
  let result = '';
  let i = 0;
  const needle = '\\text{';
  while (i < latex.length) {
    const pos = latex.indexOf(needle, i);
    if (pos === -1) {
      result += latex.slice(i);
      break;
    }
    result += latex.slice(i, pos);
    // Find matching closing brace with balanced counting
    let depth = 1;
    let j = pos + needle.length;
    while (j < latex.length && depth > 0) {
      if (latex[j] === '{') depth++;
      else if (latex[j] === '}') depth--;
      j++;
    }
    // Extract inner content (between the opening { and matching })
    result += latex.slice(pos + needle.length, j - 1);
    i = j;
  }
  return result;
}

/**
 * Strip MathLive's internally-added options from \enclose commands.
 * MathLive serializes \enclose{circle}[shadow="none", solid currentColor]{...}
 * but its own parser can't re-parse the [options] part, causing the entire 
 * expression to be displayed as raw text.
 * This strips: \enclose{type}[options]{content} → \enclose{type}{content}
 */
function stripEncloseOptions(latex) {
  // Use non-greedy .*? to match everything inside [...] including backslashes
  return latex.replace(/\\enclose\{([^}]*)\}\[.*?\]/g, '\\enclose{$1}');
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
    label: '√(□)',
    fontSize: "9px",
    mathLabel: '\\sqrt{\\square} \\, \\frac{#0}{#?}',
    items: [
      // 1. Root & Fraction Group (3 cols)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="2" width="18" height="20" rx="2" /><line x1="6" y1="32" x2="50" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="18" y="40" width="18" height="20" rx="2" /></svg>), insert: '\\frac{#0}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 34 L14 34 L20 50 L30 10 L54 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="36" y="18" width="16" height="20" rx="2" /></svg>), insert: '\\sqrt{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Root' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="5" y="16" width="18" height="20" rx="1" /><line x1="26" y1="50" x2="40" y2="18" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="38" y="34" width="18" height="20" rx="1" /></svg>), insert: '\\large \\nicefrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Text Fraction' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 36 L14 36 L20 50 L30 10 L56 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="12" y="16" width="8" height="12" rx="2" /><rect x="40" y="22" width="12" height="22" rx="2" /></svg>), insert: '\\sqrt[#?]{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Nth Root Fraction' },




      { type: 'sep', cols: 1 },
      // 8. Text Style Group (1 col)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="10" y="22" width="12" height="22" rx="2" /><rect x="28" y="10" width="12" height="22" rx="2" opacity="0.45" /></svg>), insert: '#0^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Superscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="10" y="10" width="12" height="22" rx="2" /><rect x="28" y="28" width="12" height="22" rx="2" opacity="0.45" /></svg>), insert: '#0_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Subscript' },




      { type: 'sep', cols: 2 },
      // 2. Brackets & Delimiters Group (2 cols)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12 Q8 32 18 52" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12 Q56 32 46 52" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left(#0\\right)', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Parentheses' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12H12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12H52V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left[#0\\right]', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Brackets' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" /><rect x="26" y="18" width="12" height="22" rx="2" /><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" /></svg>), insert: '\\left|#0\\right|', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'vertical bars' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M20 12C16 12 16 18 18 22C19 24 19 26 16 29C19 32 19 34 18 36C16 40 16 46 20 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M44 12C48 12 48 18 46 22C45 24 45 26 48 29C45 32 45 34 46 36C48 40 48 46 44 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>), insert: '\\left\\{#0\\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curly Braces' },
      // { label: '(□)', insert: '\\left(#0\\right)', title: 'Parentheses' },
      // { label: '[□]', insert: '\\left[#0\\right]', title: 'Square Brackets' },
      // { label: '|□|', insert: '\\left|#0\\right|', title: 'Absolute Value' },
      // { label: '{□}', insert: '\\left\\{#0\\right\\}', title: 'Curly Braces' },


      { type: 'sep', cols: 2, small: true },
      // 3. Basic Arithmetic Operators (2 cols × 3 rows)
      { label: '+', insert: '+', title: 'Plus' },
      { label: '/', insert: '/', title: 'Divide' },
      { label: '×', insert: '\\times', title: 'Multiply' },
      { label: '±', insert: '\\pm', title: 'Plus-minus' },
      { label: '−', insert: '-', title: 'Minus' },

      { label: '÷', insert: '\\div', title: 'Divide sign' },



      { type: 'sep', cols: 2, small: true },
      // 4. Comparison & Relation Operators (2 cols × 3 rows)
      { label: '≥', insert: '\\geq', title: 'Greater than or equal to' },
      { label: '≤', insert: '\\leq', title: 'Less than or equal to' },
      { label: '∈', insert: '\\in', title: 'Element of' },
      { label: '⊂', insert: '\\subset', title: 'Subset' },       // subset
      { label: '∪', insert: '\\cup', title: 'Union' },           // union
      { label: '∩', insert: '\\cap', title: 'Intersection' },           // intersection

      { type: 'sep', cols: 1, small: true },
      // 5. Greek Letters (1 col)
      { label: '∅', insert: '\\emptyset', title: 'Empty set' },      // empty set
      { label: '∞', insert: '\\infty', title: 'Infinity' },
      { label: 'π', insert: '\\pi', title: 'Pi' },

      { type: 'sep', cols: 1 },
      // 6. Undo / Redo (1 col)
      { label: '↶', action: 'UNDO', title: 'Undo' },
      { label: '↷', action: 'REDO', title: 'Redo' },

      { type: 'sep', cols: 2 },
      // 7. Formatting Group (2 cols)
      { label: <FontAwesomeIcon icon={faBold} />, action: 'BOLD', cls: 'template', title: 'Bold' },
      { label: <FontAwesomeIcon icon={faItalic} />, action: 'ITALIC', cls: 'template', title: 'Italic' },
      {
        label: (
          <img
            src={OmegaIcon}
            alt="Omega"
            width="18"
            height="18"
            style={{ display: 'block' }}
          />
        ), title: 'Insert Special Character', action: 'SPECIAL_CHARS'
      },

      {
        label: (
          <img
            src={PaletteIcon}
            alt="Palette"
            width="18"
            height="18"
            style={{ display: 'block' }}
          />
        ), action: 'TEXT_COLOR', title: 'Text Color'
      },



      { type: 'sep', cols: 1 },
      // 9. Font Controls (1 col)
      { type: 'dropdown', label: 'Font...' },
      { type: 'dropdown', label: 'Size' }
    ]
  },
  {
    label: '∈ ∞', items: [

      // Group 1 – Cancel (1 col × 1 row)
      { type: 'sep', cols: 1, small: true },
      { label: '⌿', insert: '\\cancel{#?}', isWidget: true, title: 'Cancel strike' },

      // Group 2 – Arithmetic (3 cols × 3 rows)
      {
        type: 'sep', cols: 3, small: true, moreItems: [

          { label: '∖', insert: '\\setminus', title: 'Set minus' },
          { label: '\\', insert: '\\backslash', title: 'Reverse solidus' },
          { label: '∓', insert: '\\mp', title: 'Minus or plus' },
        ]
      },
      { label: '+', insert: '+', title: 'Plus' },
      { label: '×', insert: '\\times', title: 'Multiply' },
      { label: '·', insert: '\\cdot', title: 'Dot product' },
      { label: '−', insert: '-', title: 'Minus' },
      { label: '÷', insert: '\\div', title: 'Divide sign' },
      { label: '/', insert: '/', title: 'Slash' },

      { label: '±', insert: '\\pm', title: 'Plus-minus' },

      { label: '*', insert: '\\ast', title: 'Asterisk' },
      { label: '○', insert: '\\circ', title: 'Circle' },


      // Group 3 – Constants & Symbols (3 cols × 3 rows)
      {
        type: 'sep', cols: 3, small: true, moreItems: [
          { label: '‴', insert: '\\prime\\prime\\prime', title: 'Triple prime' },
          { label: '⁗', insert: '\\prime\\prime\\prime\\prime', title: 'Quadruple prime' },
          { label: '‵', insert: '\\backprime', title: 'Reversed prime' },
        ]
      },
      { label: 'π', insert: '\\pi', title: 'Pi' },
      { label: '∂', insert: '\\partial', title: 'Partial derivative' },
      { label: '°', insert: '^\\circ', title: 'Degree' },
      { label: '∞', insert: '\\infty', title: 'Infinity' },
      { label: 'Δ', insert: '\\Delta', title: 'Delta' },
      { label: "'", insert: "'", title: 'Prime' },
      { label: '∅', insert: '\\emptyset', title: 'Empty set' },
      { label: '∇', insert: '\\nabla', title: 'Nabla / Gradient' },
      { label: "''", insert: "''", title: 'Double prime' },

      // Group 4 – Equality (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, moreCols: 2, small: true, moreItems: [
          { label: '≠', insert: '\\neq', title: 'Not equal' },
          { label: '≉', insert: '\\not\\approx', title: 'Not almost equal to' },
          { label: '≢', insert: '\\not\\equiv', title: 'Not identical to' },
          { label: '≁', insert: '\\not\\sim', title: 'Not similar' },
        ]
      },
      { label: '=', insert: '=', title: 'Equals' },
      { label: '≡', insert: '\\equiv', title: 'Equivalent' },
      { label: '∼', insert: '\\sim', title: 'Similar to' },

      { label: '≈', insert: '\\approx', title: 'Approximately equal' },
      { label: '≃', insert: '\\simeq', title: 'Asymptotically equal' },
      { label: '≅', insert: '\\cong', title: 'Congruent' },
      // Group 5 – Comparison (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 3, moreItems: [
          { label: '≨', insert: '\\lneqq', title: 'Less than but not equal to' },
          { label: '≫', insert: '\\gg', title: 'Much greater than' },
          { label: '≻', insert: '\\succ', title: 'Succeeds' },
          { label: '≩', insert: '\\gneqq', title: 'Greater than but not equal to' },
          { label: '∝', insert: '\\propto', title: 'Proportional to' },
          { label: '⊲', insert: '\\triangleleft', title: 'Normal subgroup of' },
          { label: '≪', insert: '\\ll', title: 'Much less than' },
          { label: '≺', insert: '\\prec', title: 'Precedes' },
          { label: '⊳', insert: '\\triangleright', title: 'Contains as normal subgroup' },
        ]
      },
      { label: '>', insert: '>', title: 'Greater than' },
      { label: '<', insert: '<', title: 'Less than' },
      { label: '≥', insert: '\\geq', title: 'Greater than or equal' },
      { label: '≤', insert: '\\leq', title: 'Less than or equal' },
      { label: '⩾', insert: '\\geqslant', title: 'Greater than or equal slant' },
      { label: '⩽', insert: '\\leqslant', title: 'Less than or equal slant' },

      // Group 6 – Set Theory (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 4, moreItems: [
          { label: '∉', insert: '\\notin', title: 'Not an element of' },
          { label: '∌', insert: '\\not\\ni', title: 'Does not contain as member' },

          { label: '⊆', insert: '\\subseteq', title: 'Subset of or equal to' },
          { label: '⊇', insert: '\\supseteq', title: 'Superset of or equal to' },

          { label: '⊏', insert: '\\sqsubset', title: 'Square image of' },
          { label: '⊐', insert: '\\sqsupset', title: 'Square original of' },

          { label: '⊑', insert: '\\sqsubseteq', title: 'Square image of or equal to' },
          { label: '⊒', insert: '\\sqsupseteq', title: 'Square original of or equal to' },

          { label: '⊓', insert: '\\sqcap', title: 'Square intersection' },
          { label: '⊔', insert: '\\sqcup', title: 'Square union' },
        ]
      },
      { label: '∈', insert: '\\in', title: 'Element of' },
      { label: '∋', insert: '\\ni', title: 'Contains as member' },
      { label: '∪', insert: '\\cup', title: 'Union' },
      { label: '∩', insert: '\\cap', title: 'Intersection' },
      { label: '⊂', insert: '\\subset', title: 'Subset' },
      { label: '⊃', insert: '\\supset', title: 'Superset' },


      // Group 7 – Logic (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 1, moreItems: [
          { label: '∴', insert: '\\therefore', title: 'Therefore' },
          { label: '∵', insert: '\\because', title: 'Because' },
        ]
      },
      { label: '∧', insert: '\\land', title: 'Logical AND' },
      { label: '∨', insert: '\\lor', title: 'Logical OR' },
      { label: '¬', insert: '\\neg', title: 'Logical NOT' },
      { label: '∀', insert: '\\forall', title: 'For all' },
      { label: '∃', insert: '\\exists', title: 'Exists' },
      { label: '∄', insert: '\\nexists', title: 'Does not exist' },

      // Group 8 – Geometry Lines (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 2, moreItems: [
          { label: '∦', insert: '\\nparallel', title: 'Not parallel to' },
          { label: '⋄', insert: '\\diamond', title: 'Diamond' },
          { label: '∡', insert: '\\measuredangle', title: 'Measured angle' },
          { label: '∢', insert: '\\sphericalangle', title: 'Spherical angle' }
        ]
      },
      { label: '∠', insert: '\\angle', title: 'Angle' },
      { label: '∥', insert: '\\parallel', title: 'Parallel' },
      { label: '⊥', insert: '\\perp', title: 'Perpendicular' },

      // Group 9 – Geometry Shapes (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 1, moreItems: [
          { label: '▭', insert: '▭', title: 'Rectangle' },
          { label: '▱', insert: '▱', title: 'Parallelogram' },
        ]
      },
      { label: '□', insert: '\\square', title: 'Square' },
      { label: '△', insert: '\\triangle', title: 'Triangle' },
      { label: '○', insert: '\\circ', title: 'Circle' },

      // Group 10 – Circle Ops (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 2, moreItems: [
          { label: '⊝', insert: '⊝', title: 'Circled dash' },
          { label: '•', insert: '\\bullet', title: 'Bullet' },
          { label: '⊛', insert: '⊛', title: 'Circled asterisk' },
          { label: '⨸', insert: '⨸', title: 'Circled division' },
        ]
      },
      { label: '⊕', insert: '\\oplus', title: 'Direct sum / Circled plus' },
      { label: '⊗', insert: '\\otimes', title: 'Tensor product / Circled times' },
      { label: '⊙', insert: '\\odot', title: 'Circled dot operator' },



    ]
  },
  {
    label: '→ ⋰', isTemplate: true, items: [
      {
        type: 'sep', cols: 3, small: true, cls: 'cme-trig-subgroup', moreCols: 11, moreItems: [
          { label: '↗', insert: '\\nearrow', title: 'North east arrow' },
          { label: '↘', insert: '\\searrow', title: 'South east arrow' },
          { label: '↖', insert: '\\nwarrow', title: 'North west arrow' },
          { label: '↙', insert: '\\swarrow', title: 'South west arrow' },

          { label: '⤡', insert: '\\nwsearrow', title: 'North west and south east arrow' },
          { label: '⤢', insert: '\\neswarrow', title: 'North east and south west arrow' },

          { label: '↩', insert: '\\hookleftarrow', title: 'Leftwards arrow with hook' },
          { label: '↪', insert: '\\hookrightarrow', title: 'Rightwards arrow with hook' },

          { label: '↼', insert: '\\leftharpoonup', title: 'Leftwards harpoon with barb upwards' },
          { label: '⇀', insert: '\\rightharpoonup', title: 'Rightwards harpoon with barb upwards' },

          { label: '↑', insert: '\\uparrow', title: 'Upwards arrow' },
          { label: '↓', insert: '\\downarrow', title: 'Downwards arrow' },

          { label: '⇑', insert: '\\Uparrow', title: 'Upwards double arrow' },
          { label: '⇓', insert: '\\Downarrow', title: 'Downwards double arrow' },

          { label: '⥪', insert: '⥪', title: 'Leftwards harpoon over dash' },
          { label: '⥭', insert: '⥭', title: 'Dash over rightwards harpoon' },
          { label: '⇋', insert: '\\leftrightharpoons', title: 'Leftwards harpoon over rightwards harpoon' },
          { label: '⇌', insert: '\\rightleftharpoons', title: 'Rightwards harpoon over leftwards harpoon' },

          { label: '↽', insert: '\\leftharpoondown', title: 'Leftwards harpoon with barb downwards' },
          { label: '⇁', insert: '\\rightharpoondown', title: 'Rightwards harpoon with barb downwards' },

          { label: '⇆', insert: '\\leftrightarrows', title: 'Leftwards arrow over rightwards arrow' },
          { label: '⇄', insert: '\\rightleftarrows', title: 'Rightwards arrow over leftwards arrow' },

          { label: '⇅', insert: '\\updownarrows', title: 'Upwards arrow leftwards of downwards arrow' },
          { label: '⇵', insert: '\\downuparrows', title: 'Downwards arrow leftwards of upwards arrow' },

          { label: '⥮', insert: '\\upharpoonleftdownharpoonright', title: 'Up harpoon left down harpoon right' },
          { label: '⥯', insert: '\\downharpoonleftupharpoonright', title: 'Down harpoon left up harpoon right' },


          { label: '⥂', insert: '⥂', title: 'Rightwards arrow over short leftwards arrow' },
          { label: '⥄', insert: '⥄', title: 'Short rightwards arrow over leftwards arrow' },


          { label: '↕', insert: '\\updownarrow', title: 'Up-down arrow' },
          { label: '⇕', insert: '\\Updownarrow', title: 'Up-down double arrow' },

          { label: '↵', insert: '\\hookleftarrow', title: 'Downwards arrow with corner leftwards' }
        ]
      },
      { label: '←', insert: '\\leftarrow', title: 'Left arrow' },
      { label: '→', insert: '\\rightarrow', title: 'Right arrow' },
      { label: '↔', insert: '\\leftrightarrow', title: 'Left-right arrow' },
      { label: '⇐', insert: '\\Leftarrow', title: 'Left double arrow' },
      { label: '⇒', insert: '\\Rightarrow', title: 'Right double arrow' },
      { label: '⇔', insert: '\\Leftrightarrow', title: 'Left-right double arrow' },
      { label: '↤', insert: '\\mapsfrom', title: 'Leftwards arrow from bar' },
      { label: '↦', insert: '\\mapsto', title: 'Rightwards arrow from bar' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup' },
      { label: '⋮', insert: '\\vdots', title: 'Vertical ellipses' },
      { label: '⋰', insert: '⋰', title: 'Upright diagonal ellipses' },
      { label: '…', insert: '\\ldots', title: 'Horizontal ellipses' },
      { label: '⋱', insert: '\\ddots', title: 'Down-right diagonal ellipses' },
      { label: '⋯', insert: '\\cdots', title: 'Middle line horizontal ellipses' },

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },
      { label: '-', insert: '-', title: 'Short dash (hyphen)' },
      { label: '–', insert: '–', title: 'En dash' },
      { label: '—', insert: '—', title: 'Em dash' },

      {
        type: 'sep', cols: 3, small: true, cls: 'cme-matrix-subgroup', moreCols: 11, moreItems: [

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="12" y1="38" x2="52" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 30L6 38L18 46V40H26V36H18V30Z" fill="#222" stroke="none" /><path d="M46 30L58 38L46 46V40H38V36H46V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="24" x2="52" y2="24" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 16L6 24L18 32V26H26V22H18V16Z" fill="#222" stroke="none" /><path d="M46 16L58 24L46 32V26H38V22H46V16Z" fill="#222" stroke="none" /><rect x="24" y="38" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrow[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 24L6 32L18 40V34H26V30H18V24Z" fill="#222" stroke="none" /><path d="M46 24L58 32L46 40V34H38V30H46V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Above and Below Labels' },

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="18" y1="30" x2="52" y2="30" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 22L12 30L24 38V32H34V28H24V22Z" fill="#222" stroke="none" /><line x1="12" y1="44" x2="46" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 36L52 44L40 52V46H30V42H40V36Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftrightarrows{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="18" y1="20" x2="52" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 12L12 20L24 28V22H34V18H24V12Z" fill="#222" stroke="none" /><line x1="12" y1="34" x2="46" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 26L52 34L40 42V36H30V32H40V26Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrows[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="18" y1="26" x2="52" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 18L12 26L24 34V28H34V24H24V18Z" fill="#222" stroke="none" /><line x1="12" y1="40" x2="46" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 32L52 40L40 48V42H30V38H40V32Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrows[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Above and Below Labels' },

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="40" x2="52" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 32L12 40L24 48V42H34V38H24V32Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="20" x2="46" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 12L52 20L40 28V22H30V18H40V12Z" fill="#222" stroke="none" /><line x1="18" y1="34" x2="52" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 26L12 34L24 42V36H34V32H24V26Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="40" x2="52" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 32L12 40L24 48V42H34V38H24V32Z" fill="#222" stroke="none" /><rect x="28" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\rightleftarrows}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Above and Below Labels' },


          //harpoons 1 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\xleftrightharpoons{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightharpoons[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightharpoons[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Above and Below Labels' },


          //harpoons 2
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\xrightleftharpoons{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xrightleftharpoons[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="28" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xrightleftharpoons[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Above and Below Labels' },


          //arrows 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Above and Below Labels' },


          //arrow 2 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Above and Below Labels' },
          //   // Right-left arrow
          //   { label: '↔̅', insert: '\\overset{#?}{\\leftrightarrow}', isWidget: true, title: 'Left-right arrow with overscript' },
          //   { label: '↔̲', insert: '\\underset{#?}{\\leftrightarrow}', isWidget: true, title: 'Left-right arrow with underscript' },
          //   { label: '↔̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightarrow}}', isWidget: true, title: 'Left-right arrow with under & overscript' },

          //   { label: '⇆̅', insert: '\\overset{#?}{\\leftrightarrows}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with overscript' },

          //   // Left arrow over right arrow
          //   { label: '⇆̲', insert: '\\underset{#?}{\\leftrightarrows}', isWidget: true, title: 'Left arrow over right arrow with underscript' },
          //   { label: '⇆̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightarrows}}', isWidget: true, title: 'Left arrow over right arrow with under & overscript' },

          //   // Right arrow over left arrow
          //   { label: '⇄̅', insert: '\\overset{#?}{\\rightleftarrows}', isWidget: true, title: 'Right arrow over left arrow with overscript' },
          //   { label: '⇄̲', insert: '\\underset{#?}{\\rightleftarrows}', isWidget: true, title: 'Right arrow over left arrow with underscript' },
          //   { label: '⇄̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightleftarrows}}', isWidget: true, title: 'Right arrow over left arrow with under & overscript' },

          //   // Left harpoon over right harpoon
          //   { label: '⇋̅', insert: '\\overset{#?}{\\leftrightharpoons}', isWidget: true, title: 'Left harpoon over right harpoon with overscript' },
          //   { label: '⇋̲', insert: '\\underset{#?}{\\leftrightharpoons}', isWidget: true, title: 'Left harpoon over right harpoon with underscript' },
          //   { label: '⇋̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightharpoons}}', isWidget: true, title: 'Left harpoon over right harpoon with under & overscript' },

          //   // Right harpoon over left harpoon
          //   { label: '⇌̅', insert: '\\overset{#?}{\\rightleftharpoons}', isWidget: true, title: 'Right harpoon over left harpoon with overscript' },
          //   { label: '⇌̲', insert: '\\underset{#?}{\\rightleftharpoons}', isWidget: true, title: 'Right harpoon over left harpoon with underscript' },
          //   { label: '⇌̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightleftharpoons}}', isWidget: true, title: 'Right harpoon over left harpoon with under & overscript' },

          //   // Rightwards arrow over short leftwards arrow
          //   { label: '⇄̅', insert: '\\overset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with overscript' },
          //   { label: '⇄̲', insert: '\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with underscript' },
          //   { label: '⇄̲̅', insert: '\\overset{#?}{\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with under & overscript' },

          //   // Short rightwards arrow over leftwards arrow
          //   { label: '⇆̅', insert: '\\overset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with overscript' },
          //   { label: '⇆̲', insert: '\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with underscript' },
          //   { label: '⇆̲̅', insert: '\\overset{#?}{\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with under & overscript' }

        ]
      },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="12" y1="38" x2="42" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 30L48 38L36 46V40H28V36H36V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with Label Above' },
      // { label: '→̅', insert: '\\overset{#?}{\\rightarrow}', title: 'Right arrow with overscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="20" x2="42" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 12L48 20L36 28V22H28V18H36V12Z" fill="#222" stroke="none" /><rect x="24" y="34" width="10" height="16" rx="2" /></svg>), insert: '\\xrightarrow[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with underscript' },
      // { label: '→̲', insert: '\\underset{#?}{\\rightarrow}', title: 'Right arrow with underscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="32" x2="42" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 24L48 32L36 40V34H28V30H36V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xrightarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with Above and Below Labels' },
      // { label: '→̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightarrow}}', title: 'Right arrow with under & overscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#222' }}><line x1="18" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 24L12 32L24 40V34H34V30H24V24Z" fill="#222" stroke="none" /></svg>), insert: '\\leftarrow', cls: 'symbol', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="18" y1="38" x2="52" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 30L12 38L24 46V40H34V36H24V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow with Label Above' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="18" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 24L12 32L24 40V34H34V30H24V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xleftarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow with Above and Below Labels' },
      // { label: '←̅', insert: '\\overset{#?}{\\leftarrow}', title: 'Left arrow with overscript' },
      // { label: '←̲', insert: '\\underset{#?}{\\leftarrow}', title: 'Left arrow with underscript' },
      // { label: '←̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftarrow}}', title: 'Left arrow with under & overscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="24" y1="14" x2="42" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 6L48 14L36 14" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overrightharpoon{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Right Harpoon' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="14" x2="48" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 6L10 14L22 22V16H28V12H22V6Z" fill="#222" stroke="none" /><path d="M42 6L54 14L42 22V16H34V12H42V6Z" fill="#222" stroke="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Left Right Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="20" y1="14" x2="42" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 6L48 14L36 22V16H30V12H36V6Z" fill="#222" stroke="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Right Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="20" y1="14" x2="44" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Overline' },
      // { label: '⇀', insert: '\\overrightharpoon{#?}', title: 'Left harpoon accent' },     // Left harpoon accent
      // { label: '↔', insert: '\\overleftrightarrow{#?}', title: 'Left-right arrow accent' },// Left-right arrow accent
      // { label: '→', insert: '\\overrightarrow{#?}', title: 'Right arrow accent' },     // Arrow accent (right arrow)
      // { label: '¯', insert: '\\overline{#?}', title: 'Bar accent' },           // Bar accent


    ]
  },
  {
    label: 'α Ω',
    isTemplate: true,
    items: [
      // Greek lowercase – 10 cols × 3 rows (25 items)
      {
        type: 'sep', cols: 10, small: true, cls: 'cme-dark-large', moreCols: 8, moreItems: [
          { label: 'Α', insert: 'A', title: 'Capital Alpha' },
          { label: 'Β', insert: 'B', title: 'Capital Beta' },
          { label: 'Γ', insert: '\\Gamma', title: 'Capital Gamma' },
          { label: 'Δ', insert: '\\Delta', title: 'Capital Delta' },
          { label: 'Ε', insert: 'E', title: 'Capital Epsilon' },
          { label: 'Ζ', insert: 'Z', title: 'Capital Zeta' },
          { label: 'Η', insert: 'H', title: 'Capital Eta' },
          { label: 'Θ', insert: '\\Theta', title: 'Capital Theta' },
          { label: 'Ι', insert: 'I', title: 'Capital Iota' },
          { label: 'Κ', insert: 'K', title: 'Capital Kappa' },
          { label: 'Λ', insert: '\\Lambda', title: 'Capital Lambda' },
          { label: 'Μ', insert: 'M', title: 'Capital Mu' },
          { label: 'Ν', insert: 'N', title: 'Capital Nu' },
          { label: 'Ξ', insert: '\\Xi', title: 'Capital Xi' },
          { label: 'Ο', insert: 'O', title: 'Capital Omicron' },
          { label: 'Π', insert: '\\Pi', title: 'Capital Pi' },
          { label: 'Ρ', insert: 'P', title: 'Capital Rho' },
          { label: 'Σ', insert: '\\Sigma', title: 'Capital Sigma' },
          { label: 'Τ', insert: 'T', title: 'Capital Tau' },
          { label: 'Υ', insert: '\\Upsilon', title: 'Capital Upsilon' },
          { label: 'Φ', insert: '\\Phi', title: 'Capital Phi' },
          { label: 'Χ', insert: 'X', title: 'Capital Chi' },
          { label: 'Ψ', insert: '\\Psi', title: 'Capital Psi' },
          { label: 'Ω', insert: '\\Omega', title: 'Capital Omega' }
        ]
      },
      { label: 'α', insert: '\\alpha', title: 'Alpha' },
      { label: 'β', insert: '\\beta', title: 'Beta' },
      { label: 'γ', insert: '\\gamma', title: 'Gamma' },
      { label: 'δ', insert: '\\delta', title: 'Delta' },
      { label: 'ε', insert: '\\epsilon', title: 'Epsilon' },
      { label: 'ζ', insert: '\\zeta', title: 'Zeta' },
      { label: 'η', insert: '\\eta', title: 'Eta' },
      { label: 'θ', insert: '\\theta', title: 'Theta' },
      { label: 'ϑ', insert: '\\vartheta', title: 'Vartheta' },
      { label: 'ι', insert: '\\iota', title: 'Iota' },
      { label: 'κ', insert: '\\kappa', title: 'Kappa' },
      { label: 'λ', insert: '\\lambda', title: 'Lambda' },
      { label: 'μ', insert: '\\mu', title: 'Mu' },
      { label: 'ν', insert: '\\nu', title: 'Nu' },
      { label: 'ξ', insert: '\\xi', title: 'Xi' },
      { label: 'ο', insert: 'o', title: 'Omicron' },
      { label: 'π', insert: '\\pi', title: 'Pi' },
      { label: 'ϖ', insert: '\\varpi', title: 'Varpi' },
      { label: 'ρ', insert: '\\rho', title: 'Rho' },
      { label: 'ϱ', insert: '\\varrho', title: 'Varrho' },
      { label: 'ς', insert: '\\varsigma', title: 'Varsigma' },
      { label: 'σ', insert: '\\sigma', title: 'Sigma' },
      { label: 'τ', insert: '\\tau', title: 'Tau' },
      { label: 'υ', insert: '\\upsilon', title: 'Upsilon' },
      { label: 'φ', insert: '\\phi', title: 'Phi' },
      { label: 'χ', insert: '\\chi', title: 'Chi' },
      { label: 'ψ', insert: '\\psi', title: 'Psi' },
      { label: 'ω', insert: '\\omega', title: 'Omega' },

      // Number sets – 2 cols × 1 row
      {
        type: 'sep', cols: 2, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝔸', insert: '\\mathbb{A}', title: 'Mathbb A' },
          { label: '𝔻', insert: '\\mathbb{D}', title: 'Mathbb D' },
          { label: '𝔾', insert: '\\mathbb{G}', title: 'Mathbb G' },
          { label: '𝕁', insert: '\\mathbb{J}', title: 'Mathbb J' },
          { label: '𝕄', insert: '\\mathbb{M}', title: 'Mathbb M' },
          { label: 'ℙ', insert: '\\mathbb{P}', title: 'Mathbb P' },
          { label: '𝕊', insert: '\\mathbb{S}', title: 'Mathbb S' },
          { label: '𝕍', insert: '\\mathbb{V}', title: 'Mathbb V' },
          { label: '𝕐', insert: '\\mathbb{Y}', title: 'Mathbb Y' },
          // Small letters Row 1
          { label: '𝕒', insert: '𝕒', title: 'Mathbb a' },
          { label: '𝕕', insert: '𝕕', title: 'Mathbb d' },
          { label: '𝕘', insert: '𝕘', title: 'Mathbb g' },
          { label: '𝕛', insert: '𝕛', title: 'Mathbb j' },
          { label: '𝕞', insert: '𝕞', title: 'Mathbb m' },
          { label: '𝕡', insert: '𝕡', title: 'Mathbb p' },
          { label: '𝕤', insert: '𝕤', title: 'Mathbb s' },
          { label: '𝕧', insert: '𝕧', title: 'Mathbb v' },
          { label: '𝕪', insert: '𝕪', title: 'Mathbb y' },

          // --- Row 2 ---
          { label: '𝔹', insert: '\\mathbb{B}', title: 'Mathbb B' },
          { label: '𝔼', insert: '\\mathbb{E}', title: 'Mathbb E' },
          { label: 'ℍ', insert: '\\mathbb{H}', title: 'Mathbb H' },
          { label: '𝕂', insert: '\\mathbb{K}', title: 'Mathbb K' },
          { label: 'ℕ', insert: '\\mathbb{N}', title: 'Mathbb N' },
          { label: 'ℚ', insert: '\\mathbb{Q}', title: 'Mathbb Q' },
          { label: '𝕋', insert: '\\mathbb{T}', title: 'Mathbb T' },
          { label: '𝕎', insert: '\\mathbb{W}', title: 'Mathbb W' },
          { label: 'ℤ', insert: '\\mathbb{Z}', title: 'Mathbb Z' },
          // Small letters Row 2
          { label: '𝕓', insert: '𝕓', title: 'Mathbb b' },
          { label: '𝕖', insert: '𝕖', title: 'Mathbb e' },
          { label: '𝕙', insert: '𝕙', title: 'Mathbb h' },
          { label: '𝕜', insert: '𝕜', title: 'Mathbb k' },
          { label: '𝕟', insert: '𝕟', title: 'Mathbb n' },
          { label: '𝕢', insert: '𝕢', title: 'Mathbb q' },
          { label: '𝕥', insert: '𝕥', title: 'Mathbb t' },
          { label: '𝕨', insert: '𝕨', title: 'Mathbb w' },
          { label: '𝕫', insert: '𝕫', title: 'Mathbb z' },

          // --- Row 3 ---
          { label: 'ℂ', insert: '\\mathbb{C}', title: 'Mathbb C' },
          { label: '𝔽', insert: '\\mathbb{F}', title: 'Mathbb F' },
          { label: '𝕀', insert: '\\mathbb{I}', title: 'Mathbb I' },
          { label: '𝕃', insert: '\\mathbb{L}', title: 'Mathbb L' },
          { label: '𝕆', insert: '\\mathbb{O}', title: 'Mathbb O' },
          { label: 'ℝ', insert: '\\mathbb{R}', title: 'Mathbb R' },
          { label: '𝕌', insert: '\\mathbb{U}', title: 'Mathbb U' },
          { label: '𝕏', insert: '\\mathbb{X}', title: 'Mathbb X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝕔', insert: '𝕔', title: 'Mathbb c' },
          { label: '𝕗', insert: '𝕗', title: 'Mathbb f' },
          { label: '𝕚', insert: '𝕚', title: 'Mathbb i' },
          { label: '𝕝', insert: '𝕝', title: 'Mathbb l' },
          { label: '𝕠', insert: '𝕠', title: 'Mathbb o' },
          { label: '𝕣', insert: '𝕣', title: 'Mathbb r' },
          { label: '𝕦', insert: '𝕦', title: 'Mathbb u' },
          { label: '𝕩', insert: '𝕩', title: 'Mathbb x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
        ]
      },
      { label: 'ℕ', insert: 'ℕ', title: 'Mathbb N' },
      { label: 'ℤ', insert: 'ℤ', title: 'Mathbb Z' },
      { label: 'ℚ', insert: 'ℚ', title: 'Mathbb Q' },
      { label: 'ℂ', insert: 'ℂ', title: 'Mathbb C' },
      { label: 'ℝ', insert: 'ℝ', title: 'Mathbb R' },
      { label: 'ℙ', insert: 'ℙ', title: 'Mathbb P' },

      // Fraktur / Script / Special – 1 col × 3 rows
      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝔄', insert: '\\mathfrak{A}', title: 'Mathfrak A' },
          { label: '𝔇', insert: '\\mathfrak{D}', title: 'Mathfrak D' },
          { label: '𝔊', insert: '\\mathfrak{G}', title: 'Mathfrak G' },
          { label: '𝔍', insert: '\\mathfrak{J}', title: 'Mathfrak J' },
          { label: '𝔐', insert: '\\mathfrak{M}', title: 'Mathfrak M' },
          { label: '𝔓', insert: '\\mathfrak{P}', title: 'Mathfrak P' },
          { label: '𝔖', insert: '\\mathfrak{S}', title: 'Mathfrak S' },
          { label: '𝔙', insert: '\\mathfrak{V}', title: 'Mathfrak V' },
          { label: '𝔜', insert: '\\mathfrak{Y}', title: 'Mathfrak Y' },
          // Small letters Row 1
          { label: '𝔞', insert: '\\mathfrak{a}', title: 'Mathfrak a' },
          { label: '𝔡', insert: '\\mathfrak{d}', title: 'Mathfrak d' },
          { label: '𝔤', insert: '\\mathfrak{g}', title: 'Mathfrak g' },
          { label: '𝔧', insert: '\\mathfrak{j}', title: 'Mathfrak j' },
          { label: '𝔪', insert: '\\mathfrak{m}', title: 'Mathfrak m' },
          { label: '𝔭', insert: '\\mathfrak{p}', title: 'Mathfrak p' },
          { label: '𝔰', insert: '\\mathfrak{s}', title: 'Mathfrak s' },
          { label: '𝔳', insert: '\\mathfrak{v}', title: 'Mathfrak v' },
          { label: '𝔶', insert: '\\mathfrak{y}', title: 'Mathfrak y' },

          // --- Row 2 ---
          { label: '𝔅', insert: '\\mathfrak{B}', title: 'Mathfrak B' },
          { label: '𝔈', insert: '\\mathfrak{E}', title: 'Mathfrak E' },
          { label: 'ℌ', insert: '\\mathfrak{H}', title: 'Mathfrak H' },
          { label: '𝔎', insert: '\\mathfrak{K}', title: 'Mathfrak K' },
          { label: '𝔑', insert: '\\mathfrak{N}', title: 'Mathfrak N' },
          { label: '𝔔', insert: '\\mathfrak{Q}', title: 'Mathfrak Q' },
          { label: '𝔗', insert: '\\mathfrak{T}', title: 'Mathfrak T' },
          { label: '𝔚', insert: '\\mathfrak{W}', title: 'Mathfrak W' },
          { label: 'ℨ', insert: '\\mathfrak{Z}', title: 'Mathfrak Z' },
          // Small letters Row 2
          { label: '𝔟', insert: '\\mathfrak{b}', title: 'Mathfrak b' },
          { label: '𝔢', insert: '\\mathfrak{e}', title: 'Mathfrak e' },
          { label: '𝔥', insert: '\\mathfrak{h}', title: 'Mathfrak h' },
          { label: '𝔨', insert: '\\mathfrak{k}', title: 'Mathfrak k' },
          { label: '𝔫', insert: '\\mathfrak{n}', title: 'Mathfrak n' },
          { label: '𝔮', insert: '\\mathfrak{q}', title: 'Mathfrak q' },
          { label: '𝔱', insert: '\\mathfrak{t}', title: 'Mathfrak t' },
          { label: '𝔴', insert: '\\mathfrak{w}', title: 'Mathfrak w' },
          { label: '𝔷', insert: '\\mathfrak{z}', title: 'Mathfrak z' },

          // --- Row 3 ---
          { label: 'ℭ', insert: '\\mathfrak{C}', title: 'Mathfrak C' },
          { label: '𝔉', insert: '\\mathfrak{F}', title: 'Mathfrak F' },
          { label: 'ℑ', insert: '\\mathfrak{I}', title: 'Mathfrak I' },
          { label: '𝔏', insert: '\\mathfrak{L}', title: 'Mathfrak L' },
          { label: '𝔒', insert: '\\mathfrak{O}', title: 'Mathfrak O' },
          { label: 'ℜ', insert: '\\mathfrak{R}', title: 'Mathfrak R' },
          { label: '𝔘', insert: '\\mathfrak{U}', title: 'Mathfrak U' },
          { label: '𝔛', insert: '\\mathfrak{X}', title: 'Mathfrak X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝔠', insert: '\\mathfrak{c}', title: 'Mathfrak c' },
          { label: '𝔣', insert: '\\mathfrak{f}', title: 'Mathfrak f' },
          { label: '𝔦', insert: '\\mathfrak{i}', title: 'Mathfrak i' },
          { label: '𝔩', insert: '\\mathfrak{l}', title: 'Mathfrak l' },
          { label: '𝔬', insert: '\\mathfrak{o}', title: 'Mathfrak o' },
          { label: '𝔯', insert: '\\mathfrak{r}', title: 'Mathfrak r' },
          { label: '𝔲', insert: '\\mathfrak{u}', title: 'Mathfrak u' },
          { label: '𝔵', insert: '\\mathfrak{x}', title: 'Mathfrak x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder

        ]
      },

      { label: '𝔄', insert: '\\mathfrak{A}', title: 'Mathfrak A' },
      { label: '𝔅', insert: '\\mathfrak{B}', title: 'Mathfrak B' },
      { label: 'ℭ', insert: '\\mathfrak{C}', title: 'Mathfrak C' },





      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝒜', insert: '\\mathcal{A}', title: 'Mathcal A' },
          { label: '𝒟', insert: '\\mathcal{D}', title: 'Mathcal D' },
          { label: '𝒢', insert: '\\mathcal{G}', title: 'Mathcal G' },
          { label: '𝒥', insert: '\\mathcal{J}', title: 'Mathcal J' },
          { label: 'ℳ', insert: '\\mathcal{M}', title: 'Mathcal M' },
          { label: '𝒫', insert: '\\mathcal{P}', title: 'Mathcal P' },
          { label: '𝒮', insert: '\\mathcal{S}', title: 'Mathcal S' },
          { label: '𝒱', insert: '\\mathcal{V}', title: 'Mathcal V' },
          { label: '𝒴', insert: '\\mathcal{Y}', title: 'Mathcal Y' },
          // Small letters Row 1
          { label: '𝒶', insert: '𝒶', title: 'Mathcal a' },
          { label: '𝒹', insert: '𝒹', title: 'Mathcal d' },
          { label: 'ℊ', insert: 'ℊ', title: 'Mathcal g' },
          { label: '𝒿', insert: '𝒿', title: 'Mathcal j' },
          { label: '𝓂', insert: '𝓂', title: 'Mathcal m' },
          { label: '𝓅', insert: '𝓅', title: 'Mathcal p' },
          { label: '𝓈', insert: '𝓈', title: 'Mathcal s' },
          { label: '𝓋', insert: '𝓋', title: 'Mathcal v' },
          { label: '𝓎', insert: '𝓎', title: 'Mathcal y' },

          // --- Row 2 ---
          { label: 'ℬ', insert: '\\mathcal{B}', title: 'Mathcal B' },
          { label: 'ℰ', insert: '\\mathcal{E}', title: 'Mathcal E' },
          { label: 'ℋ', insert: '\\mathcal{H}', title: 'Mathcal H' },
          { label: '𝒦', insert: '\\mathcal{K}', title: 'Mathcal K' },
          { label: '𝒩', insert: '\\mathcal{N}', title: 'Mathcal N' },
          { label: '𝒬', insert: '\\mathcal{Q}', title: 'Mathcal Q' },
          { label: '𝒯', insert: '\\mathcal{T}', title: 'Mathcal T' },
          { label: '𝒲', insert: '\\mathcal{W}', title: 'Mathcal W' },
          { label: '𝒵', insert: '\\mathcal{Z}', title: 'Mathcal Z' },
          // Small letters Row 2
          { label: '𝒷', insert: '𝒷', title: 'Mathcal b' },
          { label: 'ℯ', insert: 'ℯ', title: 'Mathcal e' },
          { label: '𝒽', insert: '𝒽', title: 'Mathcal h' },
          { label: '𝓀', insert: '𝓀', title: 'Mathcal k' },
          { label: '𝓃', insert: '𝓃', title: 'Mathcal n' },
          { label: '𝓆', insert: '𝓆', title: 'Mathcal q' },
          { label: '𝓉', insert: '𝓉', title: 'Mathcal t' },
          { label: '𝓌', insert: '𝓌', title: 'Mathcal w' },
          { label: '𝓏', insert: '𝓏', title: 'Mathcal z' },

          // --- Row 3 ---
          { label: '𝒞', insert: '\\mathcal{C}', title: 'Mathcal C' },
          { label: 'ℱ', insert: '\\mathcal{F}', title: 'Mathcal F' },
          { label: 'ℐ', insert: '\\mathcal{I}', title: 'Mathcal I' },
          { label: 'ℒ', insert: '\\mathcal{L}', title: 'Mathcal L' },
          { label: '𝒪', insert: '\\mathcal{O}', title: 'Mathcal O' },
          { label: 'ℛ', insert: '\\mathcal{R}', title: 'Mathcal R' },
          { label: '𝒰', insert: '\\mathcal{U}', title: 'Mathcal U' },
          { label: '𝒳', insert: '\\mathcal{X}', title: 'Mathcal X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝒸', insert: '𝒸', title: 'Mathcal c' },
          { label: '𝒻', insert: '𝒻', title: 'Mathcal f' },
          { label: '𝒾', insert: '𝒾', title: 'Mathcal i' },
          { label: '𝓁', insert: '𝓁', title: 'Mathcal l' },
          { label: 'ℴ', insert: 'ℴ', title: 'Mathcal o' },
          { label: '𝓇', insert: '𝓇', title: 'Mathcal r' },
          { label: '𝓊', insert: '𝓊', title: 'Mathcal u' },
          { label: '𝓍', insert: '𝓍', title: 'Mathcal x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
        ]
      },
      { label: '𝒜', insert: '\\mathcal{A}', title: 'Mathcal A' },
      { label: 'ℬ', insert: '\\mathcal{B}', title: 'Mathcal B' },
      { label: '𝒞', insert: '\\mathcal{C}', title: 'Mathcal C' },

      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 2, moreItems: [
          { label: 'ℵ', insert: '\\aleph', title: 'Aleph' },      // Alef
          { label: 'ℐ', insert: '\\mathcal{I}', title: 'Mathcal I' }, // Script I
          { label: '℘', insert: '\\wp', title: 'Wp' },         // Script capital P (Weierstrass P)
          { label: 'ℨ', insert: '\\mathfrak{Z}', title: 'Mathfrak Z' },// Z-transform symbol
          { label: 'ℱ', insert: '\\mathcal{F}', title: 'Mathcal F' }, // Script capital F
        ]
      },
      { label: 'ℑ', insert: '\\Im', title: 'Im' },
      { label: 'ℜ', insert: '\\Re', title: 'Re' },
      { label: 'ℓ', insert: '\\ell', title: 'Ell' },

      //group chemical
      {
        type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup', moreCols: 18, moreItems: [
          // Row 1
          { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H', cls: 'pt-unknown' },
          ...Array.from({ length: 16 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'He', insert: '\\mathrm{He}', title: 'Mathrm He', cls: 'pt-noble' },

          // Row 2
          { label: 'Li', insert: '\\mathrm{Li}', title: 'Mathrm Li', cls: 'pt-alkali' },
          { label: 'Be', insert: '\\mathrm{Be}', title: 'Mathrm Be', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'B', insert: '\\mathrm{B}', title: 'Mathrm B', cls: 'pt-nonmetal' },
          { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C', cls: 'pt-nonmetal' },
          { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N', cls: 'pt-nonmetal' },
          { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O', cls: 'pt-nonmetal' },
          { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F', cls: 'pt-nonmetal' },
          { label: 'Ne', insert: '\\mathrm{Ne}', title: 'Mathrm Ne', cls: 'pt-noble' },

          // Row 3
          { label: 'Na', insert: '\\mathrm{Na}', title: 'Mathrm Na', cls: 'pt-alkali' },
          { label: 'Mg', insert: '\\mathrm{Mg}', title: 'Mathrm Mg', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Al', insert: '\\mathrm{Al}', title: 'Mathrm Al', cls: 'pt-metalloid' },
          { label: 'Si', insert: '\\mathrm{Si}', title: 'Mathrm Si', cls: 'pt-metalloid' },
          { label: 'P', insert: '\\mathrm{P}', title: 'Mathrm P', cls: 'pt-nonmetal' },
          { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S', cls: 'pt-nonmetal' },
          { label: 'Cl', insert: '\\mathrm{Cl}', title: 'Mathrm Cl', cls: 'pt-nonmetal' },
          { label: 'Ar', insert: '\\mathrm{Ar}', title: 'Mathrm Ar', cls: 'pt-noble' },

          // Row 4
          { label: 'K', insert: '\\mathrm{K}', title: 'Mathrm K', cls: 'pt-alkali' },
          { label: 'Ca', insert: '\\mathrm{Ca}', title: 'Mathrm Ca', cls: 'pt-alkaline' },
          { label: 'Sc', insert: '\\mathrm{Sc}', title: 'Mathrm Sc', cls: 'pt-transition' },
          { label: 'Ti', insert: '\\mathrm{Ti}', title: 'Mathrm Ti', cls: 'pt-transition' },
          { label: 'V', insert: '\\mathrm{V}', title: 'Mathrm V', cls: 'pt-transition' },
          { label: 'Cr', insert: '\\mathrm{Cr}', title: 'Mathrm Cr', cls: 'pt-transition' },
          { label: 'Mn', insert: '\\mathrm{Mn}', title: 'Mathrm Mn', cls: 'pt-transition' },
          { label: 'Fe', insert: '\\mathrm{Fe}', title: 'Mathrm Fe', cls: 'pt-transition' },
          { label: 'Co', insert: '\\mathrm{Co}', title: 'Mathrm Co', cls: 'pt-transition' },
          { label: 'Ni', insert: '\\mathrm{Ni}', title: 'Mathrm Ni', cls: 'pt-transition' },
          { label: 'Cu', insert: '\\mathrm{Cu}', title: 'Mathrm Cu', cls: 'pt-transition' },
          { label: 'Zn', insert: '\\mathrm{Zn}', title: 'Mathrm Zn', cls: 'pt-transition' },
          { label: 'Ga', insert: '\\mathrm{Ga}', title: 'Mathrm Ga', cls: 'pt-metalloid' },
          { label: 'Ge', insert: '\\mathrm{Ge}', title: 'Mathrm Ge', cls: 'pt-metalloid' },
          { label: 'As', insert: '\\mathrm{As}', title: 'Mathrm As', cls: 'pt-nonmetal' },
          { label: 'Se', insert: '\\mathrm{Se}', title: 'Mathrm Se', cls: 'pt-nonmetal' },
          { label: 'Br', insert: '\\mathrm{Br}', title: 'Mathrm Br', cls: 'pt-nonmetal' },
          { label: 'Kr', insert: '\\mathrm{Kr}', title: 'Mathrm Kr', cls: 'pt-noble' },

          // Row 5
          { label: 'Rb', insert: '\\mathrm{Rb}', title: 'Mathrm Rb', cls: 'pt-alkali' },
          { label: 'Sr', insert: '\\mathrm{Sr}', title: 'Mathrm Sr', cls: 'pt-alkaline' },
          { label: 'Y', insert: '\\mathrm{Y}', title: 'Mathrm Y', cls: 'pt-transition' },
          { label: 'Zr', insert: '\\mathrm{Zr}', title: 'Mathrm Zr', cls: 'pt-transition' },
          { label: 'Nb', insert: '\\mathrm{Nb}', title: 'Mathrm Nb', cls: 'pt-transition' },
          { label: 'Mo', insert: '\\mathrm{Mo}', title: 'Mathrm Mo', cls: 'pt-transition' },
          { label: 'Tc', insert: '\\mathrm{Tc}', title: 'Mathrm Tc', cls: 'pt-transition' },
          { label: 'Ru', insert: '\\mathrm{Ru}', title: 'Mathrm Ru', cls: 'pt-transition' },
          { label: 'Rh', insert: '\\mathrm{Rh}', title: 'Mathrm Rh', cls: 'pt-transition' },
          { label: 'Pd', insert: '\\mathrm{Pd}', title: 'Mathrm Pd', cls: 'pt-transition' },
          { label: 'Ag', insert: '\\mathrm{Ag}', title: 'Mathrm Ag', cls: 'pt-transition' },
          { label: 'Cd', insert: '\\mathrm{Cd}', title: 'Mathrm Cd', cls: 'pt-transition' },
          { label: 'In', insert: '\\mathrm{In}', title: 'Mathrm In', cls: 'pt-metalloid' },
          { label: 'Sn', insert: '\\mathrm{Sn}', title: 'Mathrm Sn', cls: 'pt-metalloid' },
          { label: 'Sb', insert: '\\mathrm{Sb}', title: 'Mathrm Sb', cls: 'pt-metalloid' },
          { label: 'Te', insert: '\\mathrm{Te}', title: 'Mathrm Te', cls: 'pt-nonmetal' },
          { label: 'I', insert: '\\mathrm{I}', title: 'Mathrm I', cls: 'pt-nonmetal' },
          { label: 'Xe', insert: '\\mathrm{Xe}', title: 'Mathrm Xe', cls: 'pt-noble' },

          // Row 6
          { label: 'Cs', insert: '\\mathrm{Cs}', title: 'Mathrm Cs', cls: 'pt-alkali' },
          { label: 'Ba', insert: '\\mathrm{Ba}', title: 'Mathrm Ba', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Hf', insert: '\\mathrm{Hf}', title: 'Mathrm Hf', cls: 'pt-transition' },
          { label: 'Ta', insert: '\\mathrm{Ta}', title: 'Mathrm Ta', cls: 'pt-transition' },
          { label: 'W', insert: '\\mathrm{W}', title: 'Mathrm W', cls: 'pt-transition' },
          { label: 'Re', insert: '\\mathrm{Re}', title: 'Mathrm Re', cls: 'pt-transition' },
          { label: 'Os', insert: '\\mathrm{Os}', title: 'Mathrm Os', cls: 'pt-transition' },
          { label: 'Ir', insert: '\\mathrm{Ir}', title: 'Mathrm Ir', cls: 'pt-transition' },
          { label: 'Pt', insert: '\\mathrm{Pt}', title: 'Mathrm Pt', cls: 'pt-transition' },
          { label: 'Au', insert: '\\mathrm{Au}', title: 'Mathrm Au', cls: 'pt-transition' },
          { label: 'Hg', insert: '\\mathrm{Hg}', title: 'Mathrm Hg', cls: 'pt-transition' },
          { label: 'Tl', insert: '\\mathrm{Tl}', title: 'Mathrm Tl', cls: 'pt-metalloid' },
          { label: 'Pb', insert: '\\mathrm{Pb}', title: 'Mathrm Pb', cls: 'pt-metalloid' },
          { label: 'Bi', insert: '\\mathrm{Bi}', title: 'Mathrm Bi', cls: 'pt-metalloid' },
          { label: 'Po', insert: '\\mathrm{Po}', title: 'Mathrm Po', cls: 'pt-metalloid' },
          { label: 'At', insert: '\\mathrm{At}', title: 'Mathrm At', cls: 'pt-nonmetal' },
          { label: 'Rn', insert: '\\mathrm{Rn}', title: 'Mathrm Rn', cls: 'pt-noble' },

          // Row 7
          { label: 'Fr', insert: '\\mathrm{Fr}', title: 'Mathrm Fr', cls: 'pt-alkali' },
          { label: 'Ra', insert: '\\mathrm{Ra}', title: 'Mathrm Ra', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Rf', insert: '\\mathrm{Rf}', title: 'Mathrm Rf', cls: 'pt-transition' },
          { label: 'Db', insert: '\\mathrm{Db}', title: 'Mathrm Db', cls: 'pt-transition' },
          { label: 'Sg', insert: '\\mathrm{Sg}', title: 'Mathrm Sg', cls: 'pt-transition' },
          { label: 'Bh', insert: '\\mathrm{Bh}', title: 'Mathrm Bh', cls: 'pt-transition' },
          { label: 'Hs', insert: '\\mathrm{Hs}', title: 'Mathrm Hs', cls: 'pt-transition' },
          { label: 'Mt', insert: '\\mathrm{Mt}', title: 'Mathrm Mt', cls: 'pt-transition' },
          { label: 'Ds', insert: '\\mathrm{Ds}', title: 'Mathrm Ds', cls: 'pt-transition' },
          { label: 'Rg', insert: '\\mathrm{Rg}', title: 'Mathrm Rg', cls: 'pt-transition' },
          { label: 'Cn', insert: '\\mathrm{Cn}', title: 'Mathrm Cn', cls: 'pt-transition' },
          { label: 'Nh', insert: '\\mathrm{Nh}', title: 'Mathrm Nh', cls: 'pt-metalloid' },
          { label: 'Fl', insert: '\\mathrm{Fl}', title: 'Mathrm Fl', cls: 'pt-metalloid' },
          { label: 'Mc', insert: '\\mathrm{Mc}', title: 'Mathrm Mc', cls: 'pt-metalloid' },
          { label: 'Lv', insert: '\\mathrm{Lv}', title: 'Mathrm Lv', cls: 'pt-metalloid' },
          { label: 'Ts', insert: '\\mathrm{Ts}', title: 'Mathrm Ts', cls: 'pt-unknown' },
          { label: 'Og', insert: '\\mathrm{Og}', title: 'Mathrm Og', cls: 'pt-unknown' },

          // Gap Row
          ...Array.from({ length: 18 }, () => ({ label: '', cls: 'pt-empty' })),

          // Row Lanthanides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'La', insert: '\\mathrm{La}', title: 'Mathrm La', cls: 'pt-transition' },
          { label: 'Ce', insert: '\\mathrm{Ce}', title: 'Mathrm Ce', cls: 'pt-lanthanide' },
          { label: 'Pr', insert: '\\mathrm{Pr}', title: 'Mathrm Pr', cls: 'pt-lanthanide' },
          { label: 'Nd', insert: '\\mathrm{Nd}', title: 'Mathrm Nd', cls: 'pt-lanthanide' },
          { label: 'Pm', insert: '\\mathrm{Pm}', title: 'Mathrm Pm', cls: 'pt-lanthanide' },
          { label: 'Sm', insert: '\\mathrm{Sm}', title: 'Mathrm Sm', cls: 'pt-lanthanide' },
          { label: 'Eu', insert: '\\mathrm{Eu}', title: 'Mathrm Eu', cls: 'pt-lanthanide' },
          { label: 'Gd', insert: '\\mathrm{Gd}', title: 'Mathrm Gd', cls: 'pt-lanthanide' },
          { label: 'Tb', insert: '\\mathrm{Tb}', title: 'Mathrm Tb', cls: 'pt-lanthanide' },
          { label: 'Dy', insert: '\\mathrm{Dy}', title: 'Mathrm Dy', cls: 'pt-lanthanide' },
          { label: 'Ho', insert: '\\mathrm{Ho}', title: 'Mathrm Ho', cls: 'pt-lanthanide' },
          { label: 'Er', insert: '\\mathrm{Er}', title: 'Mathrm Er', cls: 'pt-lanthanide' },
          { label: 'Tm', insert: '\\mathrm{Tm}', title: 'Mathrm Tm', cls: 'pt-lanthanide' },
          { label: 'Yb', insert: '\\mathrm{Yb}', title: 'Mathrm Yb', cls: 'pt-lanthanide' },
          { label: 'Lu', insert: '\\mathrm{Lu}', title: 'Mathrm Lu', cls: 'pt-lanthanide' },
          { label: '', cls: 'pt-empty' },

          // Row Actinides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Ac', insert: '\\mathrm{Ac}', title: 'Mathrm Ac', cls: 'pt-actinide' },
          { label: 'Th', insert: '\\mathrm{Th}', title: 'Mathrm Th', cls: 'pt-actinide' },
          { label: 'Pa', insert: '\\mathrm{Pa}', title: 'Mathrm Pa', cls: 'pt-actinide' },
          { label: 'U', insert: '\\mathrm{U}', title: 'Mathrm U', cls: 'pt-actinide' },
          { label: 'Np', insert: '\\mathrm{Np}', title: 'Mathrm Np', cls: 'pt-actinide' },
          { label: 'Pu', insert: '\\mathrm{Pu}', title: 'Mathrm Pu', cls: 'pt-actinide' },
          { label: 'Am', insert: '\\mathrm{Am}', title: 'Mathrm Am', cls: 'pt-actinide' },
          { label: 'Cm', insert: '\\mathrm{Cm}', title: 'Mathrm Cm', cls: 'pt-actinide' },
          { label: 'Bk', insert: '\\mathrm{Bk}', title: 'Mathrm Bk', cls: 'pt-actinide' },
          { label: 'Cf', insert: '\\mathrm{Cf}', title: 'Mathrm Cf', cls: 'pt-actinide' },
          { label: 'Es', insert: '\\mathrm{Es}', title: 'Mathrm Es', cls: 'pt-actinide' },
          { label: 'Fm', insert: '\\mathrm{Fm}', title: 'Mathrm Fm', cls: 'pt-actinide' },
          { label: 'Md', insert: '\\mathrm{Md}', title: 'Mathrm Md', cls: 'pt-actinide' },
          { label: 'No', insert: '\\mathrm{No}', title: 'Mathrm No', cls: 'pt-actinide' },
          { label: 'Lr', insert: '\\mathrm{Lr}', title: 'Mathrm Lr', cls: 'pt-actinide' },
          { label: '', cls: 'pt-empty' },
        ]
      },
      { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H' },   // Hydrogen
      { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C' },   // Carbon
      { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N' },   // Nitrogen
      { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O' },   // Oxygen
      { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F' },   // Fluorine
      { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S' },   // Sulfur

    ]
  },

  {
    label: 'bmatrix', fontSize: '5px', mathLabel: '\\textstyle \\begin{bmatrix}#? & #?\\\\ #? & #?\\end{bmatrix}  \\,  \\begin{cases} #? \\\\ #? \\end{cases}', isMatrix: true,
    items: [

      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="10" y="6" width="8" height="14" rx="1" /><rect x="28" y="6" width="8" height="14" rx="1" /><rect x="46" y="6" width="8" height="14" rx="1" /><rect x="10" y="25" width="8" height="14" rx="1" /><rect x="28" y="25" width="8" height="14" rx="1" /><rect x="46" y="25" width="8" height="14" rx="1" /><rect x="10" y="44" width="8" height="14" rx="1" /><rect x="28" y="44" width="8" height="14" rx="1" /><rect x="46" y="44" width="8" height="14" rx="1" /></svg>), insert: 'matrix', cls: 'template', title: '3×3 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="8" y1="4" x2="8" y2="60" stroke="#222" strokeWidth="4" /><line x1="56" y1="4" x2="56" y2="60" stroke="#222" strokeWidth="4" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'vmatrix', cls: 'template', title: '2×2 Determinant' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M14 6H8V58H14" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 6H56V58H50" stroke="#222" strokeWidth="4" fill="none" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'bmatrix', cls: 'template', title: '2×2 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 6C8 16 8 48 16 58" stroke="#222" strokeWidth="4" fill="none" /><path d="M48 6C56 16 56 48 48 58" stroke="#222" strokeWidth="4" fill="none" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'pmatrix', cls: 'template', title: '2×2 Parenthesis Matrix' },

      // { label: '□', insert: 'matrix', cls: 'template', title: 'Matrix' },
      // { label: '|□|', insert: 'vmatrix', cls: 'template', title: 'Vertical bar matrix' },
      // { label: '[□]', insert: 'bmatrix', cls: 'template', title: 'Bracket matrix' },
      // { label: '(□)', insert: 'pmatrix', cls: 'template', title: 'Parenthesis matrix' },


      { type: 'sep', cols: 3, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="6" width="8" height="10" rx="1" /><rect x="28" y="27" width="8" height="10" rx="1" /><rect x="28" y="48" width="8" height="10" rx="1" /></svg>), insert: '\\begin{matrix} #? \\\\ #? \\\\ #? \\end{matrix}', cls: 'symbol', directInsert: true, action: 'INSERT_CUSTOM', title: 'Vertical Dots' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 6H12V58H18" stroke="#222" strokeWidth="4" fill="none" /><path d="M46 6H52V58H46" stroke="#222" strokeWidth="4" fill="none" /><rect x="28" y="10" width="8" height="14" rx="1" /><rect x="28" y="38" width="8" height="14" rx="1" /></svg>), insert: '\\begin{bmatrix} #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 6C10 16 10 48 18 58" stroke="#222" strokeWidth="4" fill="none" /><path d="M46 6C54 16 54 48 46 58" stroke="#222" strokeWidth="4" fill="none" /><rect x="28" y="10" width="8" height="14" rx="1" /><rect x="28" y="38" width="8" height="14" rx="1" /></svg>), insert: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Parenthesis Matrix' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="8" y="24" width="8" height="14" rx="1" /><rect x="28" y="24" width="8" height="14" rx="1" /><rect x="48" y="24" width="8" height="14" rx="1" /></svg>), insert: '\\begin{matrix} #? \\,  #? \\,  #? \\end{matrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×3 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 18H12V46H16" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 18H54V46H50" stroke="#222" strokeWidth="4" fill="none" /><rect x="22" y="22" width="8" height="14" rx="1" /><rect x="38" y="22" width="8" height="14" rx="1" /></svg>), insert: '\\begin{bmatrix} #? \\, #? \\end{bmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×2 Square Bracket Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 18C12 23 12 41 16 46" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 18C54 23 54 41 50 46" stroke="#222" strokeWidth="4" fill="none" /><rect x="22" y="22" width="8" height="14" rx="1" /><rect x="38" y="22" width="8" height="14" rx="1" /></svg>), insert: '\\begin{pmatrix} #? \\, #? \\end{pmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×2 Parenthesis Matrix' },
      // { label: '□', insert: '\\begin{matrix} #? \\\\ #? \\\\ #? \\end{matrix}', cls: 'template', directInsert: true, title: 'Begin matrix' },
      // { label: '[□ \\ □]', insert: '\\begin{bmatrix} #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true, title: 'Begin bmatrix' },
      // { label: '(□ \\ □)', insert: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true, title: 'Begin pmatrix' },
      // { label: '□ □ □', insert: '\\begin{matrix} #? \\,  #? \\,  #? \\end{matrix}', cls: 'template', directInsert: true, title: 'Begin matrix' },
      // { label: '[□ & □]', insert: '\\begin{bmatrix} #? \\, #? \\end{bmatrix}', cls: 'template', directInsert: true, title: 'Begin bmatrix' },
      // { label: '(□ & □)', insert: '\\begin{pmatrix} #? \\, #? \\end{pmatrix}', cls: 'template', directInsert: true, title: 'Begin pmatrix' },


      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 8C12 8 12 12 12 18V26C12 30 10 32 8 32C10 32 12 34 12 38V46C12 52 12 56 16 56" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="10" width="10" height="12" rx="1" /><rect x="26" y="34" width="10" height="12" rx="1" /></svg>), insert: '\\begin{cases} #? \\\\ #? \\end{cases}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 8C12 8 12 12 12 18V26C12 30 10 32 8 32C10 32 12 34 12 38V46C12 52 12 56 16 56" stroke="#222" strokeWidth="4" fill="none" /><rect x="23" y="10" width="10" height="12" rx="1" /><rect x="39" y="10" width="10" height="12" rx="1" /><rect x="23" y="34" width="10" height="12" rx="1" /><rect x="39" y="34" width="10" height="12" rx="1" /></svg>), insert: '\\begin{cases} #? \\, #? \\\\ #? \\, #? \\end{cases}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×2 Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="26" y="10" width="10" height="12" rx="1" /><rect x="26" y="34" width="10" height="12" rx="1" /><path d="M48 8C52 8 52 12 52 18V26C52 30 54 32 56 32C54 32 52 34 52 38V46C52 52 52 56 48 56" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left.\\begin{matrix} #? \\\\ #? \\end{matrix}\\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="8" y="8" width="12" height="12" rx="1" /><line x1="26" y1="12" x2="38" y2="12" stroke="#222" strokeWidth="3" /><line x1="26" y1="16" x2="38" y2="16" stroke="#222" strokeWidth="3" /><rect x="44" y="6" width="10" height="16" rx="1" /><rect x="8" y="40" width="10" height="16" rx="1" /><line x1="24" y1="46" x2="36" y2="46" stroke="#222" strokeWidth="3" /><line x1="24" y1="50" x2="36" y2="50" stroke="#222" strokeWidth="3" /><rect x="42" y="38" width="12" height="12" rx="1" /></svg>), insert: '\\begin{aligned} #? &= #? \\\\ #? &= #? \\end{aligned}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'System of Equations' },
      // // Two rows column with left curly brackets
      // { label: '{', insert: '\\begin{cases} #? \\\\ #? \\end{cases}', cls: 'template', directInsert: true, title: 'Begin cases' },
      // // Piecewise function
      // { label: 'f(x)', insert: '\\begin{cases} #?, \\, #? \\\\ #?, \\, #? \\end{cases}', cls: 'template', directInsert: true, title: 'Begin cases' },

      // // Two rows column with right curly brackets
      // { label: '}', insert: '\\left.\\begin{matrix} #? \\\\ #? \\end{matrix}\\right\\}', cls: 'template', directInsert: true, title: 'Begin matrix' },

      // // Aligned equations
      // { label: '=', insert: '\\begin{aligned} #? &= #? \\\\ #? &= #? \\end{aligned}', cls: 'template', directInsert: true, title: 'Begin aligned' },


      { type: 'sep', cols: 2, cls: 'cme-trig-subgroup' },
      { label: '⋮', insert: '\\vdots', title: 'Vertical ellipses' },
      { label: '⋰', insert: '⋰', title: 'Upright diagonal ellipses' },
      { label: '…', insert: '\\ldots', title: 'Horizontal ellipses' },
      { label: '⋱', insert: '\\ddots', title: 'Down-right diagonal ellipses' },

      {
        type: 'sep', cols: 1, fontSize: '8px', cls: 'cme-matrix-subgroup', moreCols: 3, moreItems: [
          // sub addition
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\ \\,#?\\end{array}}{\\;#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction Template' },
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="26" x2="26" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\-\\,#?\\end{array}}{\\quad#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Subtraction' },
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="11" y1="19" x2="25" y2="33" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="25" y1="19" x2="11" y2="33" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\×\\,#?\\end{array}}{\\quad#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Multiplication' },

          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="4" y="8" width="10" height="16" rx="1" /><path d="M30 4V30H56" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="40" y="8" width="10" height="16" rx="1" /><rect x="40" y="40" width="10" height="16" rx="1" /></svg>), insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ & \\; #? \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Long Division' },
          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="4" y="8" width="10" height="16" rx="1" /><rect x="4" y="44" width="10" height="16" rx="1" /><path d="M30 4V36H58" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="44" y="8" width="10" height="16" rx="1" /><rect x="44" y="44" width="10" height="16" rx="1" /></svg>), insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ #?\\, & \\; #? \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Long Division with Four Terms' },
          //long dividosn
          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="40" y="0" width="10" height="16" rx="1" /><line x1="30" y1="20" x2="54" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M26 18C34 25 34 47 26 54" stroke="#222" strokeWidth="4" fill="none" /><rect x="6" y="28" width="10" height="16" rx="1" /><rect x="40" y="28" width="10" height="16" rx="1" /><rect x="40" y="52" width="10" height="16" rx="1" /></svg>), insert: '#?\\, ) \\!\\!\\!\\!\\! \\begin{array}\\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}} \\\\ \\;\\;#?\\; \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Root with Fraction and Subscript' },


          // { label: ' ', insert: '\\frac{\\begin{array}{r}#?\\\\ \\,#?\\end{array}}{\\;#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '-', insert: '\\frac{\\begin{array}{r}#?\\\\-\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '*', insert: '\\frac{\\begin{array}{r}#?\\\\*\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '÷', insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ & \\; #? \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '÷', insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ #?\\, & \\; #? \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // // Long division
          // { label: '⟌', insert: '#?\\, ) \\!\\!\\!\\!\\! \\begin{array}\\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}} \\\\ \\;\\;#?\\; \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },


        ]
      },

      //column addition
      { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="18" y1="18" x2="18" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="26" x2="26" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\+\\,#?\\end{array}}{\\quad#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Addition' },


      //long divison 
      { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="40" y="0" width="10" height="16" rx="1" /><line x1="30" y1="20" x2="54" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M26 18C34 25 34 47 26 54" stroke="#222" strokeWidth="4" fill="none" /><rect x="6" y="28" width="10" height="16" rx="1" /><rect x="40" y="28" width="10" height="16" rx="1" /></svg>), insert: '#?\\, ) \\!\\! \\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Root with Fraction' },
      // // Column addition
      // { label: '+', insert: '\\frac{\\begin{array}{r}#?\\\\+\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', },

      // // Long division
      // { label: '⟌', insert: '#?\\, ) \\!\\! \\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}}', isWidget: true, directInsert: true, title: 'Vphantom 1', },



    ]
  },
  {
    label: '□̅', fontSize: '9px', mathLabel: '{#?}^{#?} \\, \\overset{#?}{#?}', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup' },
      // Big fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="2" width="18" height="20" rx="2" /><line x1="6" y1="32" x2="50" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="18" y="40" width="18" height="20" rx="2" /></svg>), insert: '\\frac{#0}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction' },
      // { label: 'a/b', insert: '\\frac{#?}{#?}', title: 'Fraction' },

      // Small fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="22" y="8" width="12" height="14" rx="2" /><line x1="6" y1="32" x2="50" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="22" y="40" width="12" height="14" rx="2" /></svg>), insert: '\\tfrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction' },
      // { label: 'a⁄b', insert: '\\tfrac{#?}{#?}', title: 'Small fraction' },

      //fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="5" y="16" width="18" height="20" rx="1" /><line x1="26" y1="50" x2="40" y2="18" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="38" y="34" width="18" height="20" rx="1" /></svg>), insert: '\\large \\nicefrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Text Fraction' },

      // { label: 'A⁄B', insert: '{#?}/{#?}', title: 'Inline fraction' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="14" y="16" width="12" height="16" rx="1" /><line x1="26" y1="50" x2="40" y2="18" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="38" y="34" width="12" height="16" rx="1" /></svg>), insert: '\\nicefrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Text Fraction' },

      // { label: '⎸/⎹', insert: '\\nicefrac{#?}{#?}', title: 'Nice fraction' },

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },
      // Square root
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 34 L14 34 L20 50 L30 10 L54 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="36" y="18" width="16" height="20" rx="2" /></svg>), insert: '\\sqrt{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Root' },

      // { label: '√', insert: '\\sqrt{#?}', title: 'Square root' },

      // Root (nth root)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 36 L14 36 L20 50 L30 10 L56 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="12" y="16" width="8" height="12" rx="2" /><rect x="40" y="22" width="12" height="22" rx="2" /></svg>), insert: '\\sqrt[#?]{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Nth Root Fraction' },

      // { label: 'ⁿ√', insert: '\\sqrt[#?]{#?}', title: 'N-th root' },

      { type: 'sep', cols: 3, cls: 'cme-matrix-subgroup' },
      // Superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box' },
      // { label: 'xⁿ', insert: '{#?}^{#?}', title: 'Superscript' },

      // Superscript and subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /><rect x="32" y="36" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box with Subscript' },
      // { label: 'xⁿₖ', insert: '{#?}_{#?}^{#?}', title: 'Subscript and superscript' },

      // Subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="14" width="12" height="20" rx="1" /><rect x="36" y="28" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Lowered Box' },
      // { label: 'xₖ', insert: '{#?}_{#?}', title: 'Subscript' },

      // Left superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="10" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="22" width="12" height="20" rx="1" /></svg>), insert: '{}^{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Lowered Box' },// { label: 'ⁿx', insert: '{}^{#?}{#?}', title: 'Left superscript' },



      // Left subscript and superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="8" width="10" height="16" rx="1" opacity="0.45" /><rect x="18" y="36" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="20" width="12" height="20" rx="1" /></svg>), insert: '{}_{#?}^{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Superscript and Subscript' },
      // { label: 'ⁿₖx', insert: '{}_{#?}^{#?}{#?}', title: 'Left subscript and superscript' },



      // Left subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="28" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="10" width="12" height="20" rx="1" /></svg>), insert: '{}_{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Lower Left Box' },
      // { label: 'ₖx', insert: '{}_{#?}{#?}', title: 'Left subscript' },

      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      // Element over
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="1" opacity="0.45" /><rect x="23" y="28" width="12" height="20" rx="1" /></svg>), insert: '\\overset{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Superscript Box' },

      // { label: '□̅', insert: '\\overset{#?}{#?}', title: 'Overscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 4 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="28" width="12" height="18" rx="1" /><rect x="21" y="52" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\underset{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Subscript Box' },
      // { label: '□̲', insert: '\\underset{#?}{#?}', title: 'Underscript' },


      // Elements under and over
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="8" height="12" rx="1" opacity="0.45" /><rect x="22" y="22" width="12" height="20" rx="1" /><rect x="24" y="48" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{#?}{\\underset{#?}{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Superscript and Subscript' },
      // { label: '□̲̅', insert: '\\overset{#?}{\\underset{#?}{#?}}', title: 'Over and underscript' },


      { type: 'sep', cols: 1, cls: 'cme-matrix-subgroup' },
      // Underscript with brace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="26" y="4" width="12" height="20" rx="1" /><path d="M10 34H24C28 34 30 36 32 40C34 36 36 34 40 34H54M10 34V28M54 34V28" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="46" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\underbrace{#?}_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underbrace' },

      // { label: '⏟', insert: '\\underbrace{#?}_{#?}', title: 'Underbrace' },

      // Overscript with brace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="27" y="2" width="10" height="16" rx="1" opacity="0.45" /><path d="M10 36V30H24C28 30 30 28 32 24C34 28 36 30 40 30H54V36" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="40" width="12" height="20" rx="1" /></svg>), insert: '\\overbrace{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overbrace' },
      // { label: '⏞', insert: '\\overbrace{#?}^{#?}', title: 'Overbrace' },



      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },


      // Box with over and underscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="1" width="10" height="12" rx="1" opacity="0.45" /><rect x="16" y="20" width="16" height="24" rx="1" stroke="#222" /><rect x="19" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{\\raisebox{0.1em}{#?}}{\\underset{\\raisebox{-0.3em}{#?}}{\\Large #?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Large Box with Superscript and Subscript' },
      // { label: '□̲̅', insert: '\\overset{#?}{\\underset{#?}{\\square}}', title: 'Box with over and underscript' },


      // Right sub/superscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="1" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}^{\\raisebox{0.6em}{#?}}', isWidget: true, title: 'Subscript and superscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="16" y="4" width="16" height="24" rx="1" stroke="#222" /><rect x="19" y="40" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\underset{\\raisebox{-0.3em}{#?}}{\\Large #?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Large Box with Subscript' },
      // { label: '□̲', insert: '\\underset{#?}{#?}', title: 'Underscript' },



      // Right subscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}', isWidget: true, title: 'Subscript' },


      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      {
        label: (
          <svg width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="18" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\enspace',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Horizontal Phantom Space'
      },
      {
        label: (
          <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', marginLeft: "13px" }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="10" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\,',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Thin Space'
      },
      {
        label: (
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="8" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\!',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Negative Thin Space'
      },


      // { label: 'e', insert: 'e' }, { label: 'i', insert: 'i' },
      // { label: 'π', insert: '\\pi' },
      // { label: 'ℝ', insert: '\\mathbb{R}' }, { label: 'ℤ', insert: '\\mathbb{Z}' },
      // { label: 'ℕ', insert: '\\mathbb{N}' }, { label: 'ℚ', insert: '\\mathbb{Q}' },
      // { label: 'ℂ', insert: '\\mathbb{C}' }, { label: '∅', insert: '\\emptyset' },
      // { label: 'ℵ₀', insert: '\\aleph_0' },
      // { label: 'ξ', insert: '\\xi' },
      // { label: 'ρ', insert: '\\rho' }, { label: 'σ', insert: '\\sigma' },
      // { label: 'τ', insert: '\\tau' }, { label: 'υ', insert: '\\upsilon' },
      // { label: 'φ', insert: '\\varphi' }, { label: 'χ', insert: '\\chi' },
      // { label: 'ψ', insert: '\\psi' }, { label: 'ω', insert: '\\omega' },
      // { label: 'Γ', insert: '\\Gamma' },
      // { label: 'Θ', insert: '\\Theta' }, { label: 'Λ', insert: '\\Lambda' },
      // { label: 'Ξ', insert: '\\Xi' }, { label: 'Σ', insert: '\\Sigma' },
      // { label: 'Φ', insert: '\\Phi' }, { label: 'Ψ', insert: '\\Psi' },
      // { label: 'Ω', insert: '\\Omega' },
      // { label: 'θᵢ', insert: '\\theta_{#?}' }, { label: 'λₙ', insert: '\\lambda_{#?}' },
      // { label: 'μₓ', insert: '\\mu_{#?}' }, { label: 'σ²', insert: '\\sigma^{2}' },
      // { label: 'Δx', insert: '\\Delta #?' },
    ]
  },

  {
    label: '( )', fontSize: '9px', isTemplate: true, mathLabel: '\\left( #? \\right) \\, \\overparen{#?}', items: [
      {
        type: 'sep', cols: 3, small: true, moreCols: 2, cls: 'cme-matrix-subgroup', moreItems: [
          // Floor
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M12 12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M52 12V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left\\lfloor#0\\right\\rfloor', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Floor Brackets' },
          // { label: '⌊ ⌋', insert: '\\lfloor #? \\rfloor', isWidget: true, title: 'Lfloor' },

          // Angle bracket with bar
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 18L2 29L10 40" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="16" y="18" width="10" height="20" rx="1" /><line x1="32" y1="18" x2="32" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="42" y="18" width="10" height="20" rx="1" /><path d="M54 18L62 29L54 40" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\left\\langle#?\\mid#?\\right\\rangle', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Angle Brackets with Vertical Bar' },
          // { label: '〈|', insert: '\\langle #? \\mid #? \\rangle', isWidget: true, title: 'Langle' },

          // Ceiling
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M12 52V12H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M52 52V12H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left\\lceil#0\\right\\rceil', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Ceiling Brackets' },
          // { label: '⌈ ⌉', insert: '\\lceil #? \\rceil', isWidget: true, title: 'Lceil' },
        ]
      },
      // Parenthes
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12 Q8 32 18 52" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12 Q56 32 46 52" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left(#0\\right)', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Parentheses' },
      // { label: '', insert: '\\left( #? \\right)', title: 'Parentheses' },

      // Vertical bars
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" /><rect x="26" y="18" width="12" height="22" rx="2" /><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" /></svg>), insert: '\\left|#0\\right|', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'vertical bars' },
      // { label: '| |', insert: '\\left| #? \\right|', title: 'Vertical bars' },

      // Angle brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 14L6 32L18 50" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="26" y="19" width="12" height="20" rx="1" /><path d="M46 14L58 32L46 50" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\left\\langle #? \\right\\rangle', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Angle Brackets' },
      // { label: '⟨ ⟩', insert: '\\left\\langle #? \\right\\rangle', title: 'Angle brackets' },

      // Square brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12H12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12H52V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left[#0\\right]', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Brackets' },
      // { label: '[ ]', insert: '\\left[ #? \\right]', title: 'Square brackets' },

      // Double vertical bars
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="10" y1="12" x2="10" y2="52" stroke="#222" strokeWidth="4" /><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" /><rect x="26" y="18" width="12" height="20" rx="1" /><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" /><line x1="54" y1="12" x2="54" y2="52" stroke="#222" strokeWidth="4" /></svg>), insert: '\\left\\Vert#?\\right\\Vert', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Double Vertical Bars' },
      // { label: '‖ ‖', insert: '\\| #? \\|', title: 'Double vertical bars' },

      // Curly brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M20 12C16 12 16 18 18 22C19 24 19 26 16 29C19 32 19 34 18 36C16 40 16 46 20 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M44 12C48 12 48 18 46 22C45 24 45 26 48 29C45 32 45 34 46 36C48 40 48 46 44 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>), insert: '\\left\\{#0\\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curly Braces' },
      // { label: '{ }', insert: '\\left\\{ #? \\right\\}', title: 'Curly brackets' },




      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Overbrace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 26V20H24C28 20 30 18 32 14C34 18 36 20 40 20H54V26" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overbrace{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overbrace' },

      // Overgroup
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 26C10 14 54 14 54 26" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overgroup{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overgroup' },

      // Underbrace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 44H24C28 44 30 46 32 50C34 46 36 44 40 44H54M10 44V38M54 44V38" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="14" width="12" height="20" rx="1" /></svg>), insert: '\\underbrace{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underbrace' },

      // Undergroup
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 38C10 50 54 50 54 38" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="14" width="12" height="20" rx="1" /></svg>), insert: '\\undergroup{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Undergroup' },








      { type: 'sep', cols: 3, small: true, cls: 'cme-symbol-subgroup' },
      // Overrightharpoon
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overrightharpoon{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right harpoon accent' },

      // Arrow accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20M40 28L48 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Arrow accent' },

      // Left-right arrow accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20M40 28L48 20M24 12L16 20M24 28L16 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left-right arrow accent' },

      // Bar accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 20H46" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Bar accent' },

      // Wide hat
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 24L32 12L46 24" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\widehat{\\mathrm{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Wide hat' },

      // Tilde accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M22 20 Q27 16 32 20 T42 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\tilde{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Tilde accent' },

      // Diaeresis accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M28 18v0M36 18v0" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\ddot{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Diaeresis accent' },

      // Dot accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M32 18v0" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\dot{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Dot accent' },



      {
        type: 'sep', cols: 3, small: true, cls: 'cme-matrix-subgroup', moreItems: [

          // Enclose actuarial
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 2 H20 V22" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
              </svg>
            ),
            insert: '\\enclose{actuarial}{\\begin{array}{@{}c@{}} \\hspace{3px}#? \\end{array}}',
            title: 'Enclose actuarial'
          },

          // Enclose rounded box

          {
            label: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="2" width="16" height="20" rx="8" ry="8" stroke="#666" strokeWidth="2" fill="none" />
              <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            </svg>, insert: '\\enclose{roundedbox}{\\raisebox{-2.5px}{#?}}', title: 'Enclose rounded box'
          },

        ]
      },

      // Bar accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 20H46" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Bar accent' },

      // Enclosed left
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="28" y="18" width="14" height="28" rx="2" /></svg>), insert: '\\left| #? \\right.', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed left' },

      // Enclosed box
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="2" width="16" height="20" stroke="#666" strokeWidth="2" fill="none" />
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
          </svg>
        ),
        insert: '\\boxed{#?}',
        forceLabel: true,
        title: 'Enclosed box'
      },

      // Enclosed bottom
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="18" y1="46" x2="46" y2="46" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="26" y="20" width="12" height="20" rx="1" /></svg>), insert: '\\underline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed bottom' },

      // Enclosed right
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="22" y="18" width="14" height="28" rx="2" /></svg>), insert: '\\left. #? \\right|', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed right' },

      // Enclosed circle
      { label: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12" rx="9" ry="11" stroke="#666666" strokeWidth="2" fill="none" /><rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>, insert: '\\enclose{circle}{\\begin{array}{@{}c@{}} \\raisebox{-2.5px}{\\,\\,#?} \\end{array}}', forceLabel: true, title: 'Enclose circle' },




      {
        type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup', moreCols: 2, moreItems: [


          //vertical
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
                <line x1="12" y1="3" x2="12" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ),
            insert: '\\enclose{verticalstrike}{#?}',
            title: 'Vertical strike'
          },

          // Long division
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M3 22 Q11 12 3 2 H21" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <rect x="11" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
              </svg>
            ),
            insert: ') \\!\\! \\overline{\\vphantom{1}\\;\\;#?\\;}',
            directInsert: true,
            title: 'Long division'
          },

          // Horizontal and vertical strike
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
                <line x1="6" y1="12" x2="18" y2="12" stroke="#666" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="3" x2="12" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ),
            insert: '\\enclose{horizontalstrike}{\\begin{array}{c@{}} \\raisebox{-8px}{\\enclose{verticalstrike}{\\vphantom{\\rule{0pt}{14px}}#?}} \\end{array}}',
            title: 'Horizontal and vertical strike'
          },


        ]
      },

      //cancel
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="21" x2="15" y2="3" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{updiagonalstrike}{#0}',
        forceLabel: true,
        title: 'Cancel strike'
      },


      // Horizontal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="6" y1="12" x2="18" y2="12" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{horizontalstrike}{\\begin{array}{c@{}} \\raisebox{-8px}{#?} \\end{array}}',
        forceLabel: true,
        title: 'Horizontal strike'
      },

      // Down diagonal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="3" x2="15" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{downdiagonalstrike}{#0}',
        forceLabel: true,
        title: 'Down diagonal strike'
      },

      // Up and down diagonal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="21" x2="15" y2="3" stroke="#666" strokeWidth="2" strokeLinecap="round" />
            <line x1="9" y1="3" x2="15" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\xcancel{#?}',
        forceLabel: true,
        title: 'Cross strike'
      },


    ]
  },

  {
    label: '∑ ⋃ ', fontSize: "8px", mathLabel: '\\sum \\, \\bigcup', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Big operator with under and over scripts
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M44 16 L22 16 L34 32 L22 48 L44 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="-3" width="10" height="12" rx="1" opacity="0.45" /><rect x="27" y="56" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\sum_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with limits' },

      // Big operator with side scripts (subscript/superscript)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M38 16 L16 16 L28 32 L16 48 L38 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="42" y="2" width="10" height="16" rx="1" opacity="0.45" /><rect x="42" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\sum\\nolimits_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with side limits' },


      // Big operator with under script
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M44 16 L22 16 L34 32 L22 48 L44 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="54" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\sum_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with subscript' },


      // Big operator with side script (subscript only)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: "visible" }}><path d="M38 16 L16 16 L28 32 L16 48 L38 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="42" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\sum\\nolimits_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with side subscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Big operator with subscript and superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M18 16 H46 M22 16 V48 M42 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="-2" width="10" height="12" rx="1" opacity="0.45" /><rect x="27" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\prod_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with limits' },


      // Big operator with side scripts (subscript/superscript)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 16 H40 M16 16 V48 M36 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="44" y="4" width="10" height="16" rx="1" opacity="0.45" /><rect x="44" y="44" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\prod\\nolimits_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with side limits' },

      // Big operator with subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M18 16 H46 M22 16 V48 M42 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\prod_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with subscript' },


      // Big operator with side script (subscript only)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 16 H40 M16 16 V48 M36 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="44" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\prod\\nolimits_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with side subscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Base with over and underscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="8" height="12" rx="1" opacity="0.45" /><rect x="22" y="22" width="12" height="20" rx="1" /><rect x="24" y="48" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{#?}{\\underset{\\raisebox{-4px}{#?}}{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Over and underscript' },


      // Right sub/superscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="1" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}^{\\raisebox{0.6em}{#?}}', isWidget: true, title: 'Subscript and superscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 4 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="28" width="12" height="18" rx="1" /><rect x="21" y="52" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\underset{\\raisebox{-4px}{#?}}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underscript' },


      // Right subscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}', isWidget: true, title: 'Subscript' },







      {
        type: 'sep', cols: 1, small: true, cls: 'cme-matrix-subgroup', moreCols: 3, moreItems: [
          { label: '⨅', insert: '⨅', title: 'Big square cap' },   // U+2A05 Big square cap
          { label: '∏', insert: '∏', title: 'Product' },   // U+220F Product
          { label: '∑', insert: '∑', title: 'Summation' },   // U+2211 Summation
          { label: '⨆', insert: '⨆', title: 'Big square cup' },   // U+2A06 Big square cup
          { label: '∐', insert: '∐', title: 'Coproduct' },   // U+2210 Coproduct
        ]
      },
      // Big Union
      { label: '⋃', insert: '\\bigcup', title: 'Big union' },

      // Big Intersection
      { label: '⋂', insert: '\\bigcap', title: 'Big intersection' },






    ]
  },

  // {
  //   label: 'sin/cos', items: [
  //     { label: 'sin', insert: '\\sin' }, { label: 'cos', insert: '\\cos' },
  //     { label: 'tan', insert: '\\tan' }, { label: 'cot', insert: '\\cot' },
  //     { label: 'sec', insert: '\\sec' }, { label: 'csc', insert: '\\csc' },


  //     { label: 'sin(□)', insert: '\\sin\\left(#0\\right)' },
  //     { label: 'cos(□)', insert: '\\cos\\left(#0\\right)' },
  //     { label: 'tan(□)', insert: '\\tan\\left(#0\\right)' },

  //     { label: 'sin⁻¹', insert: '\\sin^{-1}' }, { label: 'cos⁻¹', insert: '\\cos^{-1}' },
  //     { label: 'tan⁻¹', insert: '\\tan^{-1}' },
  //     { label: 'sin²x', insert: '\\sin^{2}\\left(#0\\right)' },
  //     { label: 'cos²x', insert: '\\cos^{2}\\left(#0\\right)' },
  //     { label: 'tan²x', insert: '\\tan^{2}\\left(#0\\right)' },

  //     { label: 'sinh', insert: '\\sinh' }, { label: 'cosh', insert: '\\cosh' },
  //     { label: 'tanh', insert: '\\tanh' },
  //     { label: 'ln', insert: '\\ln' },
  //     { label: 'exp', insert: '\\exp' },
  //   ]
  // },

  {
    label: '∫ lim', fontSize: "7px", mathLabel: '\\int_{#?}^{#?} \\, \\lim', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      //infinity 
      { label: (<svg width="24" height="26" viewBox="0 0 44 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="24" y="10" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\int_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Int' },
      { label: (<svg width="40" height="26" viewBox="0 0 96 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="24" y="10" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="42" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="62" y="38" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" stroke="none">d</text><rect x="76" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\int_{#?}^{#?} #0 \\, d#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Definite integral' },
      { label: (<svg width="24" height="26" viewBox="0 0 44 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\int_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Integral with subscript' },
      { label: (<svg width="40" height="26" viewBox="0 0 96 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="42" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="62" y="38" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" stroke="none">d</text><rect x="76" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\int_{#?} #?\\,d#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Integral with subscript and differential' },



      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      //derivatives
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="32" y="42" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="36" fill="#222" textAnchor="middle">d</text></svg>), insert: '\\mathrm{d}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Mathrm d' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><line x1="8" y1="32" x2="56" y2="32" stroke="#222" strokeWidth="3" /><text x="22" y="24" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">d</text><rect x="32" y="8" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="22" y="54" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">d</text><rect x="32" y="38" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\frac{d#?}{d#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Derivative' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="32" y="44" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="36" fill="#222" textAnchor="middle">∂</text></svg>), insert: '\\partial', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Partial differential' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><line x1="8" y1="32" x2="56" y2="32" stroke="#222" strokeWidth="3" /><text x="22" y="24" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">∂</text><rect x="32" y="8" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="22" y="54" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">∂</text><rect x="32" y="38" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\frac{\\partial#?}{\\partial #?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Partial derivative' },


      { type: 'sep', cols: 1, small: true, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><text x="32" y="32" fill="#222" stroke="none" fontSize="24" fontFamily="serif" textAnchor="middle">lim</text><rect x="14" y="40" width="10" height="14" rx="1" opacity="0.45" /><text x="28" y="52" fill="#222" stroke="none" fontSize="16" fontFamily="sans-serif">→</text><text x="44" y="52" fill="#222" stroke="none" fontSize="18" fontFamily="serif">∞</text></svg>), insert: '\\lim_{#?\\to\\infty}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Limit to infinity' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><text x="32" y="32" fill="#222" stroke="none" fontSize="24" fontFamily="serif" textAnchor="middle">lim</text><rect x="24" y="40" width="16" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\lim_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Limit' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 24 L28 24 L20 40 Z" stroke="#222" strokeWidth="3" fill="none" strokeLinejoin="round" /><path d="M34 26 L46 38 M46 26 L34 38" stroke="#222" strokeWidth="3" fill="none" strokeLinecap="round" /><rect x="50" y="22" width="12" height="20" rx="1" /></svg>), insert: '\\nabla\\times #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curl' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M16 24 L36 24 L26 44 Z" stroke="#222" strokeWidth="4" fill="none" strokeLinejoin="round" /><rect x="44" y="24" width="16" height="20" rx="1" /></svg>), insert: '\\nabla #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Gradient' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 24 L28 24 L20 40 Z" stroke="#222" strokeWidth="3" fill="none" strokeLinejoin="round" /><circle cx="38" cy="32" r="3" fill="#222" stroke="none" /><rect x="46" y="22" width="12" height="20" rx="1" /></svg>), insert: '\\nabla\\cdot #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Divergence' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M26 16 L12 44 L40 44 Z" stroke="#222" strokeWidth="4" fill="none" strokeLinejoin="round" /><rect x="46" y="24" width="16" height="20" rx="1" /></svg>), insert: '\\Delta #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Laplacian' },

      {
        type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup', moreItems: [

          { label: '∭', insert: '\\iiint', title: 'Triple integral' },
          // { label: '∰', insert: '\\oiiint', title: 'Closed volume integral' },
          { label: '∰', insert: '\\mathop{{\\style{font-size:1em;}{\\iiint}}\\mkern-28mu\\class{wider-circle}{\\bigcirc}\\mkern18mu}', title: 'Closed volume integral' },


        ]
      },
      { label: '∫', insert: '\\int', title: 'Integral' },
      { label: '∬', insert: '\\iint', title: 'Double integral' },
      { label: '∮', insert: '\\oint', title: 'Contour integral' },
      // { label: '∯', insert: '\\oiint', title: 'surface integral' },
      { label: '∯', insert: '\\mathop{{\\style{font-size:1em;}{\\iint}}\\mkern-23mu\\class{wide-circle}{\\bigcirc}\\mkern14mu}', title: 'Custom surface integral' },


      {
        type: 'sep', cols: 3, cls: 'cme-trig-subgroup', moreCols: '3', moreItems: [
          { label: 'csc', insert: '\\csc\\left(#?\\right)', title: 'Cosecant' },
          { label: 'sec', insert: '\\sec\\left(#?\\right)', title: 'Secant' },
          { label: 'cot', insert: '\\cot\\left(#?\\right)', title: 'Cotangent' },
          { label: 'sin⁻¹', insert: '\\sin^{-1}', title: 'Inverse sine' },
          { label: 'cos⁻¹', insert: '\\cos^{-1}', title: 'Inverse cosine' },
          { label: 'tan⁻¹', insert: '\\tan^{-1}', title: 'Inverse tangent' },
        ]
      },
      { label: 'sin', insert: '\\sin', title: 'Sine' },
      { label: 'cos', insert: '\\cos', title: 'Cosine' },
      { label: 'tan', insert: '\\tan', title: 'Tangent' },
      { label: 'log', insert: '\\log', title: 'Logarithm' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="2" y="42" fontFamily="serif" fontSize="28" fill="#222" stroke="none">log</text><rect x="42" y="36" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\log_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Logarithm with base' },
      { label: 'ln', insert: '\\ln', title: 'Natural logarithm' },


      // { label: '∫∫dA', insert: '\\iint_{#?} #0 \\, dA' },
      // { label: '∮C', insert: '\\oint_{#?} #0 \\, d#?' },
      // { label: '∫∫∫dV', insert: '\\iiint_{#?} #0 \\, dV' },
      // { label: '∫_C', insert: '\\int_{C} #0 \\, d#?' },
      // { label: '∮_C', insert: '\\oint_{C} #0 \\, d#?' },
      // { label: '∫∫_D', insert: '\\iint_{D} #0 \\, dA' },

      // { label: 'u-sub', insert: '\\int #0 \\, du' },

      // { label: '∭', insert: '\\iiint' },   // Triple integral
      // { label: '∰', insert: '\\oiiint' },   // Closed volume integral




    ]
  },
  // {
  //   label: (
  //     <svg
  //       xmlns="http://www.w3.org/2000/svg"
  //       viewBox="0 0 64 64"
  //       width="20"
  //       height="20"
  //       fill="none"
  //       stroke="currentColor"
  //       strokeWidth="3"
  //       strokeLinecap="round"
  //       strokeLinejoin="round"
  //       style={{ verticalAlign: 'middle' }}
  //     >
  //       <path d="M32 12 L24 24 H40 Z" fill="currentColor" />
  //       <path d="M16 36 C16 48, 48 48, 48 36" />
  //       <path d="M22 36 C22 43, 42 43, 42 36" />
  //     </svg>
  //   ),

  //   items: [

  //     { type: 'sep', cols: 2, cls: 'cme-trig-subgroup' }


  //   ]
  // },





];

const CHEM_GROUPS = [

  {
    label: 'H₂O', isChem: true,
    items: [
      {
        type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup', moreCols: 18, moreItems: [
          // Row 1
          { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H', cls: 'pt-unknown' },
          ...Array.from({ length: 16 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'He', insert: '\\mathrm{He}', title: 'Mathrm He', cls: 'pt-noble' },

          // Row 2
          { label: 'Li', insert: '\\mathrm{Li}', title: 'Mathrm Li', cls: 'pt-alkali' },
          { label: 'Be', insert: '\\mathrm{Be}', title: 'Mathrm Be', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'B', insert: '\\mathrm{B}', title: 'Mathrm B', cls: 'pt-nonmetal' },
          { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C', cls: 'pt-nonmetal' },
          { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N', cls: 'pt-nonmetal' },
          { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O', cls: 'pt-nonmetal' },
          { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F', cls: 'pt-nonmetal' },
          { label: 'Ne', insert: '\\mathrm{Ne}', title: 'Mathrm Ne', cls: 'pt-noble' },

          // Row 3
          { label: 'Na', insert: '\\mathrm{Na}', title: 'Mathrm Na', cls: 'pt-alkali' },
          { label: 'Mg', insert: '\\mathrm{Mg}', title: 'Mathrm Mg', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Al', insert: '\\mathrm{Al}', title: 'Mathrm Al', cls: 'pt-metalloid' },
          { label: 'Si', insert: '\\mathrm{Si}', title: 'Mathrm Si', cls: 'pt-metalloid' },
          { label: 'P', insert: '\\mathrm{P}', title: 'Mathrm P', cls: 'pt-nonmetal' },
          { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S', cls: 'pt-nonmetal' },
          { label: 'Cl', insert: '\\mathrm{Cl}', title: 'Mathrm Cl', cls: 'pt-nonmetal' },
          { label: 'Ar', insert: '\\mathrm{Ar}', title: 'Mathrm Ar', cls: 'pt-noble' },

          // Row 4
          { label: 'K', insert: '\\mathrm{K}', title: 'Mathrm K', cls: 'pt-alkali' },
          { label: 'Ca', insert: '\\mathrm{Ca}', title: 'Mathrm Ca', cls: 'pt-alkaline' },
          { label: 'Sc', insert: '\\mathrm{Sc}', title: 'Mathrm Sc', cls: 'pt-transition' },
          { label: 'Ti', insert: '\\mathrm{Ti}', title: 'Mathrm Ti', cls: 'pt-transition' },
          { label: 'V', insert: '\\mathrm{V}', title: 'Mathrm V', cls: 'pt-transition' },
          { label: 'Cr', insert: '\\mathrm{Cr}', title: 'Mathrm Cr', cls: 'pt-transition' },
          { label: 'Mn', insert: '\\mathrm{Mn}', title: 'Mathrm Mn', cls: 'pt-transition' },
          { label: 'Fe', insert: '\\mathrm{Fe}', title: 'Mathrm Fe', cls: 'pt-transition' },
          { label: 'Co', insert: '\\mathrm{Co}', title: 'Mathrm Co', cls: 'pt-transition' },
          { label: 'Ni', insert: '\\mathrm{Ni}', title: 'Mathrm Ni', cls: 'pt-transition' },
          { label: 'Cu', insert: '\\mathrm{Cu}', title: 'Mathrm Cu', cls: 'pt-transition' },
          { label: 'Zn', insert: '\\mathrm{Zn}', title: 'Mathrm Zn', cls: 'pt-transition' },
          { label: 'Ga', insert: '\\mathrm{Ga}', title: 'Mathrm Ga', cls: 'pt-metalloid' },
          { label: 'Ge', insert: '\\mathrm{Ge}', title: 'Mathrm Ge', cls: 'pt-metalloid' },
          { label: 'As', insert: '\\mathrm{As}', title: 'Mathrm As', cls: 'pt-nonmetal' },
          { label: 'Se', insert: '\\mathrm{Se}', title: 'Mathrm Se', cls: 'pt-nonmetal' },
          { label: 'Br', insert: '\\mathrm{Br}', title: 'Mathrm Br', cls: 'pt-nonmetal' },
          { label: 'Kr', insert: '\\mathrm{Kr}', title: 'Mathrm Kr', cls: 'pt-noble' },

          // Row 5
          { label: 'Rb', insert: '\\mathrm{Rb}', title: 'Mathrm Rb', cls: 'pt-alkali' },
          { label: 'Sr', insert: '\\mathrm{Sr}', title: 'Mathrm Sr', cls: 'pt-alkaline' },
          { label: 'Y', insert: '\\mathrm{Y}', title: 'Mathrm Y', cls: 'pt-transition' },
          { label: 'Zr', insert: '\\mathrm{Zr}', title: 'Mathrm Zr', cls: 'pt-transition' },
          { label: 'Nb', insert: '\\mathrm{Nb}', title: 'Mathrm Nb', cls: 'pt-transition' },
          { label: 'Mo', insert: '\\mathrm{Mo}', title: 'Mathrm Mo', cls: 'pt-transition' },
          { label: 'Tc', insert: '\\mathrm{Tc}', title: 'Mathrm Tc', cls: 'pt-transition' },
          { label: 'Ru', insert: '\\mathrm{Ru}', title: 'Mathrm Ru', cls: 'pt-transition' },
          { label: 'Rh', insert: '\\mathrm{Rh}', title: 'Mathrm Rh', cls: 'pt-transition' },
          { label: 'Pd', insert: '\\mathrm{Pd}', title: 'Mathrm Pd', cls: 'pt-transition' },
          { label: 'Ag', insert: '\\mathrm{Ag}', title: 'Mathrm Ag', cls: 'pt-transition' },
          { label: 'Cd', insert: '\\mathrm{Cd}', title: 'Mathrm Cd', cls: 'pt-transition' },
          { label: 'In', insert: '\\mathrm{In}', title: 'Mathrm In', cls: 'pt-metalloid' },
          { label: 'Sn', insert: '\\mathrm{Sn}', title: 'Mathrm Sn', cls: 'pt-metalloid' },
          { label: 'Sb', insert: '\\mathrm{Sb}', title: 'Mathrm Sb', cls: 'pt-metalloid' },
          { label: 'Te', insert: '\\mathrm{Te}', title: 'Mathrm Te', cls: 'pt-nonmetal' },
          { label: 'I', insert: '\\mathrm{I}', title: 'Mathrm I', cls: 'pt-nonmetal' },
          { label: 'Xe', insert: '\\mathrm{Xe}', title: 'Mathrm Xe', cls: 'pt-noble' },

          // Row 6
          { label: 'Cs', insert: '\\mathrm{Cs}', title: 'Mathrm Cs', cls: 'pt-alkali' },
          { label: 'Ba', insert: '\\mathrm{Ba}', title: 'Mathrm Ba', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Hf', insert: '\\mathrm{Hf}', title: 'Mathrm Hf', cls: 'pt-transition' },
          { label: 'Ta', insert: '\\mathrm{Ta}', title: 'Mathrm Ta', cls: 'pt-transition' },
          { label: 'W', insert: '\\mathrm{W}', title: 'Mathrm W', cls: 'pt-transition' },
          { label: 'Re', insert: '\\mathrm{Re}', title: 'Mathrm Re', cls: 'pt-transition' },
          { label: 'Os', insert: '\\mathrm{Os}', title: 'Mathrm Os', cls: 'pt-transition' },
          { label: 'Ir', insert: '\\mathrm{Ir}', title: 'Mathrm Ir', cls: 'pt-transition' },
          { label: 'Pt', insert: '\\mathrm{Pt}', title: 'Mathrm Pt', cls: 'pt-transition' },
          { label: 'Au', insert: '\\mathrm{Au}', title: 'Mathrm Au', cls: 'pt-transition' },
          { label: 'Hg', insert: '\\mathrm{Hg}', title: 'Mathrm Hg', cls: 'pt-transition' },
          { label: 'Tl', insert: '\\mathrm{Tl}', title: 'Mathrm Tl', cls: 'pt-metalloid' },
          { label: 'Pb', insert: '\\mathrm{Pb}', title: 'Mathrm Pb', cls: 'pt-metalloid' },
          { label: 'Bi', insert: '\\mathrm{Bi}', title: 'Mathrm Bi', cls: 'pt-metalloid' },
          { label: 'Po', insert: '\\mathrm{Po}', title: 'Mathrm Po', cls: 'pt-metalloid' },
          { label: 'At', insert: '\\mathrm{At}', title: 'Mathrm At', cls: 'pt-nonmetal' },
          { label: 'Rn', insert: '\\mathrm{Rn}', title: 'Mathrm Rn', cls: 'pt-noble' },

          // Row 7
          { label: 'Fr', insert: '\\mathrm{Fr}', title: 'Mathrm Fr', cls: 'pt-alkali' },
          { label: 'Ra', insert: '\\mathrm{Ra}', title: 'Mathrm Ra', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Rf', insert: '\\mathrm{Rf}', title: 'Mathrm Rf', cls: 'pt-transition' },
          { label: 'Db', insert: '\\mathrm{Db}', title: 'Mathrm Db', cls: 'pt-transition' },
          { label: 'Sg', insert: '\\mathrm{Sg}', title: 'Mathrm Sg', cls: 'pt-transition' },
          { label: 'Bh', insert: '\\mathrm{Bh}', title: 'Mathrm Bh', cls: 'pt-transition' },
          { label: 'Hs', insert: '\\mathrm{Hs}', title: 'Mathrm Hs', cls: 'pt-transition' },
          { label: 'Mt', insert: '\\mathrm{Mt}', title: 'Mathrm Mt', cls: 'pt-transition' },
          { label: 'Ds', insert: '\\mathrm{Ds}', title: 'Mathrm Ds', cls: 'pt-transition' },
          { label: 'Rg', insert: '\\mathrm{Rg}', title: 'Mathrm Rg', cls: 'pt-transition' },
          { label: 'Cn', insert: '\\mathrm{Cn}', title: 'Mathrm Cn', cls: 'pt-transition' },
          { label: 'Nh', insert: '\\mathrm{Nh}', title: 'Mathrm Nh', cls: 'pt-metalloid' },
          { label: 'Fl', insert: '\\mathrm{Fl}', title: 'Mathrm Fl', cls: 'pt-metalloid' },
          { label: 'Mc', insert: '\\mathrm{Mc}', title: 'Mathrm Mc', cls: 'pt-metalloid' },
          { label: 'Lv', insert: '\\mathrm{Lv}', title: 'Mathrm Lv', cls: 'pt-metalloid' },
          { label: 'Ts', insert: '\\mathrm{Ts}', title: 'Mathrm Ts', cls: 'pt-unknown' },
          { label: 'Og', insert: '\\mathrm{Og}', title: 'Mathrm Og', cls: 'pt-unknown' },

          // Gap Row
          ...Array.from({ length: 18 }, () => ({ label: '', cls: 'pt-empty' })),

          // Row Lanthanides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'La', insert: '\\mathrm{La}', title: 'Mathrm La', cls: 'pt-transition' },
          { label: 'Ce', insert: '\\mathrm{Ce}', title: 'Mathrm Ce', cls: 'pt-lanthanide' },
          { label: 'Pr', insert: '\\mathrm{Pr}', title: 'Mathrm Pr', cls: 'pt-lanthanide' },
          { label: 'Nd', insert: '\\mathrm{Nd}', title: 'Mathrm Nd', cls: 'pt-lanthanide' },
          { label: 'Pm', insert: '\\mathrm{Pm}', title: 'Mathrm Pm', cls: 'pt-lanthanide' },
          { label: 'Sm', insert: '\\mathrm{Sm}', title: 'Mathrm Sm', cls: 'pt-lanthanide' },
          { label: 'Eu', insert: '\\mathrm{Eu}', title: 'Mathrm Eu', cls: 'pt-lanthanide' },
          { label: 'Gd', insert: '\\mathrm{Gd}', title: 'Mathrm Gd', cls: 'pt-lanthanide' },
          { label: 'Tb', insert: '\\mathrm{Tb}', title: 'Mathrm Tb', cls: 'pt-lanthanide' },
          { label: 'Dy', insert: '\\mathrm{Dy}', title: 'Mathrm Dy', cls: 'pt-lanthanide' },
          { label: 'Ho', insert: '\\mathrm{Ho}', title: 'Mathrm Ho', cls: 'pt-lanthanide' },
          { label: 'Er', insert: '\\mathrm{Er}', title: 'Mathrm Er', cls: 'pt-lanthanide' },
          { label: 'Tm', insert: '\\mathrm{Tm}', title: 'Mathrm Tm', cls: 'pt-lanthanide' },
          { label: 'Yb', insert: '\\mathrm{Yb}', title: 'Mathrm Yb', cls: 'pt-lanthanide' },
          { label: 'Lu', insert: '\\mathrm{Lu}', title: 'Mathrm Lu', cls: 'pt-lanthanide' },
          { label: '', cls: 'pt-empty' },

          // Row Actinides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Ac', insert: '\\mathrm{Ac}', title: 'Mathrm Ac', cls: 'pt-actinide' },
          { label: 'Th', insert: '\\mathrm{Th}', title: 'Mathrm Th', cls: 'pt-actinide' },
          { label: 'Pa', insert: '\\mathrm{Pa}', title: 'Mathrm Pa', cls: 'pt-actinide' },
          { label: 'U', insert: '\\mathrm{U}', title: 'Mathrm U', cls: 'pt-actinide' },
          { label: 'Np', insert: '\\mathrm{Np}', title: 'Mathrm Np', cls: 'pt-actinide' },
          { label: 'Pu', insert: '\\mathrm{Pu}', title: 'Mathrm Pu', cls: 'pt-actinide' },
          { label: 'Am', insert: '\\mathrm{Am}', title: 'Mathrm Am', cls: 'pt-actinide' },
          { label: 'Cm', insert: '\\mathrm{Cm}', title: 'Mathrm Cm', cls: 'pt-actinide' },
          { label: 'Bk', insert: '\\mathrm{Bk}', title: 'Mathrm Bk', cls: 'pt-actinide' },
          { label: 'Cf', insert: '\\mathrm{Cf}', title: 'Mathrm Cf', cls: 'pt-actinide' },
          { label: 'Es', insert: '\\mathrm{Es}', title: 'Mathrm Es', cls: 'pt-actinide' },
          { label: 'Fm', insert: '\\mathrm{Fm}', title: 'Mathrm Fm', cls: 'pt-actinide' },
          { label: 'Md', insert: '\\mathrm{Md}', title: 'Mathrm Md', cls: 'pt-actinide' },
          { label: 'No', insert: '\\mathrm{No}', title: 'Mathrm No', cls: 'pt-actinide' },
          { label: 'Lr', insert: '\\mathrm{Lr}', title: 'Mathrm Lr', cls: 'pt-actinide' },
          { label: '', cls: 'pt-empty' },
        ]
      },
      { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H' },   // Hydrogen
      { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C' },   // Carbon
      { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N' },   // Nitrogen
      { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O' },   // Oxygen
      { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F' },   // Fluorine
      { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S' },   // Sulfur

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },

      { label: '°', insert: '^\\circ', title: 'Degree' },
      { label: 'Δ', insert: '\\Delta', title: 'Increment / Delta' },
      { label: 'mol', insert: '\\mathrm{mol}', title: 'Mathrm mol' },

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },

      { label: '-', insert: '-', title: 'Single bond' },
      { label: '=', insert: '=', title: 'Double bond' },
      { label: '≡', insert: '\\equiv', title: 'Triple bond' },

      {
        type: 'sep', cols: 3, small: true, cls: 'cme-trig-subgroup', moreCols: 3, moreItems: [
          { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 32 L 56 32 M 44 20 L 56 32 L 44 44" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="2" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /><rect x="24" y="50" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\overset{#?}{\\rightarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right arrow with overscript and underscript' },
          { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 26 L 56 26 M 44 14 L 56 26 M 56 38 L 8 38 M 20 50 L 8 38" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="2" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /><rect x="24" y="50" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\overset{#?}{\\rightleftharpoons}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium with overscript and underscript' },
          { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 24 L 56 24 M 46 14 L 56 24 L 46 34 M 56 40 L 8 40 M 18 30 L 8 40 L 18 50" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="2" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /><rect x="24" y="50" width="16" height="12" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\overset{#?}{\\rightleftarrows}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right left arrows with overscript and underscript' },
        ]
      },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 32 L 56 32 M 44 20 L 56 32 L 44 44" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>), insert: '\\rightarrow', title: 'Right arrow' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 44 L 56 44 M 44 32 L 56 44 L 44 56" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="12" width="16" height="16" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\overset{#?}{\\rightarrow}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right arrow with overscript' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 20 L 56 20 M 44 8 L 56 20 L 44 32" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="36" width="16" height="16" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\rightarrow}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right arrow with underscript' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 24 L 56 24 M 44 12 L 56 24 M 56 40 L 8 40 M 20 52 L 8 40" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>), insert: '\\rightleftharpoons', title: 'Equilibrium' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 32 L 56 32 M 44 20 L 56 32 M 56 48 L 8 48 M 20 60 L 8 48" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="2" width="16" height="14" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\overset{#?}{\\rightleftharpoons}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium with overscript' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 16 L 56 16 M 44 4 L 56 16 M 56 32 L 8 32 M 20 44 L 8 32" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="48" width="16" height="14" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\rightleftharpoons}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium with underscript' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 22 L 56 22 M 46 12 L 56 22 L 46 32 M 56 42 L 8 42 M 18 32 L 8 42 L 18 52" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>), insert: '\\rightleftarrows', title: 'Right left arrows' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 32 L 56 32 M 46 22 L 56 32 L 46 42 M 56 52 L 8 52 M 18 42 L 8 52 L 18 62" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="2" width="16" height="14" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\overset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right left arrows with overscript' },
      { label: (<svg width="14" height="14" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><path d="M 8 12 L 56 12 M 46 2 L 56 12 L 46 22 M 56 32 L 8 32 M 18 22 L 8 32 L 18 42" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="48" width="16" height="14" rx="2" stroke="#2E7D32" strokeWidth="4" fill="none" /></svg>), insert: '\\underset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right left arrows with underscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },


      // Superscript and subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /><rect x="32" y="36" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box with Subscript' },
      // { label: 'xⁿₖ', insert: '{#?}_{#?}^{#?}', title: 'Subscript and superscript' },


      // Superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box' },
      // { label: 'xⁿ', insert: '{#?}^{#?}', title: 'Superscript' },


      // Left subscript and superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="8" width="10" height="16" rx="1" opacity="0.45" /><rect x="18" y="36" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="20" width="12" height="20" rx="1" /></svg>), insert: '{}_{#?}^{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Superscript and Subscript' },
      // { label: 'ⁿₖx', insert: '{}_{#?}^{#?}{#?}', title: 'Left subscript and superscript' },


      // Subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="14" width="12" height="20" rx="1" /><rect x="36" y="28" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Lowered Box' },
      // { label: 'xₖ', insert: '{#?}_{#?}', title: 'Subscript' },


      { type: 'sep', cols: 1, small: true },

      //parenthesisi
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12 Q8 32 18 52" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12 Q56 32 46 52" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left(#0\\right)', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Parentheses' },
      //square brackets 
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12H12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12H52V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left[#0\\right]', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Brackets' },
      // Curly brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M20 12C16 12 16 18 18 22C19 24 19 26 16 29C19 32 19 34 18 36C16 40 16 46 20 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="18" width="12" height="22" rx="2" strokeWidth="4" /><path d="M44 12C48 12 48 18 46 22C45 24 45 26 48 29C45 32 45 34 46 36C48 40 48 46 44 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>), insert: '\\left\\{ #? \\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curly brackets' },

      { type: 'sep', cols: 1 },
      // 6. Undo / Redo (1 col)
      { label: '↶', action: 'UNDO', title: 'Undo' },
      { label: '↷', action: 'REDO', title: 'Redo' },

      { type: 'sep', cols: 2 },
      // 7. Formatting Group (2 cols)
      { label: <FontAwesomeIcon icon={faBold} />, action: 'BOLD', cls: 'template', title: 'Bold' },
      { label: <FontAwesomeIcon icon={faItalic} />, action: 'ITALIC', cls: 'template', title: 'Italic' },
      {
        label: (
          <img
            src={OmegaIcon}
            alt="Omega"
            width="18"
            height="18"
            style={{ display: 'block' }}
          />
        ), title: 'Insert Special Character', action: 'SPECIAL_CHARS'
      },

      {
        label: (
          <img
            src={PaletteIcon}
            alt="Palette"
            width="18"
            height="18"
            style={{ display: 'block' }}
          />
        ), action: 'TEXT_COLOR', title: 'Text Color'
      },



      { type: 'sep', cols: 1 },
      // 9. Font Controls (1 col)
      { type: 'dropdown', label: 'Font...' },
      { type: 'dropdown', label: 'Size' }

    ]
  },
  {
    label: '∈ ∞', items: [

      // Group 1 – Cancel (1 col × 1 row)
      { type: 'sep', cols: 1, small: true },
      { label: '⌿', insert: '\\cancel{#?}', isWidget: true, title: 'Cancel strike' },

      // Group 2 – Arithmetic (3 cols × 3 rows)
      {
        type: 'sep', cols: 3, small: true, moreItems: [

          { label: '∖', insert: '\\setminus', title: 'Set minus' },
          { label: '\\', insert: '\\backslash', title: 'Reverse solidus' },
          { label: '∓', insert: '\\mp', title: 'Minus or plus' },
        ]
      },
      { label: '+', insert: '+', title: 'Plus' },
      { label: '×', insert: '\\times', title: 'Multiply' },
      { label: '·', insert: '\\cdot', title: 'Dot product' },
      { label: '−', insert: '-', title: 'Minus' },
      { label: '÷', insert: '\\div', title: 'Divide sign' },
      { label: '/', insert: '/', title: 'Slash' },

      { label: '±', insert: '\\pm', title: 'Plus-minus' },

      { label: '*', insert: '\\ast', title: 'Asterisk' },
      { label: '○', insert: '\\circ', title: 'Circle' },


      // Group 3 – Constants & Symbols (3 cols × 3 rows)
      {
        type: 'sep', cols: 3, small: true, moreItems: [
          { label: '‴', insert: '\\prime\\prime\\prime', title: 'Triple prime' },
          { label: '⁗', insert: '\\prime\\prime\\prime\\prime', title: 'Quadruple prime' },
          { label: '‵', insert: '\\backprime', title: 'Reversed prime' },
        ]
      },
      { label: 'π', insert: '\\pi', title: 'Pi' },
      { label: '∂', insert: '\\partial', title: 'Partial derivative' },
      { label: '°', insert: '^\\circ', title: 'Degree' },
      { label: '∞', insert: '\\infty', title: 'Infinity' },
      { label: 'Δ', insert: '\\Delta', title: 'Delta' },
      { label: "'", insert: "'", title: 'Prime' },
      { label: '∅', insert: '\\emptyset', title: 'Empty set' },
      { label: '∇', insert: '\\nabla', title: 'Nabla / Gradient' },
      { label: "''", insert: "''", title: 'Double prime' },

      // Group 4 – Equality (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, moreCols: 2, small: true, moreItems: [
          { label: '≠', insert: '\\neq', title: 'Not equal' },
          { label: '≉', insert: '\\not\\approx', title: 'Not almost equal to' },
          { label: '≢', insert: '\\not\\equiv', title: 'Not identical to' },
          { label: '≁', insert: '\\not\\sim', title: 'Not similar' },
        ]
      },
      { label: '=', insert: '=', title: 'Equals' },
      { label: '≡', insert: '\\equiv', title: 'Equivalent' },
      { label: '∼', insert: '\\sim', title: 'Similar to' },

      { label: '≈', insert: '\\approx', title: 'Approximately equal' },
      { label: '≃', insert: '\\simeq', title: 'Asymptotically equal' },
      { label: '≅', insert: '\\cong', title: 'Congruent' },
      // Group 5 – Comparison (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 3, moreItems: [
          { label: '≨', insert: '\\lneqq', title: 'Less than but not equal to' },
          { label: '≫', insert: '\\gg', title: 'Much greater than' },
          { label: '≻', insert: '\\succ', title: 'Succeeds' },
          { label: '≩', insert: '\\gneqq', title: 'Greater than but not equal to' },
          { label: '∝', insert: '\\propto', title: 'Proportional to' },
          { label: '⊲', insert: '\\triangleleft', title: 'Normal subgroup of' },
          { label: '≪', insert: '\\ll', title: 'Much less than' },
          { label: '≺', insert: '\\prec', title: 'Precedes' },
          { label: '⊳', insert: '\\triangleright', title: 'Contains as normal subgroup' },
        ]
      },
      { label: '>', insert: '>', title: 'Greater than' },
      { label: '<', insert: '<', title: 'Less than' },
      { label: '≥', insert: '\\geq', title: 'Greater than or equal' },
      { label: '≤', insert: '\\leq', title: 'Less than or equal' },
      { label: '⩾', insert: '\\geqslant', title: 'Greater than or equal slant' },
      { label: '⩽', insert: '\\leqslant', title: 'Less than or equal slant' },

      // Group 6 – Set Theory (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 4, moreItems: [
          { label: '∉', insert: '\\notin', title: 'Not an element of' },
          { label: '∌', insert: '\\not\\ni', title: 'Does not contain as member' },

          { label: '⊆', insert: '\\subseteq', title: 'Subset of or equal to' },
          { label: '⊇', insert: '\\supseteq', title: 'Superset of or equal to' },

          { label: '⊏', insert: '\\sqsubset', title: 'Square image of' },
          { label: '⊐', insert: '\\sqsupset', title: 'Square original of' },

          { label: '⊑', insert: '\\sqsubseteq', title: 'Square image of or equal to' },
          { label: '⊒', insert: '\\sqsupseteq', title: 'Square original of or equal to' },

          { label: '⊓', insert: '\\sqcap', title: 'Square intersection' },
          { label: '⊔', insert: '\\sqcup', title: 'Square union' },
        ]
      },
      { label: '∈', insert: '\\in', title: 'Element of' },
      { label: '∋', insert: '\\ni', title: 'Contains as member' },
      { label: '∪', insert: '\\cup', title: 'Union' },
      { label: '∩', insert: '\\cap', title: 'Intersection' },
      { label: '⊂', insert: '\\subset', title: 'Subset' },
      { label: '⊃', insert: '\\supset', title: 'Superset' },


      // Group 7 – Logic (2 cols × 3 rows)
      {
        type: 'sep', cols: 2, small: true, moreCols: 1, moreItems: [
          { label: '∴', insert: '\\therefore', title: 'Therefore' },
          { label: '∵', insert: '\\because', title: 'Because' },
        ]
      },
      { label: '∧', insert: '\\land', title: 'Logical AND' },
      { label: '∨', insert: '\\lor', title: 'Logical OR' },
      { label: '¬', insert: '\\neg', title: 'Logical NOT' },
      { label: '∀', insert: '\\forall', title: 'For all' },
      { label: '∃', insert: '\\exists', title: 'Exists' },
      { label: '∄', insert: '\\nexists', title: 'Does not exist' },

      // Group 8 – Geometry Lines (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 2, moreItems: [
          { label: '∦', insert: '\\nparallel', title: 'Not parallel to' },
          { label: '⋄', insert: '\\diamond', title: 'Diamond' },
          { label: '∡', insert: '\\measuredangle', title: 'Measured angle' },
          { label: '∢', insert: '\\sphericalangle', title: 'Spherical angle' }
        ]
      },
      { label: '∠', insert: '\\angle', title: 'Angle' },
      { label: '∥', insert: '\\parallel', title: 'Parallel' },
      { label: '⊥', insert: '\\perp', title: 'Perpendicular' },

      // Group 9 – Geometry Shapes (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 1, moreItems: [
          { label: '▭', insert: '▭', title: 'Rectangle' },
          { label: '▱', insert: '▱', title: 'Parallelogram' },
        ]
      },
      { label: '□', insert: '\\square', title: 'Square' },
      { label: '△', insert: '\\triangle', title: 'Triangle' },
      { label: '○', insert: '\\circ', title: 'Circle' },

      // Group 10 – Circle Ops (1 col × 3 rows)
      {
        type: 'sep', cols: 1, small: true, moreCols: 2, moreItems: [
          { label: '⊝', insert: '⊝', title: 'Circled dash' },
          { label: '•', insert: '\\bullet', title: 'Bullet' },
          { label: '⊛', insert: '⊛', title: 'Circled asterisk' },
          { label: '⨸', insert: '⨸', title: 'Circled division' },
        ]
      },
      { label: '⊕', insert: '\\oplus', title: 'Direct sum / Circled plus' },
      { label: '⊗', insert: '\\otimes', title: 'Tensor product / Circled times' },
      { label: '⊙', insert: '\\odot', title: 'Circled dot operator' },



    ]
  },
  {
    label: '→ ⋰', isTemplate: true, items: [
      {
        type: 'sep', cols: 3, small: true, cls: 'cme-trig-subgroup', moreCols: 11, moreItems: [
          { label: '↗', insert: '\\nearrow', title: 'North east arrow' },
          { label: '↘', insert: '\\searrow', title: 'South east arrow' },
          { label: '↖', insert: '\\nwarrow', title: 'North west arrow' },
          { label: '↙', insert: '\\swarrow', title: 'South west arrow' },

          { label: '⤡', insert: '\\nwsearrow', title: 'North west and south east arrow' },
          { label: '⤢', insert: '\\neswarrow', title: 'North east and south west arrow' },

          { label: '↩', insert: '\\hookleftarrow', title: 'Leftwards arrow with hook' },
          { label: '↪', insert: '\\hookrightarrow', title: 'Rightwards arrow with hook' },

          { label: '↼', insert: '\\leftharpoonup', title: 'Leftwards harpoon with barb upwards' },
          { label: '⇀', insert: '\\rightharpoonup', title: 'Rightwards harpoon with barb upwards' },

          { label: '↑', insert: '\\uparrow', title: 'Upwards arrow' },
          { label: '↓', insert: '\\downarrow', title: 'Downwards arrow' },

          { label: '⇑', insert: '\\Uparrow', title: 'Upwards double arrow' },
          { label: '⇓', insert: '\\Downarrow', title: 'Downwards double arrow' },

          { label: '⥪', insert: '⥪', title: 'Leftwards harpoon over dash' },
          { label: '⥭', insert: '⥭', title: 'Dash over rightwards harpoon' },
          { label: '⇋', insert: '\\leftrightharpoons', title: 'Leftwards harpoon over rightwards harpoon' },
          { label: '⇌', insert: '\\rightleftharpoons', title: 'Rightwards harpoon over leftwards harpoon' },

          { label: '↽', insert: '\\leftharpoondown', title: 'Leftwards harpoon with barb downwards' },
          { label: '⇁', insert: '\\rightharpoondown', title: 'Rightwards harpoon with barb downwards' },

          { label: '⇆', insert: '\\leftrightarrows', title: 'Leftwards arrow over rightwards arrow' },
          { label: '⇄', insert: '\\rightleftarrows', title: 'Rightwards arrow over leftwards arrow' },

          { label: '⇅', insert: '\\updownarrows', title: 'Upwards arrow leftwards of downwards arrow' },
          { label: '⇵', insert: '\\downuparrows', title: 'Downwards arrow leftwards of upwards arrow' },

          { label: '⥮', insert: '\\upharpoonleftdownharpoonright', title: 'Up harpoon left down harpoon right' },
          { label: '⥯', insert: '\\downharpoonleftupharpoonright', title: 'Down harpoon left up harpoon right' },


          { label: '⥂', insert: '⥂', title: 'Rightwards arrow over short leftwards arrow' },
          { label: '⥄', insert: '⥄', title: 'Short rightwards arrow over leftwards arrow' },


          { label: '↕', insert: '\\updownarrow', title: 'Up-down arrow' },
          { label: '⇕', insert: '\\Updownarrow', title: 'Up-down double arrow' },

          { label: '↵', insert: '\\hookleftarrow', title: 'Downwards arrow with corner leftwards' }
        ]
      },
      { label: '←', insert: '\\leftarrow', title: 'Left arrow' },
      { label: '→', insert: '\\rightarrow', title: 'Right arrow' },
      { label: '↔', insert: '\\leftrightarrow', title: 'Left-right arrow' },
      { label: '⇐', insert: '\\Leftarrow', title: 'Left double arrow' },
      { label: '⇒', insert: '\\Rightarrow', title: 'Right double arrow' },
      { label: '⇔', insert: '\\Leftrightarrow', title: 'Left-right double arrow' },
      { label: '↤', insert: '\\mapsfrom', title: 'Leftwards arrow from bar' },
      { label: '↦', insert: '\\mapsto', title: 'Rightwards arrow from bar' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup' },
      { label: '⋮', insert: '\\vdots', title: 'Vertical ellipses' },
      { label: '⋰', insert: '⋰', title: 'Upright diagonal ellipses' },
      { label: '…', insert: '\\ldots', title: 'Horizontal ellipses' },
      { label: '⋱', insert: '\\ddots', title: 'Down-right diagonal ellipses' },
      { label: '⋯', insert: '\\cdots', title: 'Middle line horizontal ellipses' },

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },
      { label: '-', insert: '-', title: 'Short dash (hyphen)' },
      { label: '–', insert: '–', title: 'En dash' },
      { label: '—', insert: '—', title: 'Em dash' },

      {
        type: 'sep', cols: 3, small: true, cls: 'cme-matrix-subgroup', moreCols: 11, moreItems: [

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="12" y1="38" x2="52" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 30L6 38L18 46V40H26V36H18V30Z" fill="#222" stroke="none" /><path d="M46 30L58 38L46 46V40H38V36H46V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="24" x2="52" y2="24" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 16L6 24L18 32V26H26V22H18V16Z" fill="#222" stroke="none" /><path d="M46 16L58 24L46 32V26H38V22H46V16Z" fill="#222" stroke="none" /><rect x="24" y="38" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrow[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M18 24L6 32L18 40V34H26V30H18V24Z" fill="#222" stroke="none" /><path d="M46 24L58 32L46 40V34H38V30H46V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrow with Above and Below Labels' },

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="18" y1="30" x2="52" y2="30" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 22L12 30L24 38V32H34V28H24V22Z" fill="#222" stroke="none" /><line x1="12" y1="44" x2="46" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 36L52 44L40 52V46H30V42H40V36Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftrightarrows{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="18" y1="20" x2="52" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 12L12 20L24 28V22H34V18H24V12Z" fill="#222" stroke="none" /><line x1="12" y1="34" x2="46" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 26L52 34L40 42V36H30V32H40V26Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrows[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="18" y1="26" x2="52" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 18L12 26L24 34V28H34V24H24V18Z" fill="#222" stroke="none" /><line x1="12" y1="40" x2="46" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 32L52 40L40 48V42H30V38H40V32Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightarrows[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Arrows with Above and Below Labels' },

          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="40" x2="52" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 32L12 40L24 48V42H34V38H24V32Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="20" x2="46" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 12L52 20L40 28V22H30V18H40V12Z" fill="#222" stroke="none" /><line x1="18" y1="34" x2="52" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 26L12 34L24 42V36H34V32H24V26Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\rightleftarrows}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="40" x2="52" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 32L12 40L24 48V42H34V38H24V32Z" fill="#222" stroke="none" /><rect x="28" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\rightleftarrows}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Equilibrium Arrow with Above and Below Labels' },


          //harpoons 1 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="2" width="10" height="16" rx="2" /><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\xleftrightharpoons{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightharpoons[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="27" x2="56" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 19L12 27L22 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="8" y1="37" x2="52" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 45L52 37L42 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xleftrightharpoons[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Right Harpoons with Above and Below Labels' },


          //harpoons 2
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\xrightleftharpoons{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xrightleftharpoons[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="8" y1="27" x2="52" y2="27" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M42 19L52 27L42 27" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="12" y1="37" x2="56" y2="37" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 45L12 37L22 37" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="28" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\xrightleftharpoons[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Harpoons with Above and Below Labels' },


          //arrows 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="26" x2="46" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M40 18L52 26L40 34V28H30V24H40V18Z" fill="#222" stroke="none" /><line x1="18" y1="42" x2="34" y2="42" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 34L12 42L24 50V44H30V40H24V34Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Above and Below Labels' },


          //arrow 2 
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /></svg>), insert: '\\overset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Above' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Label Below' },
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="24" y1="28" x2="42" y2="28" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 20L48 28L36 36V30H30V26H36V20Z" fill="#222" stroke="none" /><line x1="18" y1="44" x2="42" y2="44" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 36L12 44L24 52V46H30V42H24V36Z" fill="#222" stroke="none" /><rect x="24" y="46" width="10" height="16" rx="2" /></svg>), insert: '\\overset{#?}{\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Left Arrows with Above and Below Labels' },
          //   // Right-left arrow
          //   { label: '↔̅', insert: '\\overset{#?}{\\leftrightarrow}', isWidget: true, title: 'Left-right arrow with overscript' },
          //   { label: '↔̲', insert: '\\underset{#?}{\\leftrightarrow}', isWidget: true, title: 'Left-right arrow with underscript' },
          //   { label: '↔̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightarrow}}', isWidget: true, title: 'Left-right arrow with under & overscript' },

          //   { label: '⇆̅', insert: '\\overset{#?}{\\leftrightarrows}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with overscript' },

          //   // Left arrow over right arrow
          //   { label: '⇆̲', insert: '\\underset{#?}{\\leftrightarrows}', isWidget: true, title: 'Left arrow over right arrow with underscript' },
          //   { label: '⇆̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightarrows}}', isWidget: true, title: 'Left arrow over right arrow with under & overscript' },

          //   // Right arrow over left arrow
          //   { label: '⇄̅', insert: '\\overset{#?}{\\rightleftarrows}', isWidget: true, title: 'Right arrow over left arrow with overscript' },
          //   { label: '⇄̲', insert: '\\underset{#?}{\\rightleftarrows}', isWidget: true, title: 'Right arrow over left arrow with underscript' },
          //   { label: '⇄̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightleftarrows}}', isWidget: true, title: 'Right arrow over left arrow with under & overscript' },

          //   // Left harpoon over right harpoon
          //   { label: '⇋̅', insert: '\\overset{#?}{\\leftrightharpoons}', isWidget: true, title: 'Left harpoon over right harpoon with overscript' },
          //   { label: '⇋̲', insert: '\\underset{#?}{\\leftrightharpoons}', isWidget: true, title: 'Left harpoon over right harpoon with underscript' },
          //   { label: '⇋̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftrightharpoons}}', isWidget: true, title: 'Left harpoon over right harpoon with under & overscript' },

          //   // Right harpoon over left harpoon
          //   { label: '⇌̅', insert: '\\overset{#?}{\\rightleftharpoons}', isWidget: true, title: 'Right harpoon over left harpoon with overscript' },
          //   { label: '⇌̲', insert: '\\underset{#?}{\\rightleftharpoons}', isWidget: true, title: 'Right harpoon over left harpoon with underscript' },
          //   { label: '⇌̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightleftharpoons}}', isWidget: true, title: 'Right harpoon over left harpoon with under & overscript' },

          //   // Rightwards arrow over short leftwards arrow
          //   { label: '⇄̅', insert: '\\overset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with overscript' },
          //   { label: '⇄̲', insert: '\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with underscript' },
          //   { label: '⇄̲̅', insert: '\\overset{#?}{\\underset{#?}{\\underset{\\leftarrow}{\\rightarrow}}}', isWidget: true, title: 'Rightwards arrow over short leftwards arrow with under & overscript' },

          //   // Short rightwards arrow over leftwards arrow
          //   { label: '⇆̅', insert: '\\overset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with overscript' },
          //   { label: '⇆̲', insert: '\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with underscript' },
          //   { label: '⇆̲̅', insert: '\\overset{#?}{\\underset{#?}{\\overset{\\rightarrow}{\\leftarrow}}}', isWidget: true, title: 'Short rightwards arrow over leftwards arrow with under & overscript' }

        ]
      },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="12" y1="38" x2="42" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 30L48 38L36 46V40H28V36H36V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with Label Above' },
      // { label: '→̅', insert: '\\overset{#?}{\\rightarrow}', title: 'Right arrow with overscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="12" y1="20" x2="42" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 12L48 20L36 28V22H28V18H36V12Z" fill="#222" stroke="none" /><rect x="24" y="34" width="10" height="16" rx="2" /></svg>), insert: '\\xrightarrow[#?]{}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with underscript' },
      // { label: '→̲', insert: '\\underset{#?}{\\rightarrow}', title: 'Right arrow with underscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="12" y1="32" x2="42" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 24L48 32L36 40V34H28V30H36V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xrightarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Arrow with Above and Below Labels' },
      // { label: '→̲̅', insert: '\\overset{#?}{\\underset{#?}{\\rightarrow}}', title: 'Right arrow with under & overscript' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#222' }}><line x1="18" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 24L12 32L24 40V34H34V30H24V24Z" fill="#222" stroke="none" /></svg>), insert: '\\leftarrow', cls: 'symbol', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="2" /><line x1="18" y1="38" x2="52" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 30L12 38L24 46V40H34V36H24V30Z" fill="#222" stroke="none" /></svg>), insert: '\\xleftarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow with Label Above' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="2" width="10" height="16" rx="2" /><line x1="18" y1="32" x2="52" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M24 24L12 32L24 40V34H34V30H24V24Z" fill="#222" stroke="none" /><rect x="24" y="44" width="10" height="16" rx="2" /></svg>), insert: '\\xleftarrow[#?]{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left Arrow with Above and Below Labels' },
      // { label: '←̅', insert: '\\overset{#?}{\\leftarrow}', title: 'Left arrow with overscript' },
      // { label: '←̲', insert: '\\underset{#?}{\\leftarrow}', title: 'Left arrow with underscript' },
      // { label: '←̲̅', insert: '\\overset{#?}{\\underset{#?}{\\leftarrow}}', title: 'Left arrow with under & overscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="24" y1="14" x2="42" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 6L48 14L36 14" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overrightharpoon{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Right Harpoon' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="14" x2="48" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M22 6L10 14L22 22V16H28V12H22V6Z" fill="#222" stroke="none" /><path d="M42 6L54 14L42 22V16H34V12H42V6Z" fill="#222" stroke="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Left Right Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="20" y1="14" x2="42" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M36 6L48 14L36 22V16H30V12H36V6Z" fill="#222" stroke="none" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Top Right Arrow' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="20" y1="14" x2="44" y2="14" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="24" y="24" width="18" height="20" rx="2" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Overline' },
      // { label: '⇀', insert: '\\overrightharpoon{#?}', title: 'Left harpoon accent' },     // Left harpoon accent
      // { label: '↔', insert: '\\overleftrightarrow{#?}', title: 'Left-right arrow accent' },// Left-right arrow accent
      // { label: '→', insert: '\\overrightarrow{#?}', title: 'Right arrow accent' },     // Arrow accent (right arrow)
      // { label: '¯', insert: '\\overline{#?}', title: 'Bar accent' },           // Bar accent


    ]
  },
  {
    label: 'α Ω',
    isTemplate: true,
    items: [
      // Greek lowercase – 10 cols × 3 rows (25 items)
      {
        type: 'sep', cols: 10, small: true, cls: 'cme-dark-large', moreCols: 8, moreItems: [
          { label: 'Α', insert: 'A', title: 'Capital Alpha' },
          { label: 'Β', insert: 'B', title: 'Capital Beta' },
          { label: 'Γ', insert: '\\Gamma', title: 'Capital Gamma' },
          { label: 'Δ', insert: '\\Delta', title: 'Capital Delta' },
          { label: 'Ε', insert: 'E', title: 'Capital Epsilon' },
          { label: 'Ζ', insert: 'Z', title: 'Capital Zeta' },
          { label: 'Η', insert: 'H', title: 'Capital Eta' },
          { label: 'Θ', insert: '\\Theta', title: 'Capital Theta' },
          { label: 'Ι', insert: 'I', title: 'Capital Iota' },
          { label: 'Κ', insert: 'K', title: 'Capital Kappa' },
          { label: 'Λ', insert: '\\Lambda', title: 'Capital Lambda' },
          { label: 'Μ', insert: 'M', title: 'Capital Mu' },
          { label: 'Ν', insert: 'N', title: 'Capital Nu' },
          { label: 'Ξ', insert: '\\Xi', title: 'Capital Xi' },
          { label: 'Ο', insert: 'O', title: 'Capital Omicron' },
          { label: 'Π', insert: '\\Pi', title: 'Capital Pi' },
          { label: 'Ρ', insert: 'P', title: 'Capital Rho' },
          { label: 'Σ', insert: '\\Sigma', title: 'Capital Sigma' },
          { label: 'Τ', insert: 'T', title: 'Capital Tau' },
          { label: 'Υ', insert: '\\Upsilon', title: 'Capital Upsilon' },
          { label: 'Φ', insert: '\\Phi', title: 'Capital Phi' },
          { label: 'Χ', insert: 'X', title: 'Capital Chi' },
          { label: 'Ψ', insert: '\\Psi', title: 'Capital Psi' },
          { label: 'Ω', insert: '\\Omega', title: 'Capital Omega' }
        ]
      },
      { label: 'α', insert: '\\alpha', title: 'Alpha' },
      { label: 'β', insert: '\\beta', title: 'Beta' },
      { label: 'γ', insert: '\\gamma', title: 'Gamma' },
      { label: 'δ', insert: '\\delta', title: 'Delta' },
      { label: 'ε', insert: '\\epsilon', title: 'Epsilon' },
      { label: 'ζ', insert: '\\zeta', title: 'Zeta' },
      { label: 'η', insert: '\\eta', title: 'Eta' },
      { label: 'θ', insert: '\\theta', title: 'Theta' },
      { label: 'ϑ', insert: '\\vartheta', title: 'Vartheta' },
      { label: 'ι', insert: '\\iota', title: 'Iota' },
      { label: 'κ', insert: '\\kappa', title: 'Kappa' },
      { label: 'λ', insert: '\\lambda', title: 'Lambda' },
      { label: 'μ', insert: '\\mu', title: 'Mu' },
      { label: 'ν', insert: '\\nu', title: 'Nu' },
      { label: 'ξ', insert: '\\xi', title: 'Xi' },
      { label: 'ο', insert: 'o', title: 'Omicron' },
      { label: 'π', insert: '\\pi', title: 'Pi' },
      { label: 'ϖ', insert: '\\varpi', title: 'Varpi' },
      { label: 'ρ', insert: '\\rho', title: 'Rho' },
      { label: 'ϱ', insert: '\\varrho', title: 'Varrho' },
      { label: 'ς', insert: '\\varsigma', title: 'Varsigma' },
      { label: 'σ', insert: '\\sigma', title: 'Sigma' },
      { label: 'τ', insert: '\\tau', title: 'Tau' },
      { label: 'υ', insert: '\\upsilon', title: 'Upsilon' },
      { label: 'φ', insert: '\\phi', title: 'Phi' },
      { label: 'χ', insert: '\\chi', title: 'Chi' },
      { label: 'ψ', insert: '\\psi', title: 'Psi' },
      { label: 'ω', insert: '\\omega', title: 'Omega' },

      // Number sets – 2 cols × 1 row
      {
        type: 'sep', cols: 2, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝔸', insert: '\\mathbb{A}', title: 'Mathbb A' },
          { label: '𝔻', insert: '\\mathbb{D}', title: 'Mathbb D' },
          { label: '𝔾', insert: '\\mathbb{G}', title: 'Mathbb G' },
          { label: '𝕁', insert: '\\mathbb{J}', title: 'Mathbb J' },
          { label: '𝕄', insert: '\\mathbb{M}', title: 'Mathbb M' },
          { label: 'ℙ', insert: '\\mathbb{P}', title: 'Mathbb P' },
          { label: '𝕊', insert: '\\mathbb{S}', title: 'Mathbb S' },
          { label: '𝕍', insert: '\\mathbb{V}', title: 'Mathbb V' },
          { label: '𝕐', insert: '\\mathbb{Y}', title: 'Mathbb Y' },
          // Small letters Row 1
          { label: '𝕒', insert: '𝕒', title: 'Mathbb a' },
          { label: '𝕕', insert: '𝕕', title: 'Mathbb d' },
          { label: '𝕘', insert: '𝕘', title: 'Mathbb g' },
          { label: '𝕛', insert: '𝕛', title: 'Mathbb j' },
          { label: '𝕞', insert: '𝕞', title: 'Mathbb m' },
          { label: '𝕡', insert: '𝕡', title: 'Mathbb p' },
          { label: '𝕤', insert: '𝕤', title: 'Mathbb s' },
          { label: '𝕧', insert: '𝕧', title: 'Mathbb v' },
          { label: '𝕪', insert: '𝕪', title: 'Mathbb y' },

          // --- Row 2 ---
          { label: '𝔹', insert: '\\mathbb{B}', title: 'Mathbb B' },
          { label: '𝔼', insert: '\\mathbb{E}', title: 'Mathbb E' },
          { label: 'ℍ', insert: '\\mathbb{H}', title: 'Mathbb H' },
          { label: '𝕂', insert: '\\mathbb{K}', title: 'Mathbb K' },
          { label: 'ℕ', insert: '\\mathbb{N}', title: 'Mathbb N' },
          { label: 'ℚ', insert: '\\mathbb{Q}', title: 'Mathbb Q' },
          { label: '𝕋', insert: '\\mathbb{T}', title: 'Mathbb T' },
          { label: '𝕎', insert: '\\mathbb{W}', title: 'Mathbb W' },
          { label: 'ℤ', insert: '\\mathbb{Z}', title: 'Mathbb Z' },
          // Small letters Row 2
          { label: '𝕓', insert: '𝕓', title: 'Mathbb b' },
          { label: '𝕖', insert: '𝕖', title: 'Mathbb e' },
          { label: '𝕙', insert: '𝕙', title: 'Mathbb h' },
          { label: '𝕜', insert: '𝕜', title: 'Mathbb k' },
          { label: '𝕟', insert: '𝕟', title: 'Mathbb n' },
          { label: '𝕢', insert: '𝕢', title: 'Mathbb q' },
          { label: '𝕥', insert: '𝕥', title: 'Mathbb t' },
          { label: '𝕨', insert: '𝕨', title: 'Mathbb w' },
          { label: '𝕫', insert: '𝕫', title: 'Mathbb z' },

          // --- Row 3 ---
          { label: 'ℂ', insert: '\\mathbb{C}', title: 'Mathbb C' },
          { label: '𝔽', insert: '\\mathbb{F}', title: 'Mathbb F' },
          { label: '𝕀', insert: '\\mathbb{I}', title: 'Mathbb I' },
          { label: '𝕃', insert: '\\mathbb{L}', title: 'Mathbb L' },
          { label: '𝕆', insert: '\\mathbb{O}', title: 'Mathbb O' },
          { label: 'ℝ', insert: '\\mathbb{R}', title: 'Mathbb R' },
          { label: '𝕌', insert: '\\mathbb{U}', title: 'Mathbb U' },
          { label: '𝕏', insert: '\\mathbb{X}', title: 'Mathbb X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝕔', insert: '𝕔', title: 'Mathbb c' },
          { label: '𝕗', insert: '𝕗', title: 'Mathbb f' },
          { label: '𝕚', insert: '𝕚', title: 'Mathbb i' },
          { label: '𝕝', insert: '𝕝', title: 'Mathbb l' },
          { label: '𝕠', insert: '𝕠', title: 'Mathbb o' },
          { label: '𝕣', insert: '𝕣', title: 'Mathbb r' },
          { label: '𝕦', insert: '𝕦', title: 'Mathbb u' },
          { label: '𝕩', insert: '𝕩', title: 'Mathbb x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
        ]
      },
      { label: 'ℕ', insert: 'ℕ', title: 'Mathbb N' },
      { label: 'ℤ', insert: 'ℤ', title: 'Mathbb Z' },
      { label: 'ℚ', insert: 'ℚ', title: 'Mathbb Q' },
      { label: 'ℂ', insert: 'ℂ', title: 'Mathbb C' },
      { label: 'ℝ', insert: 'ℝ', title: 'Mathbb R' },
      { label: 'ℙ', insert: 'ℙ', title: 'Mathbb P' },

      // Fraktur / Script / Special – 1 col × 3 rows
      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝔄', insert: '\\mathfrak{A}', title: 'Mathfrak A' },
          { label: '𝔇', insert: '\\mathfrak{D}', title: 'Mathfrak D' },
          { label: '𝔊', insert: '\\mathfrak{G}', title: 'Mathfrak G' },
          { label: '𝔍', insert: '\\mathfrak{J}', title: 'Mathfrak J' },
          { label: '𝔐', insert: '\\mathfrak{M}', title: 'Mathfrak M' },
          { label: '𝔓', insert: '\\mathfrak{P}', title: 'Mathfrak P' },
          { label: '𝔖', insert: '\\mathfrak{S}', title: 'Mathfrak S' },
          { label: '𝔙', insert: '\\mathfrak{V}', title: 'Mathfrak V' },
          { label: '𝔜', insert: '\\mathfrak{Y}', title: 'Mathfrak Y' },
          // Small letters Row 1
          { label: '𝔞', insert: '\\mathfrak{a}', title: 'Mathfrak a' },
          { label: '𝔡', insert: '\\mathfrak{d}', title: 'Mathfrak d' },
          { label: '𝔤', insert: '\\mathfrak{g}', title: 'Mathfrak g' },
          { label: '𝔧', insert: '\\mathfrak{j}', title: 'Mathfrak j' },
          { label: '𝔪', insert: '\\mathfrak{m}', title: 'Mathfrak m' },
          { label: '𝔭', insert: '\\mathfrak{p}', title: 'Mathfrak p' },
          { label: '𝔰', insert: '\\mathfrak{s}', title: 'Mathfrak s' },
          { label: '𝔳', insert: '\\mathfrak{v}', title: 'Mathfrak v' },
          { label: '𝔶', insert: '\\mathfrak{y}', title: 'Mathfrak y' },

          // --- Row 2 ---
          { label: '𝔅', insert: '\\mathfrak{B}', title: 'Mathfrak B' },
          { label: '𝔈', insert: '\\mathfrak{E}', title: 'Mathfrak E' },
          { label: 'ℌ', insert: '\\mathfrak{H}', title: 'Mathfrak H' },
          { label: '𝔎', insert: '\\mathfrak{K}', title: 'Mathfrak K' },
          { label: '𝔑', insert: '\\mathfrak{N}', title: 'Mathfrak N' },
          { label: '𝔔', insert: '\\mathfrak{Q}', title: 'Mathfrak Q' },
          { label: '𝔗', insert: '\\mathfrak{T}', title: 'Mathfrak T' },
          { label: '𝔚', insert: '\\mathfrak{W}', title: 'Mathfrak W' },
          { label: 'ℨ', insert: '\\mathfrak{Z}', title: 'Mathfrak Z' },
          // Small letters Row 2
          { label: '𝔟', insert: '\\mathfrak{b}', title: 'Mathfrak b' },
          { label: '𝔢', insert: '\\mathfrak{e}', title: 'Mathfrak e' },
          { label: '𝔥', insert: '\\mathfrak{h}', title: 'Mathfrak h' },
          { label: '𝔨', insert: '\\mathfrak{k}', title: 'Mathfrak k' },
          { label: '𝔫', insert: '\\mathfrak{n}', title: 'Mathfrak n' },
          { label: '𝔮', insert: '\\mathfrak{q}', title: 'Mathfrak q' },
          { label: '𝔱', insert: '\\mathfrak{t}', title: 'Mathfrak t' },
          { label: '𝔴', insert: '\\mathfrak{w}', title: 'Mathfrak w' },
          { label: '𝔷', insert: '\\mathfrak{z}', title: 'Mathfrak z' },

          // --- Row 3 ---
          { label: 'ℭ', insert: '\\mathfrak{C}', title: 'Mathfrak C' },
          { label: '𝔉', insert: '\\mathfrak{F}', title: 'Mathfrak F' },
          { label: 'ℑ', insert: '\\mathfrak{I}', title: 'Mathfrak I' },
          { label: '𝔏', insert: '\\mathfrak{L}', title: 'Mathfrak L' },
          { label: '𝔒', insert: '\\mathfrak{O}', title: 'Mathfrak O' },
          { label: 'ℜ', insert: '\\mathfrak{R}', title: 'Mathfrak R' },
          { label: '𝔘', insert: '\\mathfrak{U}', title: 'Mathfrak U' },
          { label: '𝔛', insert: '\\mathfrak{X}', title: 'Mathfrak X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝔠', insert: '\\mathfrak{c}', title: 'Mathfrak c' },
          { label: '𝔣', insert: '\\mathfrak{f}', title: 'Mathfrak f' },
          { label: '𝔦', insert: '\\mathfrak{i}', title: 'Mathfrak i' },
          { label: '𝔩', insert: '\\mathfrak{l}', title: 'Mathfrak l' },
          { label: '𝔬', insert: '\\mathfrak{o}', title: 'Mathfrak o' },
          { label: '𝔯', insert: '\\mathfrak{r}', title: 'Mathfrak r' },
          { label: '𝔲', insert: '\\mathfrak{u}', title: 'Mathfrak u' },
          { label: '𝔵', insert: '\\mathfrak{x}', title: 'Mathfrak x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder

        ]
      },

      { label: '𝔄', insert: '\\mathfrak{A}', title: 'Mathfrak A' },
      { label: '𝔅', insert: '\\mathfrak{B}', title: 'Mathfrak B' },
      { label: 'ℭ', insert: '\\mathfrak{C}', title: 'Mathfrak C' },





      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 18, moreItems: [
          // --- Row 1 ---
          { label: '𝒜', insert: '\\mathcal{A}', title: 'Mathcal A' },
          { label: '𝒟', insert: '\\mathcal{D}', title: 'Mathcal D' },
          { label: '𝒢', insert: '\\mathcal{G}', title: 'Mathcal G' },
          { label: '𝒥', insert: '\\mathcal{J}', title: 'Mathcal J' },
          { label: 'ℳ', insert: '\\mathcal{M}', title: 'Mathcal M' },
          { label: '𝒫', insert: '\\mathcal{P}', title: 'Mathcal P' },
          { label: '𝒮', insert: '\\mathcal{S}', title: 'Mathcal S' },
          { label: '𝒱', insert: '\\mathcal{V}', title: 'Mathcal V' },
          { label: '𝒴', insert: '\\mathcal{Y}', title: 'Mathcal Y' },
          // Small letters Row 1
          { label: '𝒶', insert: '𝒶', title: 'Mathcal a' },
          { label: '𝒹', insert: '𝒹', title: 'Mathcal d' },
          { label: 'ℊ', insert: 'ℊ', title: 'Mathcal g' },
          { label: '𝒿', insert: '𝒿', title: 'Mathcal j' },
          { label: '𝓂', insert: '𝓂', title: 'Mathcal m' },
          { label: '𝓅', insert: '𝓅', title: 'Mathcal p' },
          { label: '𝓈', insert: '𝓈', title: 'Mathcal s' },
          { label: '𝓋', insert: '𝓋', title: 'Mathcal v' },
          { label: '𝓎', insert: '𝓎', title: 'Mathcal y' },

          // --- Row 2 ---
          { label: 'ℬ', insert: '\\mathcal{B}', title: 'Mathcal B' },
          { label: 'ℰ', insert: '\\mathcal{E}', title: 'Mathcal E' },
          { label: 'ℋ', insert: '\\mathcal{H}', title: 'Mathcal H' },
          { label: '𝒦', insert: '\\mathcal{K}', title: 'Mathcal K' },
          { label: '𝒩', insert: '\\mathcal{N}', title: 'Mathcal N' },
          { label: '𝒬', insert: '\\mathcal{Q}', title: 'Mathcal Q' },
          { label: '𝒯', insert: '\\mathcal{T}', title: 'Mathcal T' },
          { label: '𝒲', insert: '\\mathcal{W}', title: 'Mathcal W' },
          { label: '𝒵', insert: '\\mathcal{Z}', title: 'Mathcal Z' },
          // Small letters Row 2
          { label: '𝒷', insert: '𝒷', title: 'Mathcal b' },
          { label: 'ℯ', insert: 'ℯ', title: 'Mathcal e' },
          { label: '𝒽', insert: '𝒽', title: 'Mathcal h' },
          { label: '𝓀', insert: '𝓀', title: 'Mathcal k' },
          { label: '𝓃', insert: '𝓃', title: 'Mathcal n' },
          { label: '𝓆', insert: '𝓆', title: 'Mathcal q' },
          { label: '𝓉', insert: '𝓉', title: 'Mathcal t' },
          { label: '𝓌', insert: '𝓌', title: 'Mathcal w' },
          { label: '𝓏', insert: '𝓏', title: 'Mathcal z' },

          // --- Row 3 ---
          { label: '𝒞', insert: '\\mathcal{C}', title: 'Mathcal C' },
          { label: 'ℱ', insert: '\\mathcal{F}', title: 'Mathcal F' },
          { label: 'ℐ', insert: '\\mathcal{I}', title: 'Mathcal I' },
          { label: 'ℒ', insert: '\\mathcal{L}', title: 'Mathcal L' },
          { label: '𝒪', insert: '\\mathcal{O}', title: 'Mathcal O' },
          { label: 'ℛ', insert: '\\mathcal{R}', title: 'Mathcal R' },
          { label: '𝒰', insert: '\\mathcal{U}', title: 'Mathcal U' },
          { label: '𝒳', insert: '\\mathcal{X}', title: 'Mathcal X' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
          // Small letters Row 3
          { label: '𝒸', insert: '𝒸', title: 'Mathcal c' },
          { label: '𝒻', insert: '𝒻', title: 'Mathcal f' },
          { label: '𝒾', insert: '𝒾', title: 'Mathcal i' },
          { label: '𝓁', insert: '𝓁', title: 'Mathcal l' },
          { label: 'ℴ', insert: 'ℴ', title: 'Mathcal o' },
          { label: '𝓇', insert: '𝓇', title: 'Mathcal r' },
          { label: '𝓊', insert: '𝓊', title: 'Mathcal u' },
          { label: '𝓍', insert: '𝓍', title: 'Mathcal x' },
          { label: ' ', insert: '', cls: 'cme-empty-btn', title: '' }, // empty placeholder
        ]
      },
      { label: '𝒜', insert: '\\mathcal{A}', title: 'Mathcal A' },
      { label: 'ℬ', insert: '\\mathcal{B}', title: 'Mathcal B' },
      { label: '𝒞', insert: '\\mathcal{C}', title: 'Mathcal C' },

      {
        type: 'sep', cols: 1, small: true, cls: 'cme-dark-large', moreCols: 2, moreItems: [
          { label: 'ℵ', insert: '\\aleph', title: 'Aleph' },      // Alef
          { label: 'ℐ', insert: '\\mathcal{I}', title: 'Mathcal I' }, // Script I
          { label: '℘', insert: '\\wp', title: 'Wp' },         // Script capital P (Weierstrass P)
          { label: 'ℨ', insert: '\\mathfrak{Z}', title: 'Mathfrak Z' },// Z-transform symbol
          { label: 'ℱ', insert: '\\mathcal{F}', title: 'Mathcal F' }, // Script capital F
        ]
      },
      { label: 'ℑ', insert: '\\Im', title: 'Im' },
      { label: 'ℜ', insert: '\\Re', title: 'Re' },
      { label: 'ℓ', insert: '\\ell', title: 'Ell' },

      //group chemical
      {
        type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup', moreCols: 18, moreItems: [
          // Row 1
          { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H', cls: 'pt-unknown' },
          ...Array.from({ length: 16 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'He', insert: '\\mathrm{He}', title: 'Mathrm He', cls: 'pt-noble' },

          // Row 2
          { label: 'Li', insert: '\\mathrm{Li}', title: 'Mathrm Li', cls: 'pt-alkali' },
          { label: 'Be', insert: '\\mathrm{Be}', title: 'Mathrm Be', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'B', insert: '\\mathrm{B}', title: 'Mathrm B', cls: 'pt-nonmetal' },
          { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C', cls: 'pt-nonmetal' },
          { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N', cls: 'pt-nonmetal' },
          { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O', cls: 'pt-nonmetal' },
          { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F', cls: 'pt-nonmetal' },
          { label: 'Ne', insert: '\\mathrm{Ne}', title: 'Mathrm Ne', cls: 'pt-noble' },

          // Row 3
          { label: 'Na', insert: '\\mathrm{Na}', title: 'Mathrm Na', cls: 'pt-alkali' },
          { label: 'Mg', insert: '\\mathrm{Mg}', title: 'Mathrm Mg', cls: 'pt-alkaline' },
          ...Array.from({ length: 10 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Al', insert: '\\mathrm{Al}', title: 'Mathrm Al', cls: 'pt-metalloid' },
          { label: 'Si', insert: '\\mathrm{Si}', title: 'Mathrm Si', cls: 'pt-metalloid' },
          { label: 'P', insert: '\\mathrm{P}', title: 'Mathrm P', cls: 'pt-nonmetal' },
          { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S', cls: 'pt-nonmetal' },
          { label: 'Cl', insert: '\\mathrm{Cl}', title: 'Mathrm Cl', cls: 'pt-nonmetal' },
          { label: 'Ar', insert: '\\mathrm{Ar}', title: 'Mathrm Ar', cls: 'pt-noble' },

          // Row 4
          { label: 'K', insert: '\\mathrm{K}', title: 'Mathrm K', cls: 'pt-alkali' },
          { label: 'Ca', insert: '\\mathrm{Ca}', title: 'Mathrm Ca', cls: 'pt-alkaline' },
          { label: 'Sc', insert: '\\mathrm{Sc}', title: 'Mathrm Sc', cls: 'pt-transition' },
          { label: 'Ti', insert: '\\mathrm{Ti}', title: 'Mathrm Ti', cls: 'pt-transition' },
          { label: 'V', insert: '\\mathrm{V}', title: 'Mathrm V', cls: 'pt-transition' },
          { label: 'Cr', insert: '\\mathrm{Cr}', title: 'Mathrm Cr', cls: 'pt-transition' },
          { label: 'Mn', insert: '\\mathrm{Mn}', title: 'Mathrm Mn', cls: 'pt-transition' },
          { label: 'Fe', insert: '\\mathrm{Fe}', title: 'Mathrm Fe', cls: 'pt-transition' },
          { label: 'Co', insert: '\\mathrm{Co}', title: 'Mathrm Co', cls: 'pt-transition' },
          { label: 'Ni', insert: '\\mathrm{Ni}', title: 'Mathrm Ni', cls: 'pt-transition' },
          { label: 'Cu', insert: '\\mathrm{Cu}', title: 'Mathrm Cu', cls: 'pt-transition' },
          { label: 'Zn', insert: '\\mathrm{Zn}', title: 'Mathrm Zn', cls: 'pt-transition' },
          { label: 'Ga', insert: '\\mathrm{Ga}', title: 'Mathrm Ga', cls: 'pt-metalloid' },
          { label: 'Ge', insert: '\\mathrm{Ge}', title: 'Mathrm Ge', cls: 'pt-metalloid' },
          { label: 'As', insert: '\\mathrm{As}', title: 'Mathrm As', cls: 'pt-nonmetal' },
          { label: 'Se', insert: '\\mathrm{Se}', title: 'Mathrm Se', cls: 'pt-nonmetal' },
          { label: 'Br', insert: '\\mathrm{Br}', title: 'Mathrm Br', cls: 'pt-nonmetal' },
          { label: 'Kr', insert: '\\mathrm{Kr}', title: 'Mathrm Kr', cls: 'pt-noble' },

          // Row 5
          { label: 'Rb', insert: '\\mathrm{Rb}', title: 'Mathrm Rb', cls: 'pt-alkali' },
          { label: 'Sr', insert: '\\mathrm{Sr}', title: 'Mathrm Sr', cls: 'pt-alkaline' },
          { label: 'Y', insert: '\\mathrm{Y}', title: 'Mathrm Y', cls: 'pt-transition' },
          { label: 'Zr', insert: '\\mathrm{Zr}', title: 'Mathrm Zr', cls: 'pt-transition' },
          { label: 'Nb', insert: '\\mathrm{Nb}', title: 'Mathrm Nb', cls: 'pt-transition' },
          { label: 'Mo', insert: '\\mathrm{Mo}', title: 'Mathrm Mo', cls: 'pt-transition' },
          { label: 'Tc', insert: '\\mathrm{Tc}', title: 'Mathrm Tc', cls: 'pt-transition' },
          { label: 'Ru', insert: '\\mathrm{Ru}', title: 'Mathrm Ru', cls: 'pt-transition' },
          { label: 'Rh', insert: '\\mathrm{Rh}', title: 'Mathrm Rh', cls: 'pt-transition' },
          { label: 'Pd', insert: '\\mathrm{Pd}', title: 'Mathrm Pd', cls: 'pt-transition' },
          { label: 'Ag', insert: '\\mathrm{Ag}', title: 'Mathrm Ag', cls: 'pt-transition' },
          { label: 'Cd', insert: '\\mathrm{Cd}', title: 'Mathrm Cd', cls: 'pt-transition' },
          { label: 'In', insert: '\\mathrm{In}', title: 'Mathrm In', cls: 'pt-metalloid' },
          { label: 'Sn', insert: '\\mathrm{Sn}', title: 'Mathrm Sn', cls: 'pt-metalloid' },
          { label: 'Sb', insert: '\\mathrm{Sb}', title: 'Mathrm Sb', cls: 'pt-metalloid' },
          { label: 'Te', insert: '\\mathrm{Te}', title: 'Mathrm Te', cls: 'pt-nonmetal' },
          { label: 'I', insert: '\\mathrm{I}', title: 'Mathrm I', cls: 'pt-nonmetal' },
          { label: 'Xe', insert: '\\mathrm{Xe}', title: 'Mathrm Xe', cls: 'pt-noble' },

          // Row 6
          { label: 'Cs', insert: '\\mathrm{Cs}', title: 'Mathrm Cs', cls: 'pt-alkali' },
          { label: 'Ba', insert: '\\mathrm{Ba}', title: 'Mathrm Ba', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Hf', insert: '\\mathrm{Hf}', title: 'Mathrm Hf', cls: 'pt-transition' },
          { label: 'Ta', insert: '\\mathrm{Ta}', title: 'Mathrm Ta', cls: 'pt-transition' },
          { label: 'W', insert: '\\mathrm{W}', title: 'Mathrm W', cls: 'pt-transition' },
          { label: 'Re', insert: '\\mathrm{Re}', title: 'Mathrm Re', cls: 'pt-transition' },
          { label: 'Os', insert: '\\mathrm{Os}', title: 'Mathrm Os', cls: 'pt-transition' },
          { label: 'Ir', insert: '\\mathrm{Ir}', title: 'Mathrm Ir', cls: 'pt-transition' },
          { label: 'Pt', insert: '\\mathrm{Pt}', title: 'Mathrm Pt', cls: 'pt-transition' },
          { label: 'Au', insert: '\\mathrm{Au}', title: 'Mathrm Au', cls: 'pt-transition' },
          { label: 'Hg', insert: '\\mathrm{Hg}', title: 'Mathrm Hg', cls: 'pt-transition' },
          { label: 'Tl', insert: '\\mathrm{Tl}', title: 'Mathrm Tl', cls: 'pt-metalloid' },
          { label: 'Pb', insert: '\\mathrm{Pb}', title: 'Mathrm Pb', cls: 'pt-metalloid' },
          { label: 'Bi', insert: '\\mathrm{Bi}', title: 'Mathrm Bi', cls: 'pt-metalloid' },
          { label: 'Po', insert: '\\mathrm{Po}', title: 'Mathrm Po', cls: 'pt-metalloid' },
          { label: 'At', insert: '\\mathrm{At}', title: 'Mathrm At', cls: 'pt-nonmetal' },
          { label: 'Rn', insert: '\\mathrm{Rn}', title: 'Mathrm Rn', cls: 'pt-noble' },

          // Row 7
          { label: 'Fr', insert: '\\mathrm{Fr}', title: 'Mathrm Fr', cls: 'pt-alkali' },
          { label: 'Ra', insert: '\\mathrm{Ra}', title: 'Mathrm Ra', cls: 'pt-alkaline' },
          { label: '', insert: '', cls: 'pt-transition' }, // Blank pink
          { label: 'Rf', insert: '\\mathrm{Rf}', title: 'Mathrm Rf', cls: 'pt-transition' },
          { label: 'Db', insert: '\\mathrm{Db}', title: 'Mathrm Db', cls: 'pt-transition' },
          { label: 'Sg', insert: '\\mathrm{Sg}', title: 'Mathrm Sg', cls: 'pt-transition' },
          { label: 'Bh', insert: '\\mathrm{Bh}', title: 'Mathrm Bh', cls: 'pt-transition' },
          { label: 'Hs', insert: '\\mathrm{Hs}', title: 'Mathrm Hs', cls: 'pt-transition' },
          { label: 'Mt', insert: '\\mathrm{Mt}', title: 'Mathrm Mt', cls: 'pt-transition' },
          { label: 'Ds', insert: '\\mathrm{Ds}', title: 'Mathrm Ds', cls: 'pt-transition' },
          { label: 'Rg', insert: '\\mathrm{Rg}', title: 'Mathrm Rg', cls: 'pt-transition' },
          { label: 'Cn', insert: '\\mathrm{Cn}', title: 'Mathrm Cn', cls: 'pt-transition' },
          { label: 'Nh', insert: '\\mathrm{Nh}', title: 'Mathrm Nh', cls: 'pt-metalloid' },
          { label: 'Fl', insert: '\\mathrm{Fl}', title: 'Mathrm Fl', cls: 'pt-metalloid' },
          { label: 'Mc', insert: '\\mathrm{Mc}', title: 'Mathrm Mc', cls: 'pt-metalloid' },
          { label: 'Lv', insert: '\\mathrm{Lv}', title: 'Mathrm Lv', cls: 'pt-metalloid' },
          { label: 'Ts', insert: '\\mathrm{Ts}', title: 'Mathrm Ts', cls: 'pt-unknown' },
          { label: 'Og', insert: '\\mathrm{Og}', title: 'Mathrm Og', cls: 'pt-unknown' },

          // Gap Row
          ...Array.from({ length: 18 }, () => ({ label: '', cls: 'pt-empty' })),

          // Row Lanthanides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'La', insert: '\\mathrm{La}', title: 'Mathrm La', cls: 'pt-transition' },
          { label: 'Ce', insert: '\\mathrm{Ce}', title: 'Mathrm Ce', cls: 'pt-lanthanide' },
          { label: 'Pr', insert: '\\mathrm{Pr}', title: 'Mathrm Pr', cls: 'pt-lanthanide' },
          { label: 'Nd', insert: '\\mathrm{Nd}', title: 'Mathrm Nd', cls: 'pt-lanthanide' },
          { label: 'Pm', insert: '\\mathrm{Pm}', title: 'Mathrm Pm', cls: 'pt-lanthanide' },
          { label: 'Sm', insert: '\\mathrm{Sm}', title: 'Mathrm Sm', cls: 'pt-lanthanide' },
          { label: 'Eu', insert: '\\mathrm{Eu}', title: 'Mathrm Eu', cls: 'pt-lanthanide' },
          { label: 'Gd', insert: '\\mathrm{Gd}', title: 'Mathrm Gd', cls: 'pt-lanthanide' },
          { label: 'Tb', insert: '\\mathrm{Tb}', title: 'Mathrm Tb', cls: 'pt-lanthanide' },
          { label: 'Dy', insert: '\\mathrm{Dy}', title: 'Mathrm Dy', cls: 'pt-lanthanide' },
          { label: 'Ho', insert: '\\mathrm{Ho}', title: 'Mathrm Ho', cls: 'pt-lanthanide' },
          { label: 'Er', insert: '\\mathrm{Er}', title: 'Mathrm Er', cls: 'pt-lanthanide' },
          { label: 'Tm', insert: '\\mathrm{Tm}', title: 'Mathrm Tm', cls: 'pt-lanthanide' },
          { label: 'Yb', insert: '\\mathrm{Yb}', title: 'Mathrm Yb', cls: 'pt-lanthanide' },
          { label: 'Lu', insert: '\\mathrm{Lu}', title: 'Mathrm Lu', cls: 'pt-lanthanide' },
          { label: '', cls: 'pt-empty' },

          // Row Actinides
          ...Array.from({ length: 2 }, () => ({ label: '', cls: 'pt-empty' })),
          { label: 'Ac', insert: '\\mathrm{Ac}', title: 'Mathrm Ac', cls: 'pt-actinide' },
          { label: 'Th', insert: '\\mathrm{Th}', title: 'Mathrm Th', cls: 'pt-actinide' },
          { label: 'Pa', insert: '\\mathrm{Pa}', title: 'Mathrm Pa', cls: 'pt-actinide' },
          { label: 'U', insert: '\\mathrm{U}', title: 'Mathrm U', cls: 'pt-actinide' },
          { label: 'Np', insert: '\\mathrm{Np}', title: 'Mathrm Np', cls: 'pt-actinide' },
          { label: 'Pu', insert: '\\mathrm{Pu}', title: 'Mathrm Pu', cls: 'pt-actinide' },
          { label: 'Am', insert: '\\mathrm{Am}', title: 'Mathrm Am', cls: 'pt-actinide' },
          { label: 'Cm', insert: '\\mathrm{Cm}', title: 'Mathrm Cm', cls: 'pt-actinide' },
          { label: 'Bk', insert: '\\mathrm{Bk}', title: 'Mathrm Bk', cls: 'pt-actinide' },
          { label: 'Cf', insert: '\\mathrm{Cf}', title: 'Mathrm Cf', cls: 'pt-actinide' },
          { label: 'Es', insert: '\\mathrm{Es}', title: 'Mathrm Es', cls: 'pt-actinide' },
          { label: 'Fm', insert: '\\mathrm{Fm}', title: 'Mathrm Fm', cls: 'pt-actinide' },
          { label: 'Md', insert: '\\mathrm{Md}', title: 'Mathrm Md', cls: 'pt-actinide' },
          { label: 'No', insert: '\\mathrm{No}', title: 'Mathrm No', cls: 'pt-actinide' },
          { label: 'Lr', insert: '\\mathrm{Lr}', title: 'Mathrm Lr', cls: 'pt-actinide' },
          { label: '', cls: 'pt-empty' },
        ]
      },
      { label: 'H', insert: '\\mathrm{H}', title: 'Mathrm H' },   // Hydrogen
      { label: 'C', insert: '\\mathrm{C}', title: 'Mathrm C' },   // Carbon
      { label: 'N', insert: '\\mathrm{N}', title: 'Mathrm N' },   // Nitrogen
      { label: 'O', insert: '\\mathrm{O}', title: 'Mathrm O' },   // Oxygen
      { label: 'F', insert: '\\mathrm{F}', title: 'Mathrm F' },   // Fluorine
      { label: 'S', insert: '\\mathrm{S}', title: 'Mathrm S' },   // Sulfur

    ]
  },

  {
    label: 'bmatrix', fontSize: '5px', mathLabel: '\\textstyle \\begin{bmatrix}#? & #?\\\\ #? & #?\\end{bmatrix}  \\,  \\begin{cases} #? \\\\ #? \\end{cases}', isMatrix: true,
    items: [

      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="10" y="6" width="8" height="14" rx="1" /><rect x="28" y="6" width="8" height="14" rx="1" /><rect x="46" y="6" width="8" height="14" rx="1" /><rect x="10" y="25" width="8" height="14" rx="1" /><rect x="28" y="25" width="8" height="14" rx="1" /><rect x="46" y="25" width="8" height="14" rx="1" /><rect x="10" y="44" width="8" height="14" rx="1" /><rect x="28" y="44" width="8" height="14" rx="1" /><rect x="46" y="44" width="8" height="14" rx="1" /></svg>), insert: 'matrix', cls: 'template', title: '3×3 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="8" y1="4" x2="8" y2="60" stroke="#222" strokeWidth="4" /><line x1="56" y1="4" x2="56" y2="60" stroke="#222" strokeWidth="4" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'vmatrix', cls: 'template', title: '2×2 Determinant' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M14 6H8V58H14" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 6H56V58H50" stroke="#222" strokeWidth="4" fill="none" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'bmatrix', cls: 'template', title: '2×2 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 6C8 16 8 48 16 58" stroke="#222" strokeWidth="4" fill="none" /><path d="M48 6C56 16 56 48 48 58" stroke="#222" strokeWidth="4" fill="none" /><rect x="18" y="12" width="8" height="14" rx="1" /><rect x="38" y="12" width="8" height="14" rx="1" /><rect x="18" y="38" width="8" height="14" rx="1" /><rect x="38" y="38" width="8" height="14" rx="1" /></svg>), insert: 'pmatrix', cls: 'template', title: '2×2 Parenthesis Matrix' },

      // { label: '□', insert: 'matrix', cls: 'template', title: 'Matrix' },
      // { label: '|□|', insert: 'vmatrix', cls: 'template', title: 'Vertical bar matrix' },
      // { label: '[□]', insert: 'bmatrix', cls: 'template', title: 'Bracket matrix' },
      // { label: '(□)', insert: 'pmatrix', cls: 'template', title: 'Parenthesis matrix' },


      { type: 'sep', cols: 3, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="28" y="6" width="8" height="10" rx="1" /><rect x="28" y="27" width="8" height="10" rx="1" /><rect x="28" y="48" width="8" height="10" rx="1" /></svg>), insert: '\\begin{matrix} #? \\\\ #? \\\\ #? \\end{matrix}', cls: 'symbol', directInsert: true, action: 'INSERT_CUSTOM', title: 'Vertical Dots' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 6H12V58H18" stroke="#222" strokeWidth="4" fill="none" /><path d="M46 6H52V58H46" stroke="#222" strokeWidth="4" fill="none" /><rect x="28" y="10" width="8" height="14" rx="1" /><rect x="28" y="38" width="8" height="14" rx="1" /></svg>), insert: '\\begin{bmatrix} #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 6C10 16 10 48 18 58" stroke="#222" strokeWidth="4" fill="none" /><path d="M46 6C54 16 54 48 46 58" stroke="#222" strokeWidth="4" fill="none" /><rect x="28" y="10" width="8" height="14" rx="1" /><rect x="28" y="38" width="8" height="14" rx="1" /></svg>), insert: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Parenthesis Matrix' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="8" y="24" width="8" height="14" rx="1" /><rect x="28" y="24" width="8" height="14" rx="1" /><rect x="48" y="24" width="8" height="14" rx="1" /></svg>), insert: '\\begin{matrix} #? \\,  #? \\,  #? \\end{matrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×3 Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 18H12V46H16" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 18H54V46H50" stroke="#222" strokeWidth="4" fill="none" /><rect x="22" y="22" width="8" height="14" rx="1" /><rect x="38" y="22" width="8" height="14" rx="1" /></svg>), insert: '\\begin{bmatrix} #? \\, #? \\end{bmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×2 Square Bracket Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 18C12 23 12 41 16 46" stroke="#222" strokeWidth="4" fill="none" /><path d="M50 18C54 23 54 41 50 46" stroke="#222" strokeWidth="4" fill="none" /><rect x="22" y="22" width="8" height="14" rx="1" /><rect x="38" y="22" width="8" height="14" rx="1" /></svg>), insert: '\\begin{pmatrix} #? \\, #? \\end{pmatrix}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '1×2 Parenthesis Matrix' },
      // { label: '□', insert: '\\begin{matrix} #? \\\\ #? \\\\ #? \\end{matrix}', cls: 'template', directInsert: true, title: 'Begin matrix' },
      // { label: '[□ \\ □]', insert: '\\begin{bmatrix} #? \\\\ #? \\end{bmatrix}', cls: 'template', directInsert: true, title: 'Begin bmatrix' },
      // { label: '(□ \\ □)', insert: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', cls: 'template', directInsert: true, title: 'Begin pmatrix' },
      // { label: '□ □ □', insert: '\\begin{matrix} #? \\,  #? \\,  #? \\end{matrix}', cls: 'template', directInsert: true, title: 'Begin matrix' },
      // { label: '[□ & □]', insert: '\\begin{bmatrix} #? \\, #? \\end{bmatrix}', cls: 'template', directInsert: true, title: 'Begin bmatrix' },
      // { label: '(□ & □)', insert: '\\begin{pmatrix} #? \\, #? \\end{pmatrix}', cls: 'template', directInsert: true, title: 'Begin pmatrix' },


      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 8C12 8 12 12 12 18V26C12 30 10 32 8 32C10 32 12 34 12 38V46C12 52 12 56 16 56" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="10" width="10" height="12" rx="1" /><rect x="26" y="34" width="10" height="12" rx="1" /></svg>), insert: '\\begin{cases} #? \\\\ #? \\end{cases}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×1 Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 8C12 8 12 12 12 18V26C12 30 10 32 8 32C10 32 12 34 12 38V46C12 52 12 56 16 56" stroke="#222" strokeWidth="4" fill="none" /><rect x="23" y="10" width="10" height="12" rx="1" /><rect x="39" y="10" width="10" height="12" rx="1" /><rect x="23" y="34" width="10" height="12" rx="1" /><rect x="39" y="34" width="10" height="12" rx="1" /></svg>), insert: '\\begin{cases} #? \\, #? \\\\ #? \\, #? \\end{cases}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: '2×2 Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="26" y="10" width="10" height="12" rx="1" /><rect x="26" y="34" width="10" height="12" rx="1" /><path d="M48 8C52 8 52 12 52 18V26C52 30 54 32 56 32C54 32 52 34 52 38V46C52 52 52 56 48 56" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left.\\begin{matrix} #? \\\\ #? \\end{matrix}\\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right Piecewise Matrix' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="8" y="8" width="12" height="12" rx="1" /><line x1="26" y1="12" x2="38" y2="12" stroke="#222" strokeWidth="3" /><line x1="26" y1="16" x2="38" y2="16" stroke="#222" strokeWidth="3" /><rect x="44" y="6" width="10" height="16" rx="1" /><rect x="8" y="40" width="10" height="16" rx="1" /><line x1="24" y1="46" x2="36" y2="46" stroke="#222" strokeWidth="3" /><line x1="24" y1="50" x2="36" y2="50" stroke="#222" strokeWidth="3" /><rect x="42" y="38" width="12" height="12" rx="1" /></svg>), insert: '\\begin{aligned} #? &= #? \\\\ #? &= #? \\end{aligned}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'System of Equations' },
      // // Two rows column with left curly brackets
      // { label: '{', insert: '\\begin{cases} #? \\\\ #? \\end{cases}', cls: 'template', directInsert: true, title: 'Begin cases' },
      // // Piecewise function
      // { label: 'f(x)', insert: '\\begin{cases} #?, \\, #? \\\\ #?, \\, #? \\end{cases}', cls: 'template', directInsert: true, title: 'Begin cases' },

      // // Two rows column with right curly brackets
      // { label: '}', insert: '\\left.\\begin{matrix} #? \\\\ #? \\end{matrix}\\right\\}', cls: 'template', directInsert: true, title: 'Begin matrix' },

      // // Aligned equations
      // { label: '=', insert: '\\begin{aligned} #? &= #? \\\\ #? &= #? \\end{aligned}', cls: 'template', directInsert: true, title: 'Begin aligned' },


      { type: 'sep', cols: 2, cls: 'cme-trig-subgroup' },
      { label: '⋮', insert: '\\vdots', title: 'Vertical ellipses' },
      { label: '⋰', insert: '⋰', title: 'Upright diagonal ellipses' },
      { label: '…', insert: '\\ldots', title: 'Horizontal ellipses' },
      { label: '⋱', insert: '\\ddots', title: 'Down-right diagonal ellipses' },

      {
        type: 'sep', cols: 1, fontSize: '8px', cls: 'cme-matrix-subgroup', moreCols: 3, moreItems: [
          // sub addition
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\ \\,#?\\end{array}}{\\;#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction Template' },
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="26" x2="26" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\-\\,#?\\end{array}}{\\quad#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Subtraction' },
          { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="11" y1="19" x2="25" y2="33" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="25" y1="19" x2="11" y2="33" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\×\\,#?\\end{array}}{\\quad#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Multiplication' },

          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="4" y="8" width="10" height="16" rx="1" /><path d="M30 4V30H56" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="40" y="8" width="10" height="16" rx="1" /><rect x="40" y="40" width="10" height="16" rx="1" /></svg>), insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ & \\; #? \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Long Division' },
          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="4" y="8" width="10" height="16" rx="1" /><rect x="4" y="44" width="10" height="16" rx="1" /><path d="M30 4V36H58" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="44" y="8" width="10" height="16" rx="1" /><rect x="44" y="44" width="10" height="16" rx="1" /></svg>), insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ #?\\, & \\; #? \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Long Division with Four Terms' },
          //long dividosn
          { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="40" y="0" width="10" height="16" rx="1" /><line x1="30" y1="20" x2="54" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M26 18C34 25 34 47 26 54" stroke="#222" strokeWidth="4" fill="none" /><rect x="6" y="28" width="10" height="16" rx="1" /><rect x="40" y="28" width="10" height="16" rx="1" /><rect x="40" y="52" width="10" height="16" rx="1" /></svg>), insert: '#?\\, ) \\!\\!\\!\\!\\! \\begin{array}\\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}} \\\\ \\;\\;#?\\; \\end{array}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Root with Fraction and Subscript' },


          // { label: ' ', insert: '\\frac{\\begin{array}{r}#?\\\\ \\,#?\\end{array}}{\\;#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '-', insert: '\\frac{\\begin{array}{r}#?\\\\-\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '*', insert: '\\frac{\\begin{array}{r}#?\\\\*\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '÷', insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ & \\; #? \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // { label: '÷', insert: '\\begin{array}{r@{}l} #?\\, & \\begin{array}{|@{}l} \\underline{\\;#?\\;\\,} \\end{array} \\\\ #?\\, & \\; #? \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },
          // // Long division
          // { label: '⟌', insert: '#?\\, ) \\!\\!\\!\\!\\! \\begin{array}\\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}} \\\\ \\;\\;#?\\; \\end{array}', isWidget: true, directInsert: true, title: 'Begin array', cls: 'cme-matrix-subgroup' },


        ]
      },

      //column addition
      { label: (<svg width="26" height="30" viewBox="0 -6 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><rect x="40" y="-2" width="10" height="16" rx="1" /><rect x="40" y="18" width="10" height="16" rx="1" /><rect x="40" y="46" width="10" height="16" rx="1" /><line x1="8" y1="38" x2="54" y2="38" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="18" y1="18" x2="18" y2="34" stroke="#222" strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="26" x2="26" y2="26" stroke="#222" strokeWidth="4" strokeLinecap="round" /></svg>), insert: '\\frac{\\begin{array}{r}#?\\\\+\\,#?\\end{array}}{\\quad#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction with Addition' },


      //long divison 
      { label: (<svg width="26" height="30" viewBox="0 0 64 72" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="40" y="0" width="10" height="16" rx="1" /><line x1="30" y1="20" x2="54" y2="20" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M26 18C34 25 34 47 26 54" stroke="#222" strokeWidth="4" fill="none" /><rect x="6" y="28" width="10" height="16" rx="1" /><rect x="40" y="28" width="10" height="16" rx="1" /></svg>), insert: '#?\\, ) \\!\\! \\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Root with Fraction' },
      // // Column addition
      // { label: '+', insert: '\\frac{\\begin{array}{r}#?\\\\+\\,#?\\end{array}}{\\quad#?}', isWidget: true, directInsert: true, title: 'Begin array', },

      // // Long division
      // { label: '⟌', insert: '#?\\, ) \\!\\! \\overset{\\displaystyle #?}{\\overline{\\vphantom{1}\\;\\;#?\\;}}', isWidget: true, directInsert: true, title: 'Vphantom 1', },



    ]
  },
  {
    label: '□̅', fontSize: '9px', mathLabel: '{#?}^{#?} \\, \\overset{#?}{#?}', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-trig-subgroup' },
      // Big fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="2" width="18" height="20" rx="2" /><line x1="6" y1="32" x2="50" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="18" y="40" width="18" height="20" rx="2" /></svg>), insert: '\\frac{#0}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction' },
      // { label: 'a/b', insert: '\\frac{#?}{#?}', title: 'Fraction' },

      // Small fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="22" y="8" width="12" height="14" rx="2" /><line x1="6" y1="32" x2="50" y2="32" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="22" y="40" width="12" height="14" rx="2" /></svg>), insert: '\\tfrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Fraction' },
      // { label: 'a⁄b', insert: '\\tfrac{#?}{#?}', title: 'Small fraction' },

      //fraction
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="5" y="16" width="18" height="20" rx="1" /><line x1="26" y1="50" x2="40" y2="18" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="38" y="34" width="18" height="20" rx="1" /></svg>), insert: '\\large \\nicefrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Text Fraction' },

      // { label: 'A⁄B', insert: '{#?}/{#?}', title: 'Inline fraction' },

      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="14" y="16" width="12" height="16" rx="1" /><line x1="26" y1="50" x2="40" y2="18" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="38" y="34" width="12" height="16" rx="1" /></svg>), insert: '\\nicefrac{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Text Fraction' },

      // { label: '⎸/⎹', insert: '\\nicefrac{#?}{#?}', title: 'Nice fraction' },

      { type: 'sep', cols: 1, small: true, cls: 'cme-trig-subgroup' },
      // Square root
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 34 L14 34 L20 50 L30 10 L54 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="36" y="18" width="16" height="20" rx="2" /></svg>), insert: '\\sqrt{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Root' },

      // { label: '√', insert: '\\sqrt{#?}', title: 'Square root' },

      // Root (nth root)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M6 36 L14 36 L20 50 L30 10 L56 10" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="12" y="16" width="8" height="12" rx="2" /><rect x="40" y="22" width="12" height="22" rx="2" /></svg>), insert: '\\sqrt[#?]{#0}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Nth Root Fraction' },

      // { label: 'ⁿ√', insert: '\\sqrt[#?]{#?}', title: 'N-th root' },

      { type: 'sep', cols: 3, cls: 'cme-matrix-subgroup' },
      // Superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box' },
      // { label: 'xⁿ', insert: '{#?}^{#?}', title: 'Superscript' },

      // Superscript and subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="22" width="12" height="20" rx="1" /><rect x="32" y="10" width="10" height="16" rx="1" opacity="0.45" /><rect x="32" y="36" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Raised Box with Subscript' },
      // { label: 'xⁿₖ', insert: '{#?}_{#?}^{#?}', title: 'Subscript and superscript' },

      // Subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="14" width="12" height="20" rx="1" /><rect x="36" y="28" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '{#?}_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Lowered Box' },
      // { label: 'xₖ', insert: '{#?}_{#?}', title: 'Subscript' },

      // Left superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="10" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="22" width="12" height="20" rx="1" /></svg>), insert: '{}^{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Lowered Box' },// { label: 'ⁿx', insert: '{}^{#?}{#?}', title: 'Left superscript' },



      // Left subscript and superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="8" width="10" height="16" rx="1" opacity="0.45" /><rect x="18" y="36" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="20" width="12" height="20" rx="1" /></svg>), insert: '{}_{#?}^{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Superscript and Subscript' },
      // { label: 'ⁿₖx', insert: '{}_{#?}^{#?}{#?}', title: 'Left subscript and superscript' },



      // Left subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="18" y="28" width="10" height="16" rx="1" opacity="0.45" /><rect x="30" y="10" width="12" height="20" rx="1" /></svg>), insert: '{}_{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Lower Left Box' },
      // { label: 'ₖx', insert: '{}_{#?}{#?}', title: 'Left subscript' },

      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      // Element over
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="10" height="16" rx="1" opacity="0.45" /><rect x="23" y="28" width="12" height="20" rx="1" /></svg>), insert: '\\overset{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Superscript Box' },

      // { label: '□̅', insert: '\\overset{#?}{#?}', title: 'Overscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 4 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="28" width="12" height="18" rx="1" /><rect x="21" y="52" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\underset{#?}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Subscript Box' },
      // { label: '□̲', insert: '\\underset{#?}{#?}', title: 'Underscript' },


      // Elements under and over
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="8" height="12" rx="1" opacity="0.45" /><rect x="22" y="22" width="12" height="20" rx="1" /><rect x="24" y="48" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{#?}{\\underset{#?}{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Box with Superscript and Subscript' },
      // { label: '□̲̅', insert: '\\overset{#?}{\\underset{#?}{#?}}', title: 'Over and underscript' },


      { type: 'sep', cols: 1, cls: 'cme-matrix-subgroup' },
      // Underscript with brace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="26" y="4" width="12" height="20" rx="1" /><path d="M10 34H24C28 34 30 36 32 40C34 36 36 34 40 34H54M10 34V28M54 34V28" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="46" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\underbrace{#?}_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underbrace' },

      // { label: '⏟', insert: '\\underbrace{#?}_{#?}', title: 'Underbrace' },

      // Overscript with brace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="27" y="2" width="10" height="16" rx="1" opacity="0.45" /><path d="M10 36V30H24C28 30 30 28 32 24C34 28 36 30 40 30H54V36" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="40" width="12" height="20" rx="1" /></svg>), insert: '\\overbrace{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overbrace' },
      // { label: '⏞', insert: '\\overbrace{#?}^{#?}', title: 'Overbrace' },



      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },


      // Box with over and underscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="1" width="10" height="12" rx="1" opacity="0.45" /><rect x="16" y="20" width="16" height="24" rx="1" stroke="#222" /><rect x="19" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{\\raisebox{0.1em}{#?}}{\\underset{\\raisebox{-0.3em}{#?}}{\\Large #?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Large Box with Superscript and Subscript' },
      // { label: '□̲̅', insert: '\\overset{#?}{\\underset{#?}{\\square}}', title: 'Box with over and underscript' },


      // Right sub/superscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="1" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}^{\\raisebox{0.6em}{#?}}', isWidget: true, title: 'Subscript and superscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="16" y="4" width="16" height="24" rx="1" stroke="#222" /><rect x="19" y="40" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\underset{\\raisebox{-0.3em}{#?}}{\\Large #?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Large Box with Subscript' },
      // { label: '□̲', insert: '\\underset{#?}{#?}', title: 'Underscript' },



      // Right subscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}', isWidget: true, title: 'Subscript' },


      { type: 'sep', cols: 2, cls: 'cme-matrix-subgroup' },
      {
        label: (
          <svg width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="18" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\enspace',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Horizontal Phantom Space'
      },
      {
        label: (
          <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', marginLeft: "13px" }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="10" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\,',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Thin Space'
      },
      {
        label: (
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}>
            <rect x="2" y="2" width="6" height="12" rx="1" />
            <rect x="8" y="2" width="6" height="12" rx="1" />
          </svg>
        ),
        insert: '\\!',
        cls: 'template',
        directInsert: true,
        action: 'INSERT_CUSTOM',
        title: 'Negative Thin Space'
      },


      // { label: 'e', insert: 'e' }, { label: 'i', insert: 'i' },
      // { label: 'π', insert: '\\pi' },
      // { label: 'ℝ', insert: '\\mathbb{R}' }, { label: 'ℤ', insert: '\\mathbb{Z}' },
      // { label: 'ℕ', insert: '\\mathbb{N}' }, { label: 'ℚ', insert: '\\mathbb{Q}' },
      // { label: 'ℂ', insert: '\\mathbb{C}' }, { label: '∅', insert: '\\emptyset' },
      // { label: 'ℵ₀', insert: '\\aleph_0' },
      // { label: 'ξ', insert: '\\xi' },
      // { label: 'ρ', insert: '\\rho' }, { label: 'σ', insert: '\\sigma' },
      // { label: 'τ', insert: '\\tau' }, { label: 'υ', insert: '\\upsilon' },
      // { label: 'φ', insert: '\\varphi' }, { label: 'χ', insert: '\\chi' },
      // { label: 'ψ', insert: '\\psi' }, { label: 'ω', insert: '\\omega' },
      // { label: 'Γ', insert: '\\Gamma' },
      // { label: 'Θ', insert: '\\Theta' }, { label: 'Λ', insert: '\\Lambda' },
      // { label: 'Ξ', insert: '\\Xi' }, { label: 'Σ', insert: '\\Sigma' },
      // { label: 'Φ', insert: '\\Phi' }, { label: 'Ψ', insert: '\\Psi' },
      // { label: 'Ω', insert: '\\Omega' },
      // { label: 'θᵢ', insert: '\\theta_{#?}' }, { label: 'λₙ', insert: '\\lambda_{#?}' },
      // { label: 'μₓ', insert: '\\mu_{#?}' }, { label: 'σ²', insert: '\\sigma^{2}' },
      // { label: 'Δx', insert: '\\Delta #?' },
    ]
  },

  {
    label: '( )', fontSize: '9px', isTemplate: true, mathLabel: '\\left( #? \\right) \\, \\overparen{#?}', items: [
      {
        type: 'sep', cols: 3, small: true, moreCols: 2, cls: 'cme-matrix-subgroup', moreItems: [
          // Floor
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M12 12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M52 12V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left\\lfloor#0\\right\\rfloor', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Floor Brackets' },
          // { label: '⌊ ⌋', insert: '\\lfloor #? \\rfloor', isWidget: true, title: 'Lfloor' },

          // Angle bracket with bar
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 18L2 29L10 40" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="16" y="18" width="10" height="20" rx="1" /><line x1="32" y1="18" x2="32" y2="40" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="42" y="18" width="10" height="20" rx="1" /><path d="M54 18L62 29L54 40" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\left\\langle#?\\mid#?\\right\\rangle', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Angle Brackets with Vertical Bar' },
          // { label: '〈|', insert: '\\langle #? \\mid #? \\rangle', isWidget: true, title: 'Langle' },

          // Ceiling
          { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M12 52V12H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M52 52V12H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left\\lceil#0\\right\\rceil', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Ceiling Brackets' },
          // { label: '⌈ ⌉', insert: '\\lceil #? \\rceil', isWidget: true, title: 'Lceil' },
        ]
      },
      // Parenthes
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12 Q8 32 18 52" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12 Q56 32 46 52" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left(#0\\right)', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Parentheses' },
      // { label: '', insert: '\\left( #? \\right)', title: 'Parentheses' },

      // Vertical bars
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" /><rect x="26" y="18" width="12" height="22" rx="2" /><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" /></svg>), insert: '\\left|#0\\right|', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'vertical bars' },
      // { label: '| |', insert: '\\left| #? \\right|', title: 'Vertical bars' },

      // Angle brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 14L6 32L18 50" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="26" y="19" width="12" height="20" rx="1" /><path d="M46 14L58 32L46 50" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>), insert: '\\left\\langle #? \\right\\rangle', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Angle Brackets' },
      // { label: '⟨ ⟩', insert: '\\left\\langle #? \\right\\rangle', title: 'Angle brackets' },

      // Square brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 12H12V52H18" stroke="#222" strokeWidth="4" fill="none" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M46 12H52V52H46" stroke="#222" strokeWidth="4" fill="none" /></svg>), insert: '\\left[#0\\right]', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Square Brackets' },
      // { label: '[ ]', insert: '\\left[ #? \\right]', title: 'Square brackets' },

      // Double vertical bars
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="10" y1="12" x2="10" y2="52" stroke="#222" strokeWidth="4" /><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" /><rect x="26" y="18" width="12" height="20" rx="1" /><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" /><line x1="54" y1="12" x2="54" y2="52" stroke="#222" strokeWidth="4" /></svg>), insert: '\\left\\Vert#?\\right\\Vert', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Double Vertical Bars' },
      // { label: '‖ ‖', insert: '\\| #? \\|', title: 'Double vertical bars' },

      // Curly brackets
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M20 12C16 12 16 18 18 22C19 24 19 26 16 29C19 32 19 34 18 36C16 40 16 46 20 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="18" width="12" height="22" rx="2" /><path d="M44 12C48 12 48 18 46 22C45 24 45 26 48 29C45 32 45 34 46 36C48 40 48 46 44 52" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>), insert: '\\left\\{#0\\right\\}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curly Braces' },
      // { label: '{ }', insert: '\\left\\{ #? \\right\\}', title: 'Curly brackets' },




      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Overbrace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 26V20H24C28 20 30 18 32 14C34 18 36 20 40 20H54V26" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overbrace{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overbrace' },

      // Overgroup
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 26C10 14 54 14 54 26" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overgroup{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Overgroup' },

      // Underbrace
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 44H24C28 44 30 46 32 50C34 46 36 44 40 44H54M10 44V38M54 44V38" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="14" width="12" height="20" rx="1" /></svg>), insert: '\\underbrace{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underbrace' },

      // Undergroup
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M10 38C10 50 54 50 54 38" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="14" width="12" height="20" rx="1" /></svg>), insert: '\\undergroup{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Undergroup' },








      { type: 'sep', cols: 3, small: true, cls: 'cme-symbol-subgroup' },
      // Overrightharpoon
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overrightharpoon{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Right harpoon accent' },

      // Arrow accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20M40 28L48 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Arrow accent' },

      // Left-right arrow accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M16 20H48M40 12L48 20M40 28L48 20M24 12L16 20M24 28L16 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overleftrightarrow{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Left-right arrow accent' },

      // Bar accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 20H46" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Bar accent' },

      // Wide hat
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 24L32 12L46 24" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\widehat{\\mathrm{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Wide hat' },

      // Tilde accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M22 20 Q27 16 32 20 T42 20" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\tilde{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Tilde accent' },

      // Diaeresis accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M28 18v0M36 18v0" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\ddot{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Diaeresis accent' },

      // Dot accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M32 18v0" stroke="#222" strokeWidth="6" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\dot{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Dot accent' },



      {
        type: 'sep', cols: 3, small: true, cls: 'cme-matrix-subgroup', moreItems: [

          // Enclose actuarial
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 2 H20 V22" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
              </svg>
            ),
            insert: '\\enclose{actuarial}{\\begin{array}{@{}c@{}} \\hspace{3px}#? \\end{array}}',
            title: 'Enclose actuarial'
          },

          // Enclose rounded box

          {
            label: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="2" width="16" height="20" rx="8" ry="8" stroke="#666" strokeWidth="2" fill="none" />
              <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            </svg>, insert: '\\enclose{roundedbox}{\\raisebox{-2.5px}{#?}}', title: 'Enclose rounded box'
          },

        ]
      },

      // Bar accent
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><path d="M18 20H46" stroke="#222" strokeWidth="4" fill="none" strokeLinecap="round" /><rect x="26" y="30" width="12" height="20" rx="1" /></svg>), insert: '\\overline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Bar accent' },

      // Enclosed left
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="16" y1="12" x2="16" y2="52" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="28" y="18" width="14" height="28" rx="2" /></svg>), insert: '\\left| #? \\right.', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed left' },

      // Enclosed box
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="2" width="16" height="20" stroke="#666" strokeWidth="2" fill="none" />
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
          </svg>
        ),
        insert: '\\boxed{#?}',
        forceLabel: true,
        title: 'Enclosed box'
      },

      // Enclosed bottom
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="18" y1="46" x2="46" y2="46" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="26" y="20" width="12" height="20" rx="1" /></svg>), insert: '\\underline{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed bottom' },

      // Enclosed right
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><line x1="48" y1="12" x2="48" y2="52" stroke="#222" strokeWidth="4" strokeLinecap="round" /><rect x="22" y="18" width="14" height="28" rx="2" /></svg>), insert: '\\left. #? \\right|', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Enclosed right' },

      // Enclosed circle
      { label: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12" rx="9" ry="11" stroke="#666666" strokeWidth="2" fill="none" /><rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>, insert: '\\enclose{circle}{\\begin{array}{@{}c@{}} \\raisebox{-2.5px}{\\,\\,#?} \\end{array}}', forceLabel: true, title: 'Enclose circle' },




      {
        type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup', moreCols: 2, moreItems: [


          //vertical
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
                <line x1="12" y1="3" x2="12" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ),
            insert: '\\enclose{verticalstrike}{#?}',
            title: 'Vertical strike'
          },

          // Long division
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M3 22 Q11 12 3 2 H21" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <rect x="11" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
              </svg>
            ),
            insert: ') \\!\\! \\overline{\\vphantom{1}\\;\\;#?\\;}',
            directInsert: true,
            title: 'Long division'
          },

          // Horizontal and vertical strike
          {
            label: (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
                <line x1="6" y1="12" x2="18" y2="12" stroke="#666" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="3" x2="12" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ),
            insert: '\\enclose{horizontalstrike}{\\begin{array}{c@{}} \\raisebox{-8px}{\\enclose{verticalstrike}{\\vphantom{\\rule{0pt}{14px}}#?}} \\end{array}}',
            title: 'Horizontal and vertical strike'
          },


        ]
      },

      //cancel
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="21" x2="15" y2="3" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{updiagonalstrike}{#0}',
        forceLabel: true,
        title: 'Cancel strike'
      },


      // Horizontal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="6" y1="12" x2="18" y2="12" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{horizontalstrike}{\\begin{array}{c@{}} \\raisebox{-8px}{#?} \\end{array}}',
        forceLabel: true,
        title: 'Horizontal strike'
      },

      // Down diagonal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="3" x2="15" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\enclose{downdiagonalstrike}{#0}',
        forceLabel: true,
        title: 'Down diagonal strike'
      },

      // Up and down diagonal strike
      {
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="7" width="6" height="10" rx="1" stroke="#2E7D32" strokeWidth="2" fill="none" />
            <line x1="9" y1="21" x2="15" y2="3" stroke="#666" strokeWidth="2" strokeLinecap="round" />
            <line x1="9" y1="3" x2="15" y2="21" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ),
        insert: '\\xcancel{#?}',
        forceLabel: true,
        title: 'Cross strike'
      },


    ]
  },

  {
    label: '∑ ⋃ ', fontSize: "8px", mathLabel: '\\sum \\, \\bigcup', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Big operator with under and over scripts
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M44 16 L22 16 L34 32 L22 48 L44 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="-3" width="10" height="12" rx="1" opacity="0.45" /><rect x="27" y="56" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\sum_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with limits' },

      // Big operator with side scripts (subscript/superscript)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M38 16 L16 16 L28 32 L16 48 L38 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="42" y="2" width="10" height="16" rx="1" opacity="0.45" /><rect x="42" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\sum\\nolimits_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with side limits' },


      // Big operator with under script
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M44 16 L22 16 L34 32 L22 48 L44 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="54" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\sum_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with subscript' },


      // Big operator with side script (subscript only)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: "visible" }}><path d="M38 16 L16 16 L28 32 L16 48 L38 48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="42" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\sum\\nolimits_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Summation with side subscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Big operator with subscript and superscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M18 16 H46 M22 16 V48 M42 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="-2" width="10" height="12" rx="1" opacity="0.45" /><rect x="27" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\prod_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with limits' },


      // Big operator with side scripts (subscript/superscript)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 16 H40 M16 16 V48 M36 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="44" y="4" width="10" height="16" rx="1" opacity="0.45" /><rect x="44" y="44" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\prod\\nolimits_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with side limits' },

      // Big operator with subscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M18 16 H46 M22 16 V48 M42 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="27" y="50" width="10" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\prod_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with subscript' },


      // Big operator with side script (subscript only)
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 16 H40 M16 16 V48 M36 16 V48" stroke="#222" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><rect x="44" y="39" width="10" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\prod\\nolimits_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Product with side subscript' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      // Base with over and underscript
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="24" y="4" width="8" height="12" rx="1" opacity="0.45" /><rect x="22" y="22" width="12" height="20" rx="1" /><rect x="24" y="48" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\overset{#?}{\\underset{\\raisebox{-4px}{#?}}{#?}}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Over and underscript' },


      // Right sub/superscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="1" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}^{\\raisebox{0.6em}{#?}}', isWidget: true, title: 'Subscript and superscript' },

      // Element under
      { label: (<svg width="26" height="26" viewBox="0 4 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32' }}><rect x="19" y="28" width="12" height="18" rx="1" /><rect x="21" y="52" width="8" height="12" rx="1" opacity="0.45" /></svg>), insert: '\\underset{\\raisebox{-4px}{#?}}{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Underscript' },


      // Right subscript
      { label: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="17" y="17" width="6" height="6" fill="none" stroke="#2E7D32" strokeWidth="1.5" /></svg>, forceLabel: true, insert: '{\\style{font-size:1.8em; transform: scale(0.9, 1.2); display: inline-block; padding: 0.2em 0;}{#?}}_{#?}', isWidget: true, title: 'Subscript' },







      {
        type: 'sep', cols: 1, small: true, cls: 'cme-matrix-subgroup', moreCols: 3, moreItems: [
          { label: '⨅', insert: '⨅', title: 'Big square cap' },   // U+2A05 Big square cap
          { label: '∏', insert: '∏', title: 'Product' },   // U+220F Product
          { label: '∑', insert: '∑', title: 'Summation' },   // U+2211 Summation
          { label: '⨆', insert: '⨆', title: 'Big square cup' },   // U+2A06 Big square cup
          { label: '∐', insert: '∐', title: 'Coproduct' },   // U+2210 Coproduct
        ]
      },
      // Big Union
      { label: '⋃', insert: '\\bigcup', title: 'Big union' },

      // Big Intersection
      { label: '⋂', insert: '\\bigcap', title: 'Big intersection' },






    ]
  },

  // {
  //   label: 'sin/cos', items: [
  //     { label: 'sin', insert: '\\sin' }, { label: 'cos', insert: '\\cos' },
  //     { label: 'tan', insert: '\\tan' }, { label: 'cot', insert: '\\cot' },
  //     { label: 'sec', insert: '\\sec' }, { label: 'csc', insert: '\\csc' },


  //     { label: 'sin(□)', insert: '\\sin\\left(#0\\right)' },
  //     { label: 'cos(□)', insert: '\\cos\\left(#0\\right)' },
  //     { label: 'tan(□)', insert: '\\tan\\left(#0\\right)' },

  //     { label: 'sin⁻¹', insert: '\\sin^{-1}' }, { label: 'cos⁻¹', insert: '\\cos^{-1}' },
  //     { label: 'tan⁻¹', insert: '\\tan^{-1}' },
  //     { label: 'sin²x', insert: '\\sin^{2}\\left(#0\\right)' },
  //     { label: 'cos²x', insert: '\\cos^{2}\\left(#0\\right)' },
  //     { label: 'tan²x', insert: '\\tan^{2}\\left(#0\\right)' },

  //     { label: 'sinh', insert: '\\sinh' }, { label: 'cosh', insert: '\\cosh' },
  //     { label: 'tanh', insert: '\\tanh' },
  //     { label: 'ln', insert: '\\ln' },
  //     { label: 'exp', insert: '\\exp' },
  //   ]
  // },

  {
    label: '∫ lim', fontSize: "7px", mathLabel: '\\int_{#?}^{#?} \\, \\lim', isTemplate: true, items: [

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      //infinity 
      { label: (<svg width="24" height="26" viewBox="0 0 44 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="24" y="10" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\int_{#?}^{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Int' },
      { label: (<svg width="40" height="26" viewBox="0 0 96 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="24" y="10" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="42" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="62" y="38" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" stroke="none">d</text><rect x="76" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\int_{#?}^{#?} #0 \\, d#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Definite integral' },
      { label: (<svg width="24" height="26" viewBox="0 0 44 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\int_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Integral with subscript' },
      { label: (<svg width="40" height="26" viewBox="0 0 96 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="4" y="54" fontFamily="serif" fontSize="58" fontStyle="italic" fill="#222" stroke="none" transform="rotate(10, 14, 32)">∫</text><rect x="16" y="46" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /><rect x="42" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="62" y="38" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" stroke="none">d</text><rect x="76" y="24" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\int_{#?} #?\\,d#?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Integral with subscript and differential' },



      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      //derivatives
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="32" y="42" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="36" fill="#222" textAnchor="middle">d</text></svg>), insert: '\\mathrm{d}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Mathrm d' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><line x1="8" y1="32" x2="56" y2="32" stroke="#222" strokeWidth="3" /><text x="22" y="24" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">d</text><rect x="32" y="8" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="22" y="54" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">d</text><rect x="32" y="38" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\frac{d#?}{d#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Derivative' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="32" y="44" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="36" fill="#222" textAnchor="middle">∂</text></svg>), insert: '\\partial', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Partial differential' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><line x1="8" y1="32" x2="56" y2="32" stroke="#222" strokeWidth="3" /><text x="22" y="24" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">∂</text><rect x="32" y="8" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /><text x="22" y="54" fontFamily="serif" fontStyle="italic" fontWeight="bold" fontSize="24" fill="#222" textAnchor="middle">∂</text><rect x="32" y="38" width="14" height="16" rx="2" stroke="#2E7D32" strokeWidth="2" fill="none" /></svg>), insert: '\\frac{\\partial#?}{\\partial #?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Partial derivative' },


      { type: 'sep', cols: 1, small: true, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><text x="32" y="32" fill="#222" stroke="none" fontSize="24" fontFamily="serif" textAnchor="middle">lim</text><rect x="14" y="40" width="10" height="14" rx="1" opacity="0.45" /><text x="28" y="52" fill="#222" stroke="none" fontSize="16" fontFamily="sans-serif">→</text><text x="44" y="52" fill="#222" stroke="none" fontSize="18" fontFamily="serif">∞</text></svg>), insert: '\\lim_{#?\\to\\infty}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Limit to infinity' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><text x="32" y="32" fill="#222" stroke="none" fontSize="24" fontFamily="serif" textAnchor="middle">lim</text><rect x="24" y="40" width="16" height="16" rx="1" opacity="0.45" /></svg>), insert: '\\lim_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Limit' },

      { type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 24 L28 24 L20 40 Z" stroke="#222" strokeWidth="3" fill="none" strokeLinejoin="round" /><path d="M34 26 L46 38 M46 26 L34 38" stroke="#222" strokeWidth="3" fill="none" strokeLinecap="round" /><rect x="50" y="22" width="12" height="20" rx="1" /></svg>), insert: '\\nabla\\times #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Curl' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M16 24 L36 24 L26 44 Z" stroke="#222" strokeWidth="4" fill="none" strokeLinejoin="round" /><rect x="44" y="24" width="16" height="20" rx="1" /></svg>), insert: '\\nabla #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Gradient' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M12 24 L28 24 L20 40 Z" stroke="#222" strokeWidth="3" fill="none" strokeLinejoin="round" /><circle cx="38" cy="32" r="3" fill="#222" stroke="none" /><rect x="46" y="22" width="12" height="20" rx="1" /></svg>), insert: '\\nabla\\cdot #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Divergence' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'inline-block', verticalAlign: 'middle', color: '#2E7D32', overflow: 'visible' }}><path d="M26 16 L12 44 L40 44 Z" stroke="#222" strokeWidth="4" fill="none" strokeLinejoin="round" /><rect x="46" y="24" width="16" height="20" rx="1" /></svg>), insert: '\\Delta #?', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Laplacian' },

      {
        type: 'sep', cols: 2, small: true, cls: 'cme-matrix-subgroup', moreItems: [

          { label: '∭', insert: '\\iiint', title: 'Triple integral' },
          // { label: '∰', insert: '\\oiiint', title: 'Closed volume integral' },
          { label: '∰', insert: '\\mathop{{\\style{font-size:1em;}{\\iiint}}\\mkern-28mu\\class{wider-circle}{\\bigcirc}\\mkern18mu}', title: 'Closed volume integral' },


        ]
      },
      { label: '∫', insert: '\\int', title: 'Integral' },
      { label: '∬', insert: '\\iint', title: 'Double integral' },
      { label: '∮', insert: '\\oint', title: 'Contour integral' },
      // { label: '∯', insert: '\\oiint', title: 'surface integral' },
      { label: '∯', insert: '\\mathop{{\\style{font-size:1em;}{\\iint}}\\mkern-23mu\\class{wide-circle}{\\bigcirc}\\mkern14mu}', title: 'Custom surface integral' },


      {
        type: 'sep', cols: 3, cls: 'cme-trig-subgroup', moreCols: '3', moreItems: [
          { label: 'csc', insert: '\\csc\\left(#?\\right)', title: 'Cosecant' },
          { label: 'sec', insert: '\\sec\\left(#?\\right)', title: 'Secant' },
          { label: 'cot', insert: '\\cot\\left(#?\\right)', title: 'Cotangent' },
          { label: 'sin⁻¹', insert: '\\sin^{-1}', title: 'Inverse sine' },
          { label: 'cos⁻¹', insert: '\\cos^{-1}', title: 'Inverse cosine' },
          { label: 'tan⁻¹', insert: '\\tan^{-1}', title: 'Inverse tangent' },
        ]
      },
      { label: 'sin', insert: '\\sin', title: 'Sine' },
      { label: 'cos', insert: '\\cos', title: 'Cosine' },
      { label: 'tan', insert: '\\tan', title: 'Tangent' },
      { label: 'log', insert: '\\log', title: 'Logarithm' },
      { label: (<svg width="26" height="26" viewBox="0 0 64 64" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}><text x="2" y="42" fontFamily="serif" fontSize="28" fill="#222" stroke="none">log</text><rect x="42" y="36" width="8" height="10" rx="1" stroke="#2E7D32" strokeWidth="1.5" fill="none" /></svg>), insert: '\\log_{#?}', cls: 'template', directInsert: true, action: 'INSERT_CUSTOM', title: 'Logarithm with base' },
      { label: 'ln', insert: '\\ln', title: 'Natural logarithm' },


      // { label: '∫∫dA', insert: '\\iint_{#?} #0 \\, dA' },
      // { label: '∮C', insert: '\\oint_{#?} #0 \\, d#?' },
      // { label: '∫∫∫dV', insert: '\\iiint_{#?} #0 \\, dV' },
      // { label: '∫_C', insert: '\\int_{C} #0 \\, d#?' },
      // { label: '∮_C', insert: '\\oint_{C} #0 \\, d#?' },
      // { label: '∫∫_D', insert: '\\iint_{D} #0 \\, dA' },

      // { label: 'u-sub', insert: '\\int #0 \\, du' },

      // { label: '∭', insert: '\\iiint' },   // Triple integral
      // { label: '∰', insert: '\\oiiint' },   // Closed volume integral




    ]
  },
  // {
  //   label: (
  //     <svg
  //       xmlns="http://www.w3.org/2000/svg"
  //       viewBox="0 0 64 64"
  //       width="20"
  //       height="20"
  //       fill="none"
  //       stroke="currentColor"
  //       strokeWidth="3"
  //       strokeLinecap="round"
  //       strokeLinejoin="round"
  //       style={{ verticalAlign: 'middle' }}
  //     >
  //       <path d="M32 12 L24 24 H40 Z" fill="currentColor" />
  //       <path d="M16 36 C16 48, 48 48, 48 36" />
  //       <path d="M22 36 C22 43, 42 43, 42 36" />
  //     </svg>
  //   ),

  //   items: [

  //     { type: 'sep', cols: 2, cls: 'cme-trig-subgroup' }


  //   ]
  // },



];





function serializeChemValue(latex = '') {
  const match = String(latex).match(/^\\ce\{([\s\S]*)\}$/);
  if (match) return latex;
  const normalized = latex.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\$/g, '').trim();
  return normalized ? `\\ce{${normalized}}` : '';
}

function getMatrixPreviewLatex(insertType) {
  if (insertType === 'matrix') {
    return '\\begin{matrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{matrix}';
  }
  if (insertType === 'bmatrix') {
    return '\\begin{bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{bmatrix}';
  }
  if (insertType === 'pmatrix') {
    return '\\begin{pmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{pmatrix}';
  }
  if (insertType === 'vmatrix') {
    return '\\begin{vmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{vmatrix}';
  }
  return insertType.replace(/#0|#\?/g, '\\placeholder{}');
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
              // Strip empty placeholders for display in CKEditor so it shows a space instead of a box
              // We use \quad to ensure the space is distinctly visible and not swallowed
              // We also strip \text{} wrappers because inside text mode (like \raisebox) they render as literal strings
              let displayLatex = stripEncloseOptions(
                stripTextWrappers(
                  latex.replace(/\\placeholder\{[^}]*\}/g, '\\quad ')
                )
              );
                
              // mhchem (\ce) ignores math padding like \, which causes \enclose circles to collapse and look small.
              // If the widget contains \enclose and is wrapped in \ce{}, we unwrap it so it renders identically to the math editor.
              if (displayLatex.includes('\\enclose') && /^\\ce\{[\s\S]*\}$/i.test(displayLatex.trim())) {
                displayLatex = displayLatex.trim().replace(/^\\ce\{([\s\S]*)\}$/i, '$1');
              }
              
              if (mf.setValue) mf.setValue(displayLatex, { silenceNotifications: true });
              else mf.value = displayLatex;
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
          'data-latex': latex, // Keep raw latex in data-latex for restoring
          style: 'display:inline;',
        });

        // Strip placeholders and \text{} wrappers for the exported HTML so they render cleanly
        let displayLatex = stripEncloseOptions(
          stripTextWrappers(
            latex.replace(/\\placeholder\{[^}]*\}/g, '\\quad ')
          )
        );
          
        if (displayLatex.includes('\\enclose') && /^\\ce\{[\s\S]*\}$/i.test(displayLatex.trim())) {
          displayLatex = displayLatex.trim().replace(/^\\ce\{([\s\S]*)\}$/i, '$1');
        }
        
        writer.insert(writer.createPositionAt(span, 0), writer.createText(displayLatex));
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

  const numRows = Math.max(10, parseInt(hoverGrid.r, 10) || 0);
  const numCols = Math.max(10, parseInt(hoverGrid.c, 10) || 0);

  const handleRowChange = (e) => {
    const val = e.target.value;
    if (val === '') {
      setHoverGrid(prev => ({ ...prev, r: '' }));
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setHoverGrid(prev => ({ ...prev, r: Math.max(1, Math.min(10, parsed)) }));
    }
  };

  const handleRowBlur = () => {
    if (hoverGrid.r === '' || isNaN(parseInt(hoverGrid.r, 10))) {
      setHoverGrid(prev => ({ ...prev, r: 1 }));
    }
  };

  const handleColChange = (e) => {
    const val = e.target.value;
    if (val === '') {
      setHoverGrid(prev => ({ ...prev, c: '' }));
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setHoverGrid(prev => ({ ...prev, c: Math.max(1, Math.min(10, parsed)) }));
    }
  };

  const handleColBlur = () => {
    if (hoverGrid.c === '' || isNaN(parseInt(hoverGrid.c, 10))) {
      setHoverGrid(prev => ({ ...prev, c: 1 }));
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const r = parseInt(hoverGrid.r, 10) || 1;
        const c = parseInt(hoverGrid.c, 10) || 1;
        onSelect(r, c);
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
        {Array.from({ length: numRows }).map((_, rIndex) => (
          <div key={rIndex} className="cme-matrix-hover-row">
            {Array.from({ length: numCols }).map((_, cIndex) => {
              const targetR = parseInt(hoverGrid.r, 10) || 0;
              const targetC = parseInt(hoverGrid.c, 10) || 0;
              const isSelected = rIndex < targetR && cIndex < targetC;
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
          <input
            type="number"
            className="cme-counter-val"
            value={hoverGrid.r}
            onChange={handleRowChange}
            onBlur={handleRowBlur}
            min="1"
            max="10"
          />
          <div className="cme-counter-btns">
            <button type="button" onClick={() => setHoverGrid(prev => {
              const r = parseInt(prev.r, 10) || 1;
              return { ...prev, r: Math.min(10, r + 1) };
            })}>▲</button>
            <button type="button" onClick={() => setHoverGrid(prev => {
              const r = parseInt(prev.r, 10) || 1;
              return { ...prev, r: Math.max(1, r - 1) };
            })}>▼</button>
          </div>
        </div>
        <div className="cme-matrix-counter">
          <span>C</span>
          <input
            type="number"
            className="cme-counter-val"
            value={hoverGrid.c}
            onChange={handleColChange}
            onBlur={handleColBlur}
            min="1"
            max="10"
          />
          <div className="cme-counter-btns">
            <button type="button" onClick={() => setHoverGrid(prev => {
              const c = parseInt(prev.c, 10) || 1;
              return { ...prev, c: Math.min(10, c + 1) };
            })}>▲</button>
            <button type="button" onClick={() => setHoverGrid(prev => {
              const c = parseInt(prev.c, 10) || 1;
              return { ...prev, c: Math.max(1, c - 1) };
            })}>▼</button>
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
  const [morePopup, setMorePopup] = useState(null); // { x, y, items } or null
  const morePopupTimerRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDragStart = (e) => {
    if (e.target.closest('.cme-popup-close')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const groups = mode === 'math' ? MATH_GROUPS : CHEM_GROUPS;

  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
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

      const mlItalic = (
        mf.queryStyle({ variantStyle: 'italic' }) === 'all' ||
        mf.queryStyle({ shape: 'it' }) === 'all'
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

      setActiveStyles(prev => ({
        bold: prev.bold,
        italic: prev.italic,
        fontFamily: currentFont,
        fontSize: String(currentSize),
        color: currentColor,
      }));
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
    if (!morePopup) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.cme-more-popup') && !e.target.closest('.cme-more-trigger-btn')) {
        setMorePopup(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick, true);
      window.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [morePopup]);

  // Patch newly mounted read-only math-field shadow roots on group change
  useEffect(() => {
    const id = setTimeout(() => initMathFieldCursorFix(), 50);
    return () => clearTimeout(id);
  }, [activeGroup]);

  useEffect(() => {
    const mf = popupMfRef.current;
    if (!mf) return;
    // Always use math mode so LaTeX commands (like \enclose and \placeholder) parse correctly, even in chem tab
    mf.defaultMode = 'math';

    // Pre-fill with existing value when editing
    const prefill = () => {
      if (typeof mf.applyStyle === 'function') {
        // Force upright text by default instead of MathLive's default math-italic
        mf.applyStyle({ variantStyle: 'up' });
      }
      if (initialLatex) {
        // For chem, unwrap \ce{...} so user edits raw content
        let valueToSet = initialLatex;
        if (mode === 'chem') {
          const ceMatch = valueToSet.match(/^\\ce\{([\s\S]*)\}$/i);
          if (ceMatch) valueToSet = ceMatch[1];
        }
        
        // Strip \text{} wrappers because they render as literal strings inside text-mode environments (like \raisebox)
        valueToSet = stripTextWrappers(valueToSet);
        
        // Strip MathLive's internal \enclose[options] that it can't re-parse
        valueToSet = stripEncloseOptions(valueToSet);
        
        // Use executeCommand('insert') instead of setValue() because MathLive's setValue()
        // uses a stricter parser that can't handle complex LaTeX (e.g. \enclose, \raisebox, \begin{array}).
        // executeCommand('insert') uses the same parser path as when the user first inserts the template,
        // which handles these commands correctly.
        if (mf.setValue) mf.setValue('', { silenceNotifications: true });
        else mf.value = '';
        mf.executeCommand(['insert', valueToSet, { insertionMode: 'replaceAll' }]);
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
      // Forcefully apply bold/italic states via explicit LaTeX wrappers to bypass MathLive's buggy future-style insertion on empty lines
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (/[a-zA-Z0-9]/.test(e.key)) {
          if (!activeStyles.bold && !activeStyles.italic) {
            // Neither active: let MathLive handle it natively
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          let latex = e.key;
          if (activeStyles.bold && activeStyles.italic) {
            latex = `\\mathbfit{${e.key}}`;
          } else if (activeStyles.bold) {
            latex = `\\mathbf{${e.key}}`;
          } else if (activeStyles.italic) {
            latex = `\\mathit{${e.key}}`;
          }
          mf.executeCommand(['insert', latex]);
          return;
        }
      }

      if (e.key === ' ') {
        e.preventDefault();
        mf.executeCommand(['insert', '\\, ']);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Use MathLive's native row command for a single clean line break
        mf.executeCommand('addRowAfter');
        // Re-apply active styles on new line
        setTimeout(() => {
          if (typeof mf.applyStyle === 'function') {
            mf.applyStyle({
              fontSeries: activeStyles.bold ? 'b' : 'auto',
              variantStyle: activeStyles.italic ? 'italic' : 'up'
            });
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

    mf.addEventListener('keydown', handleKeyDown, true);
    return () => mf.removeEventListener('keydown', handleKeyDown, true);
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
    <div
      className="cme-editor-popup"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="cme-popup-header"
        onMouseDown={handleDragStart}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <span>{isEditing ? (mode === 'math' ? 'Edit Math Formula' : 'Edit Chemistry Formula') : (mode === 'math' ? 'Math Editor' : 'Chemistry Editor')}</span>
        <button type="button" className="cme-popup-close" onClick={onClose}>×</button>
      </div>

      <div className="cme-toolbar" role="toolbar" aria-label="Symbol palette">
        <div className="cme-toolbar-groups">
          {groups.map((group, index) => {
            const isActive = activeGroup === index;
            // const isLastTab = index === groups.length - 1;
            return (
              <button
                key={group.isMatrix ? 'matrix-tab' : group.label}
                className={`cme-group-tab${isActive ? ' active' : ''}`}
                // style={!isActive && isLastTab ? { backgroundColor: '#DC9E9E' } : {}}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveGroup(index);
                  setActiveMatrix(null);
                }}
              >
                {group.mathLabel ? (
                  <math-field
                    read-only
                    tabIndex={-1}
                    style={{
                      pointerEvents: 'none',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: group.fontSize || (group.isMatrix ? '8px' : '11px'),
                      display: 'inline-block',
                      width: 'auto',
                      minHeight: 'auto',
                      padding: '0',
                      margin: '0',
                      boxShadow: 'none',
                      color: isActive ? '#333333' : '#ffffff',
                    }}
                  >
                    {group.mathLabel}
                  </math-field>
                ) : (
                  group.label
                )}
              </button>
            );
          })}
        </div>

        <div className="cme-toolbar-items">
          {(() => {
            const activeItems = groups[activeGroup]?.items || [];

            // Subgroups support: split by { type: 'sep' }
            const hasSep = activeItems.some(item => item.type === 'sep');
            const subgroups = [];

            if (hasSep) {
              let currentSub = { cols: 2, small: false, cls: '', items: [], moreItems: null };
              for (const item of activeItems) {
                if (item.type === 'sep') {
                  if (currentSub.items.length > 0) {
                    subgroups.push(currentSub);
                  }
                  currentSub = { cols: item.cols || 2, small: !!item.small, cls: item.cls || '', items: [], moreItems: item.moreItems || null, moreCols: item.moreCols || 1 };
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
                  small: false,
                  cls: '',
                  items: activeItems.slice(i, i + size)
                });
              }
            }

            return subgroups.map((subgroup, chunkIndex) => (
              <div
                key={chunkIndex}
                className={`cme-symbol-subgroup${subgroup.small ? ' cme-symbol-subgroup--small' : ''}${subgroup.cls ? ` ${subgroup.cls}` : ''}${subgroup.moreItems ? ' cme-subgroup-has-more' : ''}`}
                style={{ gridTemplateColumns: `repeat(${subgroup.cols}, auto)`, position: 'relative' }}
              >
                {subgroup.moreItems && (
                  <button
                    type="button"
                    className="cme-more-trigger-btn"
                    title="more"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (morePopup && morePopup.items === subgroup.moreItems) {
                        setMorePopup(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMorePopup({ cx: rect.left + rect.width / 2, y: rect.bottom, items: subgroup.moreItems, cols: subgroup.moreCols, isTemplate: groups[activeGroup].isTemplate || groups[activeGroup].label === '√(□)' || groups[activeGroup].isMatrix });
                      }
                    }}
                  >
                    ▶
                  </button>
                )}
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
                          className={`cme-btn template${item.cls ? ` ${item.cls}` : ''}${currentGroup.isMatrix ? ' cme-matrix-btn-small' : ''}`}
                          title={item.title || item.label || item.insert}
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
                          {typeof item.label === 'object' ? item.label : (
                            <math-field
                              read-only
                              style={{
                                pointerEvents: 'none',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                display: 'inline-block',
                                width: 'auto',
                                minHeight: 'auto',
                                padding: '0',
                                margin: '0',
                                boxShadow: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              {getMatrixPreviewLatex(item.mathLabel != null ? item.mathLabel : item.insert)}
                            </math-field>
                          )}
                        </button>
                      </div>
                    );
                  }

                  const isBoldBtn = item.action === 'BOLD';
                  const isItalicBtn = item.action === 'ITALIC';
                  const isColorBtn = item.action === 'TEXT_COLOR';
                  const isBtnActive = (isBoldBtn && activeStyles.bold) || (isItalicBtn && activeStyles.italic) || (isColorBtn && activeStyles.color !== 'none' && activeStyles.color !== 'black');

                  return (
                    <button
                      key={`${currentGroup.label}-${chunkIndex * 4 + i}`}
                      type="button"
                      className={`cme-btn${currentGroup.isTemplate ? ' template' : ''}${item.cls ? ` ${item.cls}` : ''}${isBtnActive ? ' active' : ''}`}
                      title={item.title || item.label || item.insert}
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
                            const newBold = !activeStyles.bold;
                            mf.applyStyle({
                              fontSeries: newBold ? 'b' : 'auto',
                              variantStyle: activeStyles.italic ? 'italic' : 'up'
                            });
                            setActiveStyles(prev => ({ ...prev, bold: newBold }));
                          }
                        } else if (item.action === 'ITALIC') {
                          if (mf && typeof mf.applyStyle === 'function') {
                            mf.focus();
                            const newItalic = !activeStyles.italic;
                            mf.applyStyle({
                              fontSeries: activeStyles.bold ? 'b' : 'auto',
                              variantStyle: newItalic ? 'italic' : 'up',
                            });
                            setActiveStyles(prev => ({ ...prev, italic: newItalic }));
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
                      {(currentGroup.isTemplate || currentGroup.label === '√(□)' || currentGroup.isMatrix || item.isWidget) && item.insert && !item.action && !item.forceLabel ? (
                        <math-field
                          read-only
                          style={{
                            pointerEvents: 'none',
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            display: 'inline-block',
                            width: 'auto',
                            minHeight: 'auto',
                            padding: '0',
                            margin: '0',
                            boxShadow: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {getMatrixPreviewLatex(item.insert)}
                        </math-field>
                      ) : (
                        item.label
                      )}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      </div>

      {morePopup && createPortal((
        <div
          ref={(el) => {
            if (el) {
              requestAnimationFrame(() => {
                const popupRect = el.getBoundingClientRect();
                const editorEl = document.querySelector('.cme-editor-popup');
                let finalLeft = morePopup.cx - popupRect.width / 2;
                let finalTop = morePopup.y;
                if (editorEl) {
                  const editorRect = editorEl.getBoundingClientRect();
                  if (finalLeft + popupRect.width > editorRect.right - 4) {
                    finalLeft = editorRect.right - popupRect.width - 4;
                  }
                  if (finalLeft < editorRect.left + 4) finalLeft = editorRect.left + 4;
                  if (finalTop + popupRect.height > editorRect.bottom - 4) {
                    finalTop = editorRect.bottom - popupRect.height - 4;
                  }
                }
                if (finalLeft + popupRect.width > window.innerWidth - 4) {
                  finalLeft = window.innerWidth - popupRect.width - 4;
                }
                if (finalTop + popupRect.height > window.innerHeight - 4) {
                  finalTop = window.innerHeight - popupRect.height - 4;
                }
                if (finalLeft < 4) finalLeft = 4;
                el.style.left = `${finalLeft}px`;
                el.style.top = `${finalTop}px`;
                el.style.transform = 'none';
                el.style.visibility = 'visible';
              });
            }
          }}
          className="cme-more-popup"
          style={{
            position: 'fixed',
            left: `${morePopup.cx}px`,
            top: `${morePopup.y}px`,
            transform: 'translateX(-50%)',
            visibility: 'hidden',
            zIndex: 100000,
            gridTemplateColumns: `repeat(${morePopup.cols || 1}, auto)`,
          }}
        >
          {morePopup.items.map((item, i) => (
            <button
              key={i}
              type="button"
              className={`cme-more-popup-btn ${item.cls || ''}`}
              title={item.title || item.label || item.insert}
              onMouseDown={(e) => {
                e.preventDefault();
                insertAtCursor(item.insert);
                setMorePopup(null);
              }}
            >
              {item.insert && !item.action && (item.cls === 'template' || item.isWidget) ? (
                <math-field
                  read-only
                  style={{
                    pointerEvents: 'none',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '12px',
                    display: 'inline-block',
                    width: 'auto',
                    minHeight: 'auto',
                    padding: '0',
                    margin: '0',
                    boxShadow: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {getMatrixPreviewLatex(item.mathLabel != null ? item.mathLabel : item.insert)}
                </math-field>
              ) : (
                item.label
              )}
            </button>
          ))}
        </div>
      ), document.body)}


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

      {activeMatrix && createPortal(
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
        />,
        document.body
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

    // We explicitly DO NOT clear the selection here anymore. 
    // Doing so destroyed the carefully constructed caret placement 
    // made during handleInsert, causing the caret to jump to the left.
  }, []);

  const [insertAsUnicode, setInsertAsUnicode] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

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

        // Create position after the inserted widget
        const posAfter = writer.createPositionAfter(mathElement);

        // Insert a space to anchor the caret to the right side of the inline object
        // This is necessary because browsers struggle to render the caret correctly 
        // after inline-block widgets at the end of a line.
        writer.insertText(' ', posAfter);

        // Move the selection explicitly after the inserted space
        writer.setSelection(posAfter.getShiftedBy(1));
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

      <div style={{ marginTop: '10px', marginBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setShowPreviewModal(true)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#0f766e',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600
          }}
        >
          Preview Question
        </button>
      </div>

      {showPreviewModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 10000
        }}>
          <div style={{
            background: 'white', padding: '20px', borderRadius: '8px',
            width: '80%', maxWidth: '800px', maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ccc', paddingBottom: '10px', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Question Preview</h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div style={{ fontSize: '16px', lineHeight: '1.6' }}>
              <QuestionPreview value={value} />
            </div>

            <div style={{ marginTop: '30px', textAlign: 'right' }}>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{ padding: '8px 16px', backgroundColor: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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