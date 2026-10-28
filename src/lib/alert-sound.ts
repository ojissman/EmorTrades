'use client'

/**
 * Alert audio + haptics — best-effort, never throws.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is NOT
 * created at page load (that would log "not allowed to start" warnings and
 * stay suspended anyway). Instead, `installAlertAudioPrimer` listens for the
 * first pointerdown anywhere and creates/unlocks the context then. If an
 * alert fires before any interaction happened, the chime silently no-ops —
 * the toast + vibration still deliver the signal.
 *
 * The chime is a short two-tone sine (A5 → D6) with a soft envelope; volume
 * is deliberately low (peak gain 0.08) since it can fire at any moment.
 */

let ctx: AudioContext | null = null
let lastPlayAt = 0

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/**
 * Install a one-shot document-level pointerdown listener that unlocks the
 * AudioContext on the first user interaction. Returns a cleanup function.
 */
export function installAlertAudioPrimer(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onFirstGesture = () => ensureCtx()
  document.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true })
  return () => document.removeEventListener('pointerdown', onFirstGesture, { capture: true })
}

/**
 * Play the alert chime. Returns true when audio was actually scheduled
 * (context running), false when it was blocked/no-op (no gesture yet).
 */
export function playAlertChime(): boolean {
  const ac = ctx ? ensureCtx() : null
  if (!ac || ac.state !== 'running') return false
  try {
    const t0 = ac.currentTime + 0.01
    const notes = [880, 1174.66] // A5, D6
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = t0 + i * 0.12
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(start)
      osc.stop(start + 0.42)
    })
    lastPlayAt = Date.now()
    return true
  } catch {
    return false
  }
}

/** Short buzz pattern for mobile devices (no-op where unsupported). */
export function vibrateAlert(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 60, 120])
    }
  } catch {
    /* unsupported — ignore */
  }
}

/** Diagnostics for QA/debugging: context presence + last successful play. */
export function alertAudioDiagnostics(): { primed: boolean; state: string | null; lastPlayAt: number } {
  return { primed: ctx !== null, state: ctx ? ctx.state : null, lastPlayAt }
}
