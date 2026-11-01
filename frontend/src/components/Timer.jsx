import { useEffect, useState } from 'react'

/** Counts up in mm:ss. Purely presentational — Phase 6 decides what the
 * elapsed time is used for (e.g. attaching it to the submitted answer). */
export default function Timer({ running = true }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [running])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <span className="mono" style={{ color: 'var(--text-300)' }}>
      {mm}:{ss}
    </span>
  )
}
