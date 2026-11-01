import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { makeToast, toastRole, toastsReducer } from '../utils/toastState.js'

/**
 * App-wide feedback: toast notifications and an in-app confirmation dialog (replacing window.confirm).
 *   const toast = useToast();   toast.success('Saved'); toast.error('Could not save'); toast.warning(...); toast.info(...)
 *   const confirm = useConfirm(); if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return
 * Without a provider (for example in a unit test) the hooks fall back to harmless no-ops / a "cancelled" confirm, never to a native dialog.
 */
const ToastContext = createContext(null)
const ConfirmContext = createContext(null)

export function useToast() {
  return useContext(ToastContext) || { success() {}, error() {}, warning() {}, info() {}, dismiss() {} }
}
export function useConfirm() {
  return useContext(ConfirmContext) || (async () => false)
}

const ICONS = { success: '✓', error: '!', warning: '!', info: 'i' }

function ToastItem({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || !toast.durationMs) return undefined
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [paused, toast.durationMs, toast.id, onDismiss])
  return (
    <div className={`toast toast-${toast.type}`} role={toastRole(toast.type)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="toast-icon" aria-hidden="true">{ICONS[toast.type]}</span>
      <div className="toast-body">
        {toast.title && <strong className="toast-title">{toast.title}</strong>}
        <span>{toast.message}</span>
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  const previouslyFocused = useRef(null)
  const dialogRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    previouslyFocused.current = document.activeElement
    cancelRef.current?.focus() // the safe choice is focused first, so Enter never confirms a destructive action by accident
    return () => { try { previouslyFocused.current?.focus?.() } catch { /* element is gone */ } }
  }, [open])
  if (!open) return null
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel() }
    if (e.key === 'Tab' && dialogRef.current) { // keep keyboard focus inside the dialog
      const items = [...dialogRef.current.querySelectorAll('button:not([disabled])')]
      if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
  const node = (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }} onKeyDown={onKeyDown}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message" ref={dialogRef}>
        <h2 id="dialog-title" className="dialog-title">{title}</h2>
        <div id="dialog-message" className="dialog-message">{message}</div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" ref={cancelRef} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}

export function FeedbackProvider({ children }) {
  const [toasts, dispatch] = useReducer(toastsReducer, [])
  const [dialog, setDialog] = useState(null) // { options, resolve }
  const resolverRef = useRef(null)

  const dismiss = useCallback((id) => dispatch({ type: 'dismiss', id }), [])
  const toastApi = useMemo(() => {
    const add = (type) => (message, options) => dispatch({ type: 'add', toast: makeToast(type, message, options) })
    return { success: add('success'), error: add('error'), warning: add('warning'), info: add('info'), dismiss }
  }, [dismiss])

  const confirm = useCallback((options) => new Promise((resolve) => {
    if (resolverRef.current) resolverRef.current(false) // a newer question replaces an unanswered older one
    resolverRef.current = resolve
    setDialog({ options })
  }), [])
  const settle = useCallback((value) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setDialog(null)
    if (resolve) resolve(value)
  }, [])

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <ConfirmDialog open={Boolean(dialog)} {...(dialog ? dialog.options : {})} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
        <div className="toast-region" aria-label="Notifications">
          {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}
