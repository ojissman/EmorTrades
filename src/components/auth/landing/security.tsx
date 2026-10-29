'use client'

import { motion } from 'framer-motion'
import { BadgeCheck, Bot, KeyRound, MailCheck, ScanFace } from 'lucide-react'
import { Reveal, SectionHead, GlowCard } from './primitives'
import { GoogleIcon } from '../auth-shared'

/**
 * SECURITY — showcases the hardened auth built in this very release:
 * verified sign-ups, Google one-tap, bot detection & prevention, admin
 * oversight. (Edgewonk's trust-grid pattern, adapted to real features.)
 */

const CARDS = [
  {
    icon: MailCheck,
    title: 'Verified sign-ups only',
    desc: 'Every email registration confirms its inbox with a 24-hour activation link before it can sign in. No fake accounts, no throwaway actors.',
    preview: 'envelope-check',
  },
  {
    icon: ScanFace,
    title: 'One-tap Gmail sign-in',
    desc: 'Continue with Google registers and signs you in instantly — Gmail accounts are verified by Google, so they skip the email step.',
    preview: 'google',
  },
  {
    icon: Bot,
    title: 'Bot detection & prevention',
    desc: 'Hidden honeypots, timing analysis, rate limits and disposable-email blocking stop scripted sign-ups — with Cloudflare Turnstile ready to switch on.',
    preview: 'shield',
  },
  {
    icon: KeyRound,
    title: 'Admin oversight',
    desc: 'A full audit log of every sign-up attempt, one-click suspend/verify, and runtime controls — visible in the Admin Console.',
    preview: 'audit',
  },
]

function Preview({ kind }: { kind: string }) {
  if (kind === 'envelope-check') {
    return (
      <div className="mt-5 flex items-center gap-3" aria-hidden>
        <div className="flex h-12 w-[190px] items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/50 px-3">
          <MailCheck className="h-4 w-4 text-slate-500" />
          <span className="h-2 w-16 rounded-full bg-slate-700/70" />
        </div>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 16 }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15"
        >
          <BadgeCheck className="h-5 w-5 text-emerald-400" />
        </motion.div>
        <span className="text-[10px] font-semibold text-emerald-400">verified in 1 click</span>
      </div>
    )
  }
  if (kind === 'google') {
    return (
      <div className="mt-5" aria-hidden>
        <div className="inline-flex items-center gap-2.5 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-xs font-medium text-slate-200">
          <GoogleIcon className="h-4 w-4" />
          Continue with Google
        </div>
        <p className="mt-2.5 text-[10px] text-slate-600">auto-verified · no password to leak</p>
      </div>
    )
  }
  if (kind === 'shield') {
    return (
      <div className="mt-5 space-y-2" aria-hidden>
        {['honeypot field', 'submit-timing analysis', 'rate limiting + disposable-email block'].map((m, i) => (
          <motion.div
            key={m}
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.15 }}
            className="flex items-center gap-2 text-[11px] text-slate-400"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/15">
              <Bot className="h-2.5 w-2.5 text-rose-400" />
            </span>
            {m}
            <span className="ml-auto font-semibold text-rose-400">blocked</span>
          </motion.div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-5 space-y-1.5" aria-hidden>
      {[
        { t: 'register · 41.2.x.x', ok: false, label: 'honeypot — blocked' },
        { t: 'login · demo trader', ok: true, label: 'ok' },
        { t: 'google · new user', ok: true, label: 'ok' },
      ].map((r, i) => (
        <motion.div
          key={r.t}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.14 }}
          className="flex items-center justify-between rounded-lg bg-slate-950/50 px-3 py-1.5 text-[10px]"
        >
          <span className="text-slate-400">{r.t}</span>
          <span className={r.ok ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400'}>{r.label}</span>
        </motion.div>
      ))}
    </div>
  )
}

export function Security() {
  return (
    <section
      id="security"
      aria-labelledby="security-heading"
      className="relative scroll-mt-20 overflow-hidden border-y border-slate-800/60 bg-[#080e1a] py-20 sm:py-24"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute right-1/4 top-10 h-72 w-72 rounded-full bg-emerald-500/[0.06] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="security-heading"
          eyebrow="Serious protection from day one"
          title="Sign-ups that are verified,"
          accent="bots that are not welcome"
          sub="Your trading data deserves more than a password field. EmorTrades ships with enterprise-grade account hygiene — on by default."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <GlowCard className="h-full p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-400">
                  <c.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-100">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{c.desc}</p>
                <Preview kind={c.preview} />
              </GlowCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p className="mt-8 text-center text-xs text-slate-600">
            Every public sign-up and sign-in attempt is screened and logged — reviewable anytime in the Admin Console ▸ Security.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
