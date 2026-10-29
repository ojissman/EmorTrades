'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Reveal, SectionHead } from './primitives'

/**
 * BRAND MOTION (AUTH-4) — the institute band. The official EmorTrades motion
 * loop (tunnel → logo reveal → orbital hold) in a cinematic viewfinder frame,
 * right below the hero.
 *
 * The video autoplays muted+looped only while on screen (IntersectionObserver)
 * and never autoplays under prefers-reduced-motion — those visitors get the
 * poster frame plus an explicit play control (user-initiated motion is fine).
 */

const VIDEO_SRC = '/brand/emortrades-motion.mp4'
const POSTER_SRC = '/brand/emortrades-poster.jpg'

function Corner({ className }: { className: string }) {
  return <span aria-hidden className={cn('pointer-events-none absolute h-7 w-7 border-emerald-400/70', className)} />
}

export function BrandMotion() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const reduceMotion = useReducedMotion()
  const reduce = reduceMotion ?? false
  const [manualPaused, setManualPaused] = useState(true)

  useEffect(() => {
    // Wait for the media-query snapshot to resolve; never autoplay under
    // prefers-reduced-motion — those visitors get the poster + play control.
    if (reduceMotion === null || reduceMotion) return
    const v = videoRef.current
    const w = wrapRef.current
    if (!v || !w) return
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
  }, [reduceMotion])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play().catch(() => {})
      setManualPaused(false)
    } else {
      v.pause()
      setManualPaused(true)
    }
  }

  return (
    <section aria-labelledby="institute-heading" className="relative overflow-hidden py-16 sm:py-20">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.07] blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="institute-heading"
          eyebrow="The Institute of Trading"
          title="An institute,"
          accent="not just an app."
          sub="EmorTrades holds you to the institute standard — every execution journaled, every pattern surfaced, every edge documented. This is the mark, in motion."
        />

        <Reveal delay={0.15} className="mt-10 sm:mt-12">
          <div ref={wrapRef} className="relative">
            {/* glow under the frame */}
            <div
              className="absolute -inset-x-8 -top-8 bottom-12 rounded-[44px] bg-emerald-500/[0.10] blur-3xl"
              aria-hidden
            />

            {/* cinematic frame */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-black shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]">
              <div className="relative aspect-video">
                <video
                  ref={videoRef}
                  src={VIDEO_SRC}
                  poster={POSTER_SRC}
                  muted
                  loop
                  playsInline
                  preload="none"
                  className="absolute inset-0 h-full w-full object-cover"
                  aria-label="EmorTrades institute brand film — the logo forming through a digital trading tunnel"
                />

                {/* viewfinder corners */}
                <Corner className="left-3.5 top-3.5 border-l-2 border-t-2" />
                <Corner className="right-3.5 top-3.5 border-r-2 border-t-2" />
                <Corner className="bottom-3.5 left-3.5 border-b-2 border-l-2" />
                <Corner className="bottom-3.5 right-3.5 border-b-2 border-r-2" />

                {/* live badge */}
                <div className="absolute left-6 top-5 flex items-center gap-2 rounded-full border border-emerald-400/25 bg-black/45 px-3 py-1 backdrop-blur">
                  <span className="relative flex h-1.5 w-1.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200/90">
                    Institute mark · live loop
                  </span>
                </div>

                {/* reduced-motion: explicit play control (user-initiated) */}
                {reduce && (
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={manualPaused ? 'Play the brand film' : 'Pause the brand film'}
                    className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors hover:bg-black/25"
                  >
                    <span className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-black/60 backdrop-blur">
                      <Play className={cn('h-6 w-6 text-emerald-300', !manualPaused && 'hidden')} aria-hidden />
                      {manualPaused ? null : <span className="text-xs font-semibold text-emerald-200">Pause</span>}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* caption row */}
            <div className="mt-4 flex flex-col items-start justify-between gap-1.5 px-1 sm:flex-row sm:items-center">
              <p className="text-xs text-slate-500">
                The official EmorTrades motion loop — the institute badge, rendered live.
              </p>
              <p className="text-xs text-slate-600">28s · plays silently</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
