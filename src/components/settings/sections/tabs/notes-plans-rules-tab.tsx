'use client'

/**
 * Global Account Settings ▸ `Notes, Plans & Rules` sub-tab.
 *
 * Cards: `Templates & Plans` (Note Templates apply-selects + `Manage
 * Custom Note Templates` dialog), `Trade & Day Plans` (deep links to the REAL
 * /trading-plans pages), `Trading Rules` (per-cadence Manage dialogs), `Goals`
 * (deep link to the REAL trading-goals page).
 *
 * Honest scope: no server-side template/rule backend — both live in
 * localStorage (shared helpers in lib/note-templates.ts). Task 22 wired REAL
 * consumers: the apply-selects drive the editors (the trade modal, day notes
 * and misc notes auto-apply the default template on new notes and offer
 * "Insert template"), and daily rules pre-fill new Day Plan checklists.
 */

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useUserSettings, usePatchSettings, settingsSlice } from '@/hooks/use-user-settings'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { SectionCard } from '@/components/settings/section-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  RULES_LS,
  type NoteTemplate,
  type NoteTemplateType,
  TPL_TYPE_LABEL,
  readNoteTemplates,
  writeNoteTemplates,
  readRules,
} from '@/lib/note-templates'

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/** Label-left / controls-right row used by the plan, rule and goal lines. */
function ActionRow({
  label,
  testId,
  children,
}: {
  label: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={testId}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function RowDivider() {
  return <div className="h-px w-full" style={{ background: 'var(--border-strong)' }} />
}

/**
 * `Manage Custom Note Templates` dialog (L2 verbatim title/fields/buttons:
 * `Note Template Name` · `Note Template Type` · `Set as default template?` ·
 * `Note Template` · `Create New` / `Save` / `Delete`). Mounted only while open
 * so the draft re-initializes from the target template without effects.
 */
function NoteTemplatesDialog({
  editingId,
  prefillType,
  onSaved,
  onClose,
}: {
  editingId: string | null
  prefillType: NoteTemplateType
  onSaved: () => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const templates = useMemo(() => readNoteTemplates(), [])
  const [draft, setDraft] = useState<NoteTemplate>(() => {
    const existing = editingId ? templates.find((t) => t.id === editingId) : undefined
    return existing ?? { id: '', name: '', type: prefillType, body: '', isDefault: false }
  })

  function save() {
    const name = draft.name.trim()
    if (!name) {
      toast({ title: 'Note Template Name is required', variant: 'destructive' })
      return
    }
    const next: NoteTemplate = { ...draft, name }
    const id = draft.id || `nt-${Date.now()}`
    // Enforce one default per type — a new default clears the previous one.
    let list = readNoteTemplates().map((t) =>
      next.isDefault && t.type === next.type && t.id !== id ? { ...t, isDefault: false } : t,
    )
    list = next.id ? list.map((t) => (t.id === id ? { ...next, id } : t)) : [...list, { ...next, id }]
    if (!writeNoteTemplates(list)) {
      toast({ title: 'Failed to save template', variant: 'destructive' })
      return
    }
    toast({ title: 'Template saved' })
    onSaved()
    onClose()
  }

  function remove() {
    if (!draft.id) {
      toast({ title: 'Nothing to delete — create the template first', variant: 'destructive' })
      return
    }
    const list = readNoteTemplates().filter((t) => t.id !== draft.id)
    if (!writeNoteTemplates(list)) {
      toast({ title: 'Failed to delete template', variant: 'destructive' })
      return
    }
    toast({ title: 'Template deleted' })
    onSaved()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Custom Note Templates</DialogTitle>
        </DialogHeader>

        {/* Saved templates list — click a row to edit it */}
        <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {templates.length === 0 ? (
            <p className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No custom templates yet — fill the fields below and press Save.
            </p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDraft(t)}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              >
                <span className="truncate font-medium">{t.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {t.isDefault ? (
                    <Badge variant="outline" className="text-[10px]">
                      default
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className="text-[10px]">
                    {TPL_TYPE_LABEL[t.type] ?? t.type}
                  </Badge>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="note-tpl-name" className="mb-1.5 block text-[13px]">
              Note Template Name
            </Label>
            <Input
              id="note-tpl-name"
              value={draft.name}
              placeholder="Note Template Name"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[13px]">Note Template Type</Label>
            <Select
              value={draft.type}
              onValueChange={(v) => setDraft((d) => ({ ...d, type: v as NoteTemplateType }))}
            >
              <SelectTrigger aria-label="Note Template Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trade">Trade Notes</SelectItem>
                <SelectItem value="day">Day Notes</SelectItem>
                <SelectItem value="misc">Misc Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="note-tpl-default"
            checked={draft.isDefault}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, isDefault: v === true }))}
          />
          <Label htmlFor="note-tpl-default" className="text-[13px]">
            Set as default template?
          </Label>
        </div>

        <div>
          <Label htmlFor="note-tpl-body" className="mb-1.5 block text-[13px]">
            Note Template
          </Label>
          <Textarea
            id="note-tpl-body"
            rows={6}
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="Type the template text applied when writing notes…"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setDraft({ id: '', name: '', type: prefillType, body: '', isDefault: false })}>
            Create New
          </Button>
          {draft.id ? (
            <Button variant="destructive" onClick={remove}>
              Delete
            </Button>
          ) : null}
          <Button onClick={save}>Save</Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Per-cadence Trading Rules dialog — array-of-strings CRUD in localStorage. */
function RulesDialog({
  cadence,
  onSaved,
  onClose,
}: {
  cadence: 'daily'
  onSaved: () => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const [rules, setRules] = useState<string[]>(() => readRules(cadence))
  const [draftRule, setDraftRule] = useState('')

  function addRule() {
    const r = draftRule.trim()
    if (!r) return
    setRules((list) => (list.includes(r) ? list : [...list, r]))
    setDraftRule('')
  }

  function save() {
    try {
      localStorage.setItem(RULES_LS[cadence], JSON.stringify(rules))
      toast({
        title: `${cadence[0].toUpperCase()}${cadence.slice(1)} rules saved`,
        description: cadence === 'daily' ? 'New day plans pre-fill these as their default checklist.' : undefined,
      })
      onSaved()
      onClose()
    } catch {
      toast({ title: 'Failed to save rules', variant: 'destructive' })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cadence[0].toUpperCase() + cadence.slice(1)} Rules (Manage)</DialogTitle>
        </DialogHeader>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          New day plans pre-fill these rules as their default checklist.
        </p>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {rules.length === 0 ? (
            <p className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No rules yet.
            </p>
          ) : (
            rules.map((r) => (
              <div
                key={r}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
              >
                <span className="truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                  {r}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove rule ${r}`}
                  onClick={() => setRules((list) => list.filter((x) => x !== r))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={draftRule}
            placeholder="Add a rule…"
            onChange={(e) => setDraftRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addRule()
              }
            }}
          />
          <Button variant="outline" onClick={addRule}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button onClick={save}>Save</Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NotesPlansRulesTab() {
  const navigate = useAppStore((s) => s.navigate)
  const { data: row } = useUserSettings()
  const patch = usePatchSettings()
  const { toast } = useToast()

  // Bumped when a dialog saves so the localStorage-backed lists re-read.
  const [tplVersion, setTplVersion] = useState(0)
  const [tplDialog, setTplDialog] = useState<{ open: boolean; editingId: string | null; prefillType: NoteTemplateType }>({
    open: false,
    editingId: null,
    prefillType: 'trade',
  })
  const [rulesCadence, setRulesCadence] = useState<'daily' | null>(null)

  const templates = useMemo(() => readNoteTemplates(), [tplVersion])
  const notesPlans = settingsSlice(row, 'notesPlans')
  const applyTrade = str(notesPlans.applyTradeNotesTemplate, 'none')
  const applyDay = str(notesPlans.applyDayNotesTemplate, 'none')
  const applyMisc = str(notesPlans.applyMiscNotesTemplate, 'none')

  async function saveApply(key: string, value: string) {
    try {
      await patch({ data: { notesPlans: { ...notesPlans, [key]: value } } })
      toast({ title: 'Settings saved' })
    } catch {
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    }
  }

  /** Select + `Edit Template` pair for one note-type row (L2 verbatim label). */
  function applyRow(
    label: string,
    type: NoteTemplateType,
    value: string,
    persistKey: string,
    testId: string,
  ) {
    const options = templates.filter((t) => t.type === type)
    return (
      <>
        <ActionRow label={label} testId={testId}>
          <Select value={value} onValueChange={(v) => saveApply(persistKey, v)}>
            <SelectTrigger className="w-56" aria-label={label}>
              <SelectValue placeholder="Don't apply" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Don&apos;t apply</SelectItem>
              {options.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setTplDialog({
                open: true,
                editingId: value !== 'none' ? value : null,
                prefillType: type,
              })
            }
          >
            Edit Template
          </Button>
        </ActionRow>
        <RowDivider />
      </>
    )
  }

  return (
    <div className="space-y-4" data-testid="settings-tab-content-notes-plans-rules">
      {/* Templates & Plans (L1 §4.4 + L2 note-templates dialog) */}
      <SectionCard title="Templates & Plans" testId="npr-templates-plans">
        <h4 className="mb-1 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Note Templates
        </h4>
        {applyRow('Apply Trade Notes Template?', 'trade', applyTrade, 'applyTradeNotesTemplate', 'npr-apply-trade-template')}
        {applyRow('Apply Day Notes Template?', 'day', applyDay, 'applyDayNotesTemplate', 'npr-apply-day-template')}
        {applyRow('Apply Misc Notes Template?', 'misc', applyMisc, 'applyMiscNotesTemplate', 'npr-apply-misc-template')}

        <div
          className="mt-3 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Manage Custom Note Templates
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Templates you create appear in the trade modal and the day/misc note editors — and the
              applied default pre-fills new notes of that type.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setTplDialog({ open: true, editingId: null, prefillType: 'trade' })}
          >
            Manage
          </Button>
        </div>
      </SectionCard>

      {/* Trade & Day Plans — REAL app pages (L1 §4.4) */}
      <SectionCard title="Trade & Day Plans" testId="npr-plans">
        <ActionRow label="Trade Plans" testId="npr-trade-plans">
          <Button variant="outline" size="sm" onClick={() => navigate('/trading-plans/trade-plans')}>
            Manage
          </Button>
        </ActionRow>
        <RowDivider />
        <ActionRow label="Day Plans" testId="npr-day-plans">
          <Button variant="outline" size="sm" onClick={() => navigate('/trading-plans/day-plans')}>
            Manage
          </Button>
        </ActionRow>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Learn more about plans and checklists
        </p>
      </SectionCard>

      {/* Trading Rules — the day-plan prefill list (localStorage is its honest
          home: it is exactly a local template). TP2: weekly and monthly rules
          live in the TRADING PLAN content now, surfaced by the review pages. */}
      <SectionCard title="Trading Rules" testId="npr-rules">
        <ActionRow label="Daily Rules (Manage)" testId="npr-rules-daily">
          <Button variant="outline" size="sm" onClick={() => setRulesCadence('daily')}>
            Manage
          </Button>
        </ActionRow>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Daily rules pre-fill the default checklist of NEW day plans. Weekly and monthly rules
          belong to your trading plan — set them in the plan editor and every review reads them.
        </p>
      </SectionCard>

      {/* Goals (L2 adds this block) — REAL app page */}
      <SectionCard title="Goals" testId="npr-goals">
        {(['Daily', 'Weekly', 'Monthly'] as const).map((label, i) => (
          <div key={label}>
            {i > 0 ? <RowDivider /> : null}
            <ActionRow label={`${label} Goals`} testId={`npr-goals-${label.toLowerCase()}`}>
              <Button variant="outline" size="sm" onClick={() => navigate('/trading-plans/trading-goals')}>
                Manage
              </Button>
            </ActionRow>
          </div>
        ))}
      </SectionCard>

      {tplDialog.open ? (
        <NoteTemplatesDialog
          editingId={tplDialog.editingId}
          prefillType={tplDialog.prefillType}
          onSaved={() => setTplVersion((v) => v + 1)}
          onClose={() => setTplDialog((d) => ({ ...d, open: false }))}
        />
      ) : null}
      {rulesCadence ? (
        <RulesDialog
          cadence={rulesCadence}
          onSaved={() => setTplVersion((v) => v + 1)}
          onClose={() => setRulesCadence(null)}
        />
      ) : null}
    </div>
  )
}
