/**
 * Unsaved-code drafts for the coding page. Kept in sessionStorage (per browser tab, cleared when the tab closes) so code survives
 * moving between problems, switching language and refreshing, without leaving one user's code behind for the next person on a shared PC.
 * Every access is wrapped: storage can be unavailable (private mode, blocked data) and the editor must still work.
 */
const PREFIX = 'aic-draft-v1:'
const LANG_KEY = 'aic-coding-language'
export const LANGUAGES = ['cpp', 'java', 'python', 'javascript']

const defaultStore = () => { try { return window.sessionStorage } catch { return null } }
const keyFor = (problemId, language) => `${PREFIX}${problemId}:${language}`

export function loadDraft(problemId, language, store = defaultStore()) {
  try { return store ? store.getItem(keyFor(problemId, language)) : null } catch { return null }
}

/** Saves the draft, or removes it when it equals the starter template (nothing worth keeping). */
export function saveDraft(problemId, language, code, starter = '', store = defaultStore()) {
  try {
    if (!store) return false
    if (code === starter || code === '') store.removeItem(keyFor(problemId, language))
    else store.setItem(keyFor(problemId, language), code)
    return true
  } catch { return false }
}

export function clearDraft(problemId, language, store = defaultStore()) {
  try { if (store) store.removeItem(keyFor(problemId, language)) } catch { /* nothing to clear */ }
}

/** The code to show: the saved draft if there is one, otherwise the starter template. */
export function initialCode(problemId, language, starter = '', store = defaultStore()) {
  const draft = loadDraft(problemId, language, store)
  return draft != null ? draft : starter
}

export function loadLanguage(fallback = 'javascript', store = (() => { try { return window.localStorage } catch { return null } })()) {
  try { const v = store && store.getItem(LANG_KEY); return LANGUAGES.includes(v) ? v : fallback } catch { return fallback }
}
export function saveLanguage(language, store = (() => { try { return window.localStorage } catch { return null } })()) {
  try { if (store && LANGUAGES.includes(language)) store.setItem(LANG_KEY, language) } catch { /* not remembered: fine */ }
}
