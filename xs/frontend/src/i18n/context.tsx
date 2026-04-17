import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { en, type Translations } from './locales/en';
import { zh } from './locales/zh';

export type Locale = 'en' | 'zh';
export type { Translations };

const locales: Record<Locale, Translations> = { en, zh };
const LS_KEY = 'xsafeclaw:locale';

function getInitialLocale(): Locale {
  const saved = localStorage.getItem(LS_KEY);
  if (saved === 'en' || saved === 'zh') return saved;
  // Default to Chinese for first visit; users can switch language in the UI (persisted).
  return 'zh';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, _setLocale] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((l: Locale) => {
    _setLocale(l);
    localStorage.setItem(LS_KEY, l);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: locales[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
