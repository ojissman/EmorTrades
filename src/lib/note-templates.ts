/**
 * ============================================================================
 * NOTE TEMPLATES + TRADING RULES — shared localStorage store (Task 22)
 * ============================================================================
 * Device-local store for reusable note templates (Trade / Day / Misc notes)
 * and per-cadence trading rules. Previously these lived as private helpers
 * inside the settings tab — write-only decorations. Task 22 wires REAL
 * consumers:
 *
 *  - The trade modal / day-notes / misc-notes editors offer "Insert template"
 *    and auto-apply the DEFAULT template of the matching type when creating
 *    a new note (the settings tab's apply-selects drive that default).
 *  - Daily rules pre-fill the default checklist of a NEW Day Plan.
 *
 * The settings tab (Notes, Plans & Rules) remains the CRUD surface.
 */

export const NOTE_TPL_LS = 'tradesviz-settings-note-templates'

export const RULES_LS: Record<'daily' | 'weekly' | 'monthly', string> = {
  daily: 'tradesviz-settings-rules-daily',
  weekly: 'tradesviz-settings-rules-weekly',
  monthly: 'tradesviz-settings-rules-monthly',
}

export type NoteTemplateType = 'trade' | 'day' | 'misc'

export type NoteTemplate = {
  id: string
  name: string
  type: NoteTemplateType
  body: string
  isDefault: boolean
}

export const TPL_TYPE_LABEL: Record<NoteTemplateType, string> = {
  trade: 'Trade Notes',
  day: 'Day Notes',
  misc: 'Misc Notes',
}

export function readNoteTemplates(): NoteTemplate[] {
  try {
    const raw = localStorage.getItem(NOTE_TPL_LS)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (t): t is NoteTemplate =>
        !!t && typeof t === 'object' && typeof (t as NoteTemplate).id === 'string',
    )
  } catch {
    return []
  }
}

export function writeNoteTemplates(list: NoteTemplate[]): boolean {
  try {
    localStorage.setItem(NOTE_TPL_LS, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function templatesForType(type: NoteTemplateType): NoteTemplate[] {
  return readNoteTemplates().filter((t) => t.type === type)
}

export function readRules(cadence: 'daily' | 'weekly' | 'monthly'): string[] {
  try {
    const raw = localStorage.getItem(RULES_LS[cadence])
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((r): r is string => typeof r === 'string') : []
  } catch {
    return []
  }
}

/**
 * Resolve the template applied to a note type from the settings envelope's
 * `notesPlans` slice (the settings tab's apply-selects) — returns the
 * template's BODY, or null when nothing is applied / the template vanished.
 */
export function appliedTemplateBody(
  type: NoteTemplateType,
  notesPlans: Record<string, unknown> | undefined,
): string | null {
  const key =
    type === 'trade'
      ? 'applyTradeNotesTemplate'
      : type === 'day'
        ? 'applyDayNotesTemplate'
        : 'applyMiscNotesTemplate'
  const id = notesPlans?.[key]
  if (typeof id !== 'string' || !id || id === 'none') return null
  const tpl = readNoteTemplates().find((t) => t.id === id)
  return tpl && tpl.body ? tpl.body : null
}
