import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App'
import { ErrorBoundary } from './ErrorBoundary'

// Catch errors that happen before React mounts (e.g. during module loading)
window.onerror = (message, source, lineno, colno, error) => {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="min-height:100vh;background:#121417;color:#e2e8f0;padding:2rem;font-family:system-ui,sans-serif">
        <h1 style="color:#ef4444;margin-bottom:1rem">Loading Error</h1>
        <pre style="background:#1e293b;padding:1rem;border-radius:8px;overflow:auto;font-size:14px">${String(error?.message || message)}</pre>
        <p style="margin-top:1rem;font-size:14px;color:#94a3b8">Check the browser console (F12) for details.</p>
      </div>
    `
  }
  return false
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
