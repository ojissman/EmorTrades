// Evidence tags — shared vocabulary for tagging per-trade evidence files
// (screenshots / video / audio) with WHERE in the trade lifecycle they belong.
// The user asked for exactly this control: "if I attached a screenshot I
// should be able to tag it e.g. Before Entry or After Entry or anything else".
//
// Used by BOTH surfaces that edit evidence metadata:
//   - TradeEvidence (the per-trade Evidence card, /explore/trade-explore)
//   - LibraryPage (the standalone library lightbox editor)
// so the preset list, custom-tag handling and badge styling stay identical.

/** Quick-pick presets — the trade lifecycle, in order. */
export const EVIDENCE_TAG_PRESETS = [
  'Before Entry',
  'Entry',
  'After Entry',
  'Management',
  'Exit',
  'Review',
] as const

export type EvidenceTagPreset = (typeof EVIDENCE_TAG_PRESETS)[number]

/** Max length for a custom tag — tags are short labels, not captions. */
export const EVIDENCE_TAG_MAX = 24

/** Deterministic tone for a tag chip. Presets get a fixed color; custom tags
 *  hash their text into the same palette so the same tag always looks the
 *  same. Chips are translucent so they read on both light and dark themes. */
const PRESET_TONES: Record<string, string> = {
  'Before Entry': 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  Entry: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'After Entry': 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Management: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  Exit: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  Review: 'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
}

const CUSTOM_TONES = [
  'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400',
]

export function evidenceTagTone(tag: string): string {
  const preset = PRESET_TONES[tag]
  if (preset) return preset
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return CUSTOM_TONES[h % CUSTOM_TONES.length]
}

/** Clamp/normalize a tag being saved: trim, collapse spaces, cap length.
 *  Returns null when the result is empty (meaning "clear the tag"). */
export function normalizeEvidenceTag(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_TAG_MAX)
  return t || null
}
