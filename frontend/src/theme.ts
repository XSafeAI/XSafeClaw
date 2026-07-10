export type XSafeClawTheme = 'dark' | 'light';

export const XSAFECLAW_THEME_KEY = 'xsafeclaw:theme';
const XSAFECLAW_THEME_EVENT = 'xsafeclaw:theme-change';

export function normalizeXSafeClawTheme(value: string | null | undefined): XSafeClawTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function getStoredXSafeClawTheme(): XSafeClawTheme {
  try {
    return normalizeXSafeClawTheme(window.localStorage.getItem(XSAFECLAW_THEME_KEY));
  } catch {
    return 'dark';
  }
}

export function applyXSafeClawTheme(theme: XSafeClawTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setXSafeClawTheme(theme: XSafeClawTheme): void {
  applyXSafeClawTheme(theme);
  try {
    window.localStorage.setItem(XSAFECLAW_THEME_KEY, theme);
  } catch {
    // The visible theme still updates even if storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(XSAFECLAW_THEME_EVENT, { detail: { theme } }));
}

export function subscribeXSafeClawTheme(callback: (theme: XSafeClawTheme) => void): () => void {
  const handleThemeChange = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    callback(normalizeXSafeClawTheme(detail?.theme));
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === XSAFECLAW_THEME_KEY) {
      callback(normalizeXSafeClawTheme(event.newValue));
    }
  };

  window.addEventListener(XSAFECLAW_THEME_EVENT, handleThemeChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(XSAFECLAW_THEME_EVENT, handleThemeChange);
    window.removeEventListener('storage', handleStorage);
  };
}
