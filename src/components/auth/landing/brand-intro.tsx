'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * BRAND INTRO (AUTH-4) — the official EmorTrades motion film as a cinematic
 * first-visit moment on the landing page.
 *
 * Behavior:
 *   • plays at most ONCE per browser session (sessionStorage flag)
 *   • never for prefers-reduced-motion visitors (counted as seen)
 *   • never when landing with ?verified / ?welcome / … — someone returning
 *     from an email or Google flow wants their outcome, not a movie
 *   • auto cross-fades into the page once the logo reveal + a short hold
 *     complete (~11s); skippable any time via button or Escape
 *   • fail-open: if autoplay is blocked or the video stalls at t=0 the
 *     overlay dismisses itself — a visitor is never trapped behind it
 *
 * The decision happens in an effect (SSR renders nothing), so there is no
 * hydration mismatch and no flash for visitors who shouldn't see it.
 */

const VIDEO_SRC = '/brand/emortrades-motion.mp4'
const POSTER_SRC = '/brand/emortrades-poster.jpg'
const SESSION_KEY = 'lp-brand-intro-v1'
/** Logo fully forms ≈10s in (tunnel 0–6s, reveal 6–10s) — hold briefly, then fade. */
const DISMISS_AT_S = 11.2

type Phase = 'await' | 'playing' | 'leaving' | 'done'

export function BrandIntro() {
  const [phase, setPhase] = useState<Phase>('await')
  const [progress, setProgress] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  const dismiss = useCallback(() => {
    setPhase((p) => (p === 'playing' ? 'leaving' : p))
  }, [])

  // Decide once on mount whether this visit gets the intro.
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return
    // Returning from email-verification / Google flows — show outcomes, not cinema.
    if (window.location.search) {
      sessionStorage.setItem(SESSION_KEY, '1')
      return
    }
    sessionStorage.setItem(SESSION_KEY, '1')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Deferred a frame: the decision runs after hydration paint, so the
    // overlay never flashes for visitors who shouldn't see it.
    const raf = requestAnimationFrame(() => {
      document.documentElement.style.overflow = 'hidden'
      setPhase('playing')
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Watchdog: autoplay blocked or stalled → never trap the visitor.
  useEffect(() => {
    if (phase !== 'playing') return
    const t = setTimeout(() => {
      const v = videoRef.current
      if (!v || v.currentTime < 0.05) dismiss()
    }, 2600)
    return () => clearTimeout(t)
  }, [phase, dismiss])

  // Escape skips.
  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, dismiss])

  if (phase === 'await' || phase === 'done') return null

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-[#050a14]"
      initial={{ opacity: 1, scale: 1 }}
      animate={phase === 'leaving' ? { opacity: 0, scale: 1.035 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        if (phase === 'leaving') {
          document.documentElement.style.overflow = ''
          setPhase('done')
        }
      }}
      role="dialog"
      aria-label="EmorTrades brand intro film"
    >
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        autoPlay
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setProgress(Math.min(1, v.currentTime / DISMISS_AT_S))
          if (v.currentTime >= DISMISS_AT_S) dismiss()
        }}
        onEnded={dismiss}
        onError={dismiss}
      />

      {/* vignette + bottom fade so the skip control always reads */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/75 to-transparent" />
        <div className="absolute inset-0 [box-shadow:inset_0_0_180px_rgba(0,0,0,0.5)]" />
      </div>

      {/* skip */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute bottom-7 right-5 sm:bottom-9 sm:right-8 rounded-full border border-slate-600/60 bg-black/40 px-4 py-2 text-xs font-semibold tracking-wide text-slate-300 backdrop-blur transition-colors hover:border-emerald-400/60 hover:text-white min-h-[40px]"
      >
        Skip intro <span className="ml-1.5 hidden text-slate-500 sm:inline">Esc</span>
      </button>

      {/* thin progress line — cinema feel, honest duration */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10" aria-hidden>
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-200 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </motion.div>
  )
}
