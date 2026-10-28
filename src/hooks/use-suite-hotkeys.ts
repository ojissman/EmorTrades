'use client'

/**
 * ============================================================================
 * SUITE HOTKEYS — keyboard-first tab switching for the two-level suite pages
 * ============================================================================
 * AI Suite and Trading Profile share the same two-level tab grammar, so they
 * share the same keyboard model:
 *
 *   • Plain digit 1..9  → switch to that TOP tab.
 *   • Shift + digit 1..9 → switch to that SUB-section of the ACTIVE tab
 *     (only when the active tab owns a sub row).
 *
 * The visible affordances (Task 78) teach the pattern: a tiny number chip on
 * every top trigger, and the ←/→ "switch" chips on the sub-tab rows (Task 77,
 * Radix roving tabindex).
 *
 * Guards — hotkeys NEVER fire when:
 *   • the event was already handled (defaultPrevented),
 *   • a browser/app modifier combo is held (ctrl / meta / alt),
 *   • focus sits in an editable element (input / textarea / select /
 *     contentEditable) — digits must type, not navigate,
 *   • a floating surface is open (Radix dialog / sheet / popover →
 *     role="dialog", menus → role="menu", selects → role="listbox").
 *
 * Implementation note: the listener is subscribed ONCE and reads the latest
 * options through a ref, so pages can pass freshly-rendered id arrays and
 * closures without resubscribing every render.
 */

import { useEffect, useRef } from 'react'

/** Physical digit key (top row or keypad) → 0-based index. Layout-independent. */
function digitIndex(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code)
  return m ? Number(m[1]) - 1 : null
}

function inEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Any open floating surface that owns the keyboard right now. */
function floatingSurfaceOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

export function useSuiteHotkeys({
  topIds,
  onSelectTop,
  subIds = [],
  onSelectSub,
}: {
  topIds: string[]
  onSelectTop: (id: string) => void
  /** Sub ids of the ACTIVE top tab (empty when the tab has no sub row). */
  subIds?: string[]
  onSelectSub?: (id: string) => void
}) {
  // Latest-options ref: the handler always sees this render's ids/closures.
  // Synced in an effect (never during render) per react-hooks/refs.
  const latest = useRef({ topIds, onSelectTop, subIds, onSelectSub })
  useEffect(() => {
    latest.current = { topIds, onSelectTop, subIds, onSelectSub }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (inEditable(e.target)) return
      if (floatingSurfaceOpen()) return

      const idx = digitIndex(e.code)
      if (idx === null) return

      const opts = latest.current
      if (e.shiftKey) {
        const id = opts.subIds[idx]
        if (id && opts.onSelectSub) {
          e.preventDefault()
          opts.onSelectSub(id)
        }
        return
      }
      const id = opts.topIds[idx]
      if (id) {
        e.preventDefault()
        opts.onSelectTop(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
