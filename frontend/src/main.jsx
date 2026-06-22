import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initMathFieldCursorFix } from './utils/mathFieldCursorFix.js'

// Inject cursor:pointer into MathLive shadow roots so the I-beam cursor
// never appears when hovering over read-only math-field buttons.
initMathFieldCursorFix();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
