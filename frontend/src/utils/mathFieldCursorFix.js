/**
 * mathFieldCursorFix.js
 *
 * MathLive's <math-field> renders inside a Shadow DOM, so normal CSS
 * `cursor: pointer` rules cannot penetrate it. The browser keeps showing the
 * text-selection (I-beam) cursor even when `pointer-events: none` is set on
 * the host element.
 *
 * This utility injects a style tag directly into every math-field's shadow root
 * so that read-only math-fields use a pointer cursor and all math-fields have
 * overflow: visible on their internal elements to prevent clipping. It also sets up
 * a MutationObserver so newly-mounted math-fields (e.g., inside popups) are
 * patched automatically.
 */

const STYLE_ATTR = 'data-mathfield-shadow-styles';

function injectMathFieldStyles(mathFieldEl) {
  const sr = mathFieldEl?.shadowRoot;
  if (!sr) return;

  const isReadOnly = mathFieldEl.hasAttribute('read-only') || mathFieldEl.hasAttribute('readonly');
  const cacheKey = isReadOnly ? 'readonly' : 'editable';

  let style = sr.querySelector(`[${STYLE_ATTR}]`);
  if (style && style.getAttribute('data-cache') === cacheKey) {
    return; // already patched with the correct mode
  }

  if (!style) {
    style = document.createElement('style');
    style.setAttribute(STYLE_ATTR, 'true');
    sr.appendChild(style);
  }
  style.setAttribute('data-cache', cacheKey);

  style.textContent = `
    ${isReadOnly ? `
      :host, :host * { cursor: pointer !important; }
      .ML__latex, .ML__content, .ML__container, .ML__virtual-keyboard-toggle { cursor: pointer !important; }
    ` : ''}
    .ML__content, .ML__container, .ML__field-container, .ML__formula {
      overflow: visible !important;
      contain: none !important;
    }
    .wide-circle {
      display: inline-block !important;
      transform: scaleX(1.5) !important;
    }
    .wider-circle {
      display: inline-block !important;
      transform: scaleX(2.2) !important;
    }
    .cme-flip-v {
      display: inline-block;
      transform: scaleY(-1) !important;
    }
    .cme-wide-hat-text {
      position: relative;
    }
    .cme-wide-hat-text::before {
      content: '';
      position: absolute;
      top: -0.1em;
      left: 0;
      width: 100%;
      height: 0.4em;
      background-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 10' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 0 10 L 50 0 L 100 10' stroke='black' stroke-width='1' fill='none' vector-effect='non-scaling-stroke' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-size: 100% 100%;
      background-repeat: no-repeat;
      pointer-events: none;
    }
    .cme-enclose-circle {
      display: inline-block;
      border: 1px solid currentColor;
      border-radius: 2em; /* Capsule shape guarantees no corner clipping */
      padding: 0.1em 0.6em; /* Extra horizontal padding for the semi-circle ends */
      text-align: center;
    }
    .cme-enclose-box {
      display: inline-block;
      border: 1px solid currentColor;
      padding: 0.2em 0.3em;
    }
    .cme-enclose-roundedbox {
      display: inline-block;
      border: 1px solid currentColor;
      border-radius: 0.5em;
      padding: 0.2em 0.3em;
    }
    .cme-enclose-actuarial {
      display: inline-block;
      border-top: 1px solid currentColor;
      border-right: 1px solid currentColor;
      padding-top: 0.1em;
      padding-right: 0.2em;
      margin-right: 0.1em;
    }
    .cme-vertical-strike {
      display: inline-block;
      position: relative;
    }
    .cme-vertical-strike::after {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0; right: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='50' y1='0' x2='50' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='50' y1='0' x2='50' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-horizontal-vertical-strike {
      display: inline-block;
      position: relative;
    }
    .cme-horizontal-vertical-strike::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='50' x2='100' y2='50' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3Cline x1='50' y1='0' x2='50' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='50' x2='100' y2='50' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3Cline x1='50' y1='0' x2='50' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-cancel-strike {
      display: inline-block;
      position: relative;
    }
    .cme-cancel-strike::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='100' x2='100' y2='0' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='100' x2='100' y2='0' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-down-strike {
      display: inline-block;
      position: relative;
    }
    .cme-down-strike::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='0' x2='100' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='0' x2='100' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-cross-strike {
      display: inline-block;
      position: relative;
    }
    .cme-cross-strike::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='100' x2='100' y2='0' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3Cline x1='0' y1='0' x2='100' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='100' x2='100' y2='0' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3Cline x1='0' y1='0' x2='100' y2='100' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-horizontal-strike {
      display: inline-block;
      position: relative;
    }
    .cme-horizontal-strike::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='50' x2='100' y2='50' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='50' x2='100' y2='50' stroke='black' stroke-width='2' vector-effect='non-scaling-stroke' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-long-div {
      display: inline-block;
      border-bottom: 1px solid currentColor;
      border-left: 1px solid currentColor;
      padding: 0.1em 0.2em;
      margin-left: 0.1em;
    }
    .cme-longdiv-wrapper {
      display: inline-grid !important;
      grid-template-columns: auto auto;
      grid-template-rows: auto auto;
      align-items: baseline;
      vertical-align: -0.4em;
    }
    .cme-longdiv-quotient {
      display: block !important;
      grid-column: 2;
      grid-row: 1;
      border-bottom: 1px solid currentColor;
      padding-bottom: 0.1em;
      padding-left: 0.2em;
      text-align: center;
    }
    .cme-longdiv-divisor {
      display: block !important;
      grid-column: 1;
      grid-row: 2;
      text-align: right;
      padding-right: 0.1em;
      padding-top: 0.1em;
    }
    .cme-longdiv-dividend {
      display: block !important;
      grid-column: 2;
      grid-row: 2;
      position: relative;
      padding-left: 0.4em;
      padding-top: 0.1em;
      padding-right: 0.2em;
      text-align: left;
    }
    .cme-longdiv-dividend::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 0.4em;
      height: 100%;
      background: currentColor;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 10 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 0 0 C 10 20, 10 80, 0 100' stroke='black' stroke-width='1.5' fill='none' vector-effect='non-scaling-stroke' stroke-linecap='round' /%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg preserveAspectRatio='none' viewBox='0 0 10 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 0 0 C 10 20, 10 80, 0 100' stroke='black' stroke-width='1.5' fill='none' vector-effect='non-scaling-stroke' stroke-linecap='round' /%3E%3C/svg%3E");
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      pointer-events: none;
    }
    .cme-longdiv-remainder {
      display: block !important;
      grid-column: 2;
      grid-row: 3;
      padding-left: 0.4em;
      padding-top: 0.1em;
      padding-right: 0.2em;
      text-align: left;
    }
    .cme-lshape-wrapper {
      display: inline-grid !important;
      grid-template-columns: auto auto;
      grid-template-rows: auto auto;
      align-items: baseline;
      vertical-align: middle;
    }
    .cme-lshape-div1 {
      display: block !important;
      grid-column: 1;
      grid-row: 1;
      text-align: right;
      padding-top: 0.1em;
      padding-bottom: 0.1em;
      padding-right: 0.1em;
    }
    .cme-lshape-val1 {
      display: block !important;
      grid-column: 2;
      grid-row: 1;
      border-left: 1px solid currentColor;
      border-bottom: 1px solid currentColor;
      padding-left: 0.3em;
      padding-right: 0.2em;
      padding-top: 0.1em;
      padding-bottom: 0.1em;
      text-align: left;
    }
    .cme-lshape-div2 {
      display: block !important;
      grid-column: 1;
      grid-row: 2;
      text-align: right;
      padding-top: 0.1em;
      padding-right: 0.1em;
    }
    .cme-lshape-val2 {
      display: block !important;
      grid-column: 2;
      grid-row: 2;
      padding-left: calc(0.3em + 1px);
      padding-top: 0.1em;
      text-align: left;
    }
    .cme-col-op-wrapper {
      display: inline-grid !important;
      grid-template-columns: auto auto;
      grid-template-rows: auto auto auto;
      align-items: end;
      vertical-align: middle;
    }
    .cme-col-op-val1 {
      display: block !important;
      grid-column: 2;
      grid-row: 1;
      text-align: right;
      padding-bottom: 0.1em;
    }
    .cme-col-op-op {
      display: block !important;
      grid-column: 1;
      grid-row: 2;
      text-align: right;
      border-bottom: 1px solid currentColor;
      padding-bottom: 0.1em;
      padding-right: 0.3em;
    }
    .cme-col-op-val2 {
      display: block !important;
      grid-column: 2;
      grid-row: 2;
      text-align: right;
      border-bottom: 1px solid currentColor;
      padding-bottom: 0.1em;
    }
    .cme-col-op-result {
      display: block !important;
      grid-column: 2;
      grid-row: 3;
      text-align: right;
      padding-top: 0.1em;
    }
  `;
}

function patchAllMathFields() {
  document.querySelectorAll('math-field').forEach(injectMathFieldStyles);
}

let _observer = null;

export function initMathFieldCursorFix() {
  if (_observer) return; // already initialised

  // Patch any already-existing math-fields
  patchAllMathFields();

  // Watch for new math-fields added dynamically (popups, etc.) and attribute changes
  _observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target.tagName?.toLowerCase() === 'math-field') {
        injectMathFieldStyles(mutation.target);
        continue;
      }
      if (mutation.addedNodes) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;

          // The node itself might be a math-field
          if (node.tagName?.toLowerCase() === 'math-field') {
            requestAnimationFrame(() => injectMathFieldStyles(node));
          }

          // Or it might contain math-fields deeper in the tree
          node.querySelectorAll?.('math-field')
            .forEach(mf => requestAnimationFrame(() => injectMathFieldStyles(mf)));
        }
      }
    }
  });

  _observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['read-only', 'readonly']
  });
}

export function disposeMathFieldCursorFix() {
  _observer?.disconnect();
  _observer = null;
}

