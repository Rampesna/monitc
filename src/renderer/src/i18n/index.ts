import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import tr from './locales/tr.json'
import de from './locales/de.json'
import fr from './locales/fr.json'
import es from './locales/es.json'
import it from './locales/it.json'
import ar from './locales/ar.json'

export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', rtl: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', rtl: false },
  { code: 'fr', label: 'French', nativeLabel: 'Français', rtl: false },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', rtl: false },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', rtl: false },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true }
]

const savedLang = localStorage.getItem('monitc-lang') ?? 'en'

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr }, de: { translation: de }, fr: { translation: fr }, es: { translation: es }, it: { translation: it }, ar: { translation: ar } },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export function applyLanguage(code: string): void {
  i18n.changeLanguage(code)
  localStorage.setItem('monitc-lang', code)
  const isRtl = LANGUAGES.find((l) => l.code === code)?.rtl ?? false
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  document.documentElement.lang = code
}

applyLanguage(savedLang)

export default i18n
