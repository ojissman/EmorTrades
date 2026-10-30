'use client'

import { useEffect, useRef } from 'react'
import { Reveal } from './primitives'

/**
 * BRAND MOTION (LAND-1, redesigned) — the official EmorTrades loop as a small,
 * quiet, self-playing card. Purely decorative: no controls, no badge, no
 * ceremony — just a touch of the brand's motion between the hero and the
 * stats band.
 *
 * Plays automatically (muted, looped, inline) whenever it is on screen and
 * pauses itself off-screen (bandwidth). Under prefers-reduced-motion the card
 * simply shows its poster frame — honoring the visitor's OS setting with no
 * controls of any kind.
 */

const VIDEO_SRC = '/brand/emortrades-motion.mp4'
const POSTER_SRC = '/brand/emortrades-poster.jpg'

export function BrandMotion() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    const w = wrapRef.current
    if (!v || !w) return
    // Decorative element — a runtime query check is enough (no state needed).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) void v.play().catch(() => {})
          else v.pause()
        }
      },
      { threshold: 0.25 }
    )
    io.observe(w)
    return () => io.disconnect()
  }, [])

  return (
    <section aria-hidden className="relative py-8 sm:py-10">
      {/* soft ambient glow behind the card */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.09] blur-[90px]"
      />
      <Reveal className="relative mx-auto w-fit" y={16}>
        <div
          ref={wrapRef}
          className="relative aspect-video w-52 overflow-hidden rounded-xl border border-slate-800/80 bg-black shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:w-64"
        >
          <video
            ref={videoRef}
            src={VIDEO_SRC}
            poster={POSTER_SRC}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </Reveal>
    </section>
  )
}
