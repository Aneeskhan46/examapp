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

