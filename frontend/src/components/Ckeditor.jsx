import { useRef, useState, useCallback, useEffect } from 'react';
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
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import 'mathlive';
import './CustomMathEditor.css';

/* ══════════════════════════════════════════════════════════
   Symbol groups — same as CustomMathEditor.jsx
══════════════════════════════════════════════════════════ */
const MATH_GROUPS = [
  { label: 'Greek', items: [
    { label: 'α', insert: '\\alpha' }, { label: 'β', insert: '\\beta' },
    { label: 'γ', insert: '\\gamma' }, { label: 'δ', insert: '\\delta' },
    { label: 'ε', insert: '\\varepsilon' }, { label: 'ζ', insert: '\\zeta' },
    { label: 'η', insert: '\\eta' }, { label: 'θ', insert: '\\theta' },
    { label: 'λ', insert: '\\lambda' }, { label: 'μ', insert: '\\mu' },
    { label: 'π', insert: '\\pi' }, { label: 'ρ', insert: '\\rho' },
    { label: 'σ', insert: '\\sigma' }, { label: 'τ', insert: '\\tau' },
    { label: 'φ', insert: '\\varphi' }, { label: 'ω', insert: '\\omega' },
    { label: 'Γ', insert: '\\Gamma' }, { label: 'Δ', insert: '\\Delta' },
    { label: 'Θ', insert: '\\Theta' }, { label: 'Λ', insert: '\\Lambda' },
    { label: 'Σ', insert: '\\Sigma' }, { label: 'Φ', insert: '\\Phi' },
    { label: 'Ω', insert: '\\Omega' },
  ]},
  { label: 'Operators', items: [
    { label: '±', insert: '\\pm' }, { label: '×', insert: '\\times' },
    { label: '÷', insert: '\\div' }, { label: '≠', insert: '\\neq' },
    { label: '≤', insert: '\\leq' }, { label: '≥', insert: '\\geq' },
    { label: '≈', insert: '\\approx' }, { label: '∞', insert: '\\infty' },
    { label: '∑', insert: '\\sum' }, { label: '∏', insert: '\\prod' },
    { label: '∫', insert: '\\int' }, { label: '∮', insert: '\\oint' },
    { label: '∂', insert: '\\partial' }, { label: '∇', insert: '\\nabla' },
    { label: '∈', insert: '\\in' }, { label: '∉', insert: '\\notin' },
    { label: '⊂', insert: '\\subset' }, { label: '∪', insert: '\\cup' },
    { label: '∩', insert: '\\cap' }, { label: '∅', insert: '\\emptyset' },
    { label: '√', insert: '\\sqrt{#0}' }, { label: '∛', insert: '\\sqrt[3]{#0}' },
  ]},
  { label: 'Templates', isTemplate: true, items: [
    { label: 'a/b', insert: '\\frac{#0}{#?}' }, { label: 'xⁿ', insert: '#0^{#?}' },
    { label: 'xₙ', insert: '#0_{#?}' }, { label: '√x', insert: '\\sqrt{#0}' },
    { label: 'ⁿ√x', insert: '\\sqrt[#?]{#0}' }, { label: '()', insert: '\\left(#0\\right)' },
    { label: '[]', insert: '\\left[#0\\right]' }, { label: '|x|', insert: '\\left|#0\\right|' },
    { label: 'lim', insert: '\\lim_{#?}' }, { label: '∫dx', insert: '\\int_{#?}^{#?}' },
    { label: '∑', insert: '\\sum_{#?}^{#?}' }, { label: 'vec', insert: '\\vec{#0}' },
    { label: 'hat', insert: '\\hat{#0}' }, { label: 'bar', insert: '\\bar{#0}' },
  ]},
  { label: 'Trig / Log', items: [
    { label: 'sin', insert: '\\sin' }, { label: 'cos', insert: '\\cos' },
    { label: 'tan', insert: '\\tan' }, { label: 'cot', insert: '\\cot' },
    { label: 'sec', insert: '\\sec' }, { label: 'csc', insert: '\\csc' },
    { label: 'sin⁻¹', insert: '\\sin^{-1}' }, { label: 'cos⁻¹', insert: '\\cos^{-1}' },
    { label: 'tan⁻¹', insert: '\\tan^{-1}' }, { label: 'log', insert: '\\log' },
    { label: 'ln', insert: '\\ln' }, { label: 'exp', insert: '\\exp' },
  ]},
  { label: 'Arrows', items: [
    { label: '→', insert: '\\rightarrow' }, { label: '←', insert: '\\leftarrow' },
    { label: '↔', insert: '\\leftrightarrow' }, { label: '⇒', insert: '\\Rightarrow' },
    { label: '⇔', insert: '\\Leftrightarrow' }, { label: '↑', insert: '\\uparrow' },
    { label: '↓', insert: '\\downarrow' },
  ]},
  { label: 'Integrals', isTemplate: true, items: [
    { label: '∫', insert: '\\int' }, { label: '∬', insert: '\\iint' },
    { label: '∭', insert: '\\iiint' }, { label: '∮', insert: '\\oint' },
    { label: '∯', insert: '\\oiint' },
    { label: '∫dx', insert: '\\int #0 \\, d#?' },
    { label: '∫ₐᵇ', insert: '\\int_{#?}^{#?} #0 \\, d#?' },
    { label: '∫∫dA', insert: '\\iint_{#?} #0 \\, dA' },
    { label: '∮C', insert: '\\oint_{#?} #0 \\, d#?' },
    { label: '∫∫∫dV', insert: '\\iiint_{#?} #0 \\, dV' },
    { label: 'F(b)-F(a)', insert: '\\left[#0\\right]_{#?}^{#?}' },
    { label: 'u-sub', insert: '\\int #0 \\, du' },
  ]},
  { label: 'Derivatives', isTemplate: true, items: [
    { label: 'd/dx', insert: '\\frac{d}{dx}' },
    { label: 'dy/dx', insert: '\\frac{dy}{dx}' },
    { label: 'd²y/dx²', insert: '\\frac{d^{2}y}{dx^{2}}' },
    { label: 'dⁿy/dxⁿ', insert: '\\frac{d^{#?}#0}{dx^{#?}}' },
    { label: '∂/∂x', insert: '\\frac{\\partial}{\\partial x}' },
    { label: '∂f/∂x', insert: '\\frac{\\partial #0}{\\partial x}' },
    { label: '∂²f/∂x²', insert: '\\frac{\\partial^{2} #0}{\\partial x^{2}}' },
    { label: '∂²f/∂x∂y', insert: '\\frac{\\partial^{2} #0}{\\partial x \\partial y}' },
    { label: "f'(x)", insert: '#0^{\\prime}(#?)' },
    { label: "f''(x)", insert: '#0^{\\prime\\prime}(#?)' },
    { label: 'ẋ', insert: '\\dot{#0}' }, { label: 'ẍ', insert: '\\ddot{#0}' },
    { label: '∇f', insert: '\\nabla #0' }, { label: '∇²f', insert: '\\nabla^{2} #0' },
  ]},
  { label: 'Logarithmic', isTemplate: true, items: [
    { label: 'log', insert: '\\log' }, { label: 'ln', insert: '\\ln' },
    { label: 'log₁₀', insert: '\\log_{10}' }, { label: 'log₂', insert: '\\log_{2}' },
    { label: 'logₐ', insert: '\\log_{#?}' },
    { label: 'logₐ(x)', insert: '\\log_{#?}\\left(#0\\right)' },
    { label: 'ln(x)', insert: '\\ln\\left(#0\\right)' },
    { label: 'log|x|', insert: '\\log\\left|#0\\right|' },
    { label: 'eˣ', insert: 'e^{#0}' }, { label: 'aˣ', insert: '#?^{#0}' },
    { label: 'log(ab)', insert: '\\log\\left(#0 \\cdot #?\\right)' },
    { label: 'log(a/b)', insert: '\\log\\left(\\frac{#0}{#?}\\right)' },
    { label: 'log(aⁿ)', insert: '\\log\\left(#0^{#?}\\right)' },
  ]},
  { label: 'Constants', items: [
    { label: 'e', insert: 'e' }, { label: 'i', insert: 'i' },
    { label: 'ℝ', insert: '\\mathbb{R}' }, { label: 'ℤ', insert: '\\mathbb{Z}' },
    { label: 'ℕ', insert: '\\mathbb{N}' }, { label: 'ℚ', insert: '\\mathbb{Q}' },
  ]},
  { label: 'Sets', items: [
    { label: '⊆', insert: '\\subseteq' }, { label: '⊇', insert: '\\supseteq' },
    { label: '∖', insert: '\\setminus' }, { label: '∩', insert: '\\cap' },
    { label: '∪', insert: '\\cup' }, { label: '∅', insert: '\\emptyset' },
  ]},
  { label: 'Logic', items: [
    { label: '∀', insert: '\\forall' }, { label: '∃', insert: '\\exists' },
    { label: '¬', insert: '\\neg' }, { label: '∧', insert: '\\land' },
    { label: '∨', insert: '\\lor' },
  ]},
];

const CHEM_GROUPS = [
  { label: 'Period 1-2', isChem: true,
    items: ['H','He','Li','Be','B','C','N','O','F','Ne'].map(el => ({ label: el, insert: el, cls: 'chem-element' })) },
  { label: 'Period 3-4', isChem: true,
    items: ['Na','Mg','Al','Si','P','S','Cl','Ar','K','Ca'].map(el => ({ label: el, insert: el, cls: 'chem-element' })) },
  { label: 'Transition Metals', isChem: true,
    items: ['Fe','Cu','Zn','Mn','Cr','Ni','Co','Ag','Au','Hg','Pb','Sn'].map(el => ({ label: el, insert: el, cls: 'chem-element' })) },
  { label: 'Bonds & Arrows', isChem: true, items: [
    { label: '→', insert: '->', cls: 'chem-arrow' }, { label: '⇌', insert: '<=>', cls: 'chem-arrow' },
    { label: '↑', insert: '^', cls: 'chem-arrow' }, { label: '↓', insert: 'v', cls: 'chem-arrow' },
    { label: '+', insert: '+', cls: 'chem-arrow' },
  ]},
  { label: 'States', isChem: true, items: [
    { label: '(s)', insert: '(s)', cls: 'chem-state' }, { label: '(l)', insert: '(l)', cls: 'chem-state' },
    { label: '(g)', insert: '(g)', cls: 'chem-state' }, { label: '(aq)', insert: '(aq)', cls: 'chem-state' },
  ]},
  { label: 'Charges', isChem: true, items: [
    { label: '⁺', insert: '^{+}', cls: 'chem-element' }, { label: '⁻', insert: '^{-}', cls: 'chem-element' },
    { label: '²⁺', insert: '^{2+}', cls: 'chem-element' }, { label: '²⁻', insert: '^{2-}', cls: 'chem-element' },
    { label: '₂', insert: '2', cls: 'chem-element' }, { label: '₃', insert: '3', cls: 'chem-element' },
    { label: '₄', insert: '4', cls: 'chem-element' },
  ]},
  { label: 'Compounds', isChem: true, items: [
    { label: 'H₂O', insert: 'H2O', cls: 'chem-element' }, { label: 'CO₂', insert: 'CO2', cls: 'chem-element' },
    { label: 'NH₃', insert: 'NH3', cls: 'chem-element' }, { label: 'H₂SO₄', insert: 'H2SO4', cls: 'chem-element' },
    { label: 'HCl', insert: 'HCl', cls: 'chem-element' }, { label: 'NaOH', insert: 'NaOH', cls: 'chem-element' },
    { label: 'NaCl', insert: 'NaCl', cls: 'chem-element' }, { label: 'CaCO₃', insert: 'CaCO3', cls: 'chem-element' },
  ]},
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
  init() {
    const editor = this.editor;

    // 1) Register model element — NOT isObject so it doesn't behave as atomic block
    editor.model.schema.register('mathInline', {
      isInline: true,
      isObject: false,
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

        const rawElement = writer.createRawElement(
          'span',
          {
            class: 'ck-math-widget ck-math-inline-word',
            contenteditable: 'false',
            style: 'display:inline;vertical-align:middle;margin:0 2px;cursor:default;',
          },
          (domElement) => {
            // Create a real <math-field> DOM node — same as CustomTextEditor
            const mf = document.createElement('math-field');
            mf.setAttribute('read-only', '');
            mf.setAttribute('math-virtual-keyboard-policy', 'manual');
            mf.setAttribute('tabindex', '-1');
            mf.style.display = 'inline';
            mf.style.verticalAlign = 'middle';
            mf.style.border = 'none';
            mf.style.background = 'transparent';
            mf.style.outline = 'none';
            mf.style.fontSize = 'inherit';
            mf.style.minHeight = 'auto';
            mf.style.padding = '0 2px';
            mf.style.margin = '0';

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
          }
        );

        return rawElement;
      },
    });

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
const MATH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="1" width="22" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 17 L5 7 L9 13 L13 7 L13 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 13 Q17 8 19 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const CHEM_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><path d="M12 2 L4 7 L4 17 L12 22 L20 17 L20 7 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><text x="12" y="15.5" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" font-family="sans-serif">C</text></svg>';

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
function MathChemPopup({ mode, onInsert, onClose }) {
  const popupMfRef = useRef(null);
  const [activeGroup, setActiveGroup] = useState(0);
  const groups = mode === 'math' ? MATH_GROUPS : CHEM_GROUPS;

  useEffect(() => {
    const mf = popupMfRef.current;
    if (!mf) return;
    mf.defaultMode = mode === 'chem' ? 'text' : 'math';
    requestAnimationFrame(() => mf.focus());
  }, [mode]);

  useEffect(() => {
    const mf = popupMfRef.current;
    if (!mf) return;
    const handleKeyDown = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        if (mode === 'chem') {
          mf.executeCommand(['insert', '\\, ']);
        } else {
          mf.executeCommand(['insert', '\\, ']);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        mf.executeCommand(['insert', '\\\\']);
      }
    };
    mf.addEventListener('keydown', handleKeyDown);
    return () => mf.removeEventListener('keydown', handleKeyDown);
  }, [mode]);

  const insertAtCursor = useCallback((sym) => {
    const mf = popupMfRef.current;
    if (!mf) return;
    mf.focus();
    mf.executeCommand(['insert', sym]);
  }, []);

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
    <div className="cme-editor-popup">
      <div className="cme-popup-header">
        <span>{mode === 'math' ? 'Math Editor' : 'Chemistry Editor'}</span>
        <button type="button" className="cme-popup-close" onClick={onClose}>×</button>
      </div>

      <div className="cme-toolbar" role="toolbar" aria-label="Symbol palette">
        <div className="cme-toolbar-groups">
          {groups.map((group, index) => (
            <button
              key={group.label}
              className={`cme-group-tab${activeGroup === index ? ' active' : ''}`}
              type="button"
              onClick={() => setActiveGroup(index)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <div className="cme-toolbar-items">
          {groups[activeGroup]?.items.map((item, i) => {
            const currentGroup = groups[activeGroup];
            return (
              <button
                key={`${currentGroup.label}-${i}`}
                type="button"
                className={`cme-btn${currentGroup.isTemplate ? ' template' : ''}${item.cls ? ` ${item.cls}` : ''}`}
                title={item.insert}
                onMouseDown={(e) => { e.preventDefault(); insertAtCursor(item.insert); }}
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
          if (popupMfRef.current && (e.target === popupMfRef.current || popupMfRef.current.contains(e.target))) return;
          e.preventDefault();
          requestAnimationFrame(() => { try { popupMfRef.current?.focus(); } catch (_) {} });
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

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div className="cme-popup-footer">
          <button type="button" style={{ backgroundColor: '#9ca3af', color: 'black' }} className="cme-insert-btn" onClick={onClose}>
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
  const supMap = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','i':'ⁱ' };
  text = text.replace(/\^\{([^}]*)\}/g, (_, content) =>
    content.split('').map(c => supMap[c] || c).join('')
  );
  text = text.replace(/\^([a-zA-Z0-9])/g, (_, c) => supMap[c] || c);

  // Subscripts _{content}
  const subMap = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','o':'ₒ','x':'ₓ','i':'ᵢ','j':'ⱼ','n':'ₙ' };
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
  const [popup, setPopup] = useState(null);

  const openPopup = useCallback((mode) => setPopup(mode), []);
  const closePopup = useCallback(() => setPopup(null), []);

  /* Insert as plain Unicode text so backspace deletes char-by-char */
  const handleInsert = useCallback((latex) => {
    const editor = editorRef.current;
    if (!editor || !latex?.trim()) return;

    const plainText = latexToPlainText(latex.trim());
    if (!plainText) return;

    editor.model.change((writer) => {
      const text = writer.createText(plainText);
      editor.model.insertContent(text);
    });

    editor.editing.view.focus();
  }, []);

  const ToolbarPlugin = useRef(makeToolbarPlugin(openPopup)).current;

  return (
    <div style={{ position: 'relative' }}>
      <style>{`.ck-powered-by { display: none !important; }`}</style>

      <CKEditor
        editor={ClassicEditor}
        data={value}
        onReady={(editor) => { editorRef.current = editor; }}
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
        />
      )}
    </div>
  );
}

export default CkEditor;