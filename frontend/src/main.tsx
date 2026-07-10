import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { I18nProvider } from './i18n'
import { applyXSafeClawTheme, getStoredXSafeClawTheme } from './theme'

// Apply saved theme immediately to avoid flash-of-wrong-theme
applyXSafeClawTheme(getStoredXSafeClawTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
