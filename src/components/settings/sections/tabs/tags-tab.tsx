'use client'

/**
 * ============================================================================
 * Global Account Settings ▸ `Tags` sub-tab — FULLY SERVER-BACKED (Task 22-e).
 * ============================================================================
 * Verbatim cards: `Tag Management` (`Add Tags`/`Remove Tags`/`Rename Tags`
 * dialogs with the verbatim comma helpers), `Trade Tag Groups` and `Day Tag
 * Groups` (`Manage Groups` → verbatim dialog titles, `Ungrouped`/`Grouped`
 * columns, `Add New Group`).
 *
 * REAL wiring — every action hits a real API and the result is what the
 * tags-analysis pages read back:
 *  - /api/tags      → GET / POST / PATCH / DELETE (tags + TagGroups)
 *  - /api/day-tags  → GET / POST / PATCH / DELETE (day tags + DayTagGroups)
 * Groups created/edited here are exactly the groups the Tags-analysis
 * group views group by — "group-wise analysis" is real end-to-end.
 * No localStorage anywhere: the old local group/assignment maps were
 * write-only (nothing consumed them) and were removed.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { SectionCard } from '@/components/settings/section-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

type TagRow = { id: string; name: string; color: string; groupId: string | null }
type GroupRow = { id: string; name: string; color: string }
type TagType = 'trade' | 'day'

const COMMA_HELPER_ADD =
  "Please add a comma (',') after every tag. Example: gapup, highvol, etc., (even if you are entering only a single tag, you need to add a comma at the end)"
const COMMA_HELPER_REMOVE =
  "Please add a comma (',') after every tag. Example: gapup, highvol, SPX%, etc., (even if you are entering only a single tag, you need to add a comma at the end)"

function parseTagList(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** L2: "Wildcard delete is supported with %" — SPX% removes tags starting with SPX. */
function matchesPattern(name: string, pattern: string): boolean {
  const n = name.toLowerCase()
  const p = pattern.toLowerCase()
  return p.endsWith('%') ? n.startsWith(p.slice(0, -1)) : n === p
}

/** The two mutation endpoints, by tag type. */
const API = {
  trade: '/api/tags',
  day: '/api/day-tags',
} as const

/** Label + bordered block with a right-aligned action button (L2 card rows). */
function TagActionBlock({
  label,
  buttonLabel,
  onClick,
  testId,
  accent,
}: {
  label: string
  buttonLabel: string
  onClick: () => void
  testId: string
  accent?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border p-3"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
      data-testid={testId}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </p>
      <Button
        size="sm"
        onClick={onClick}
        className={accent ? 'bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]' : undefined}
      >
        {buttonLabel}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Add Tags dialog — REAL create + REAL replace (Task 22-e)            */
/* ------------------------------------------------------------------ */
function AddTagsDialog({
  existingTags,
  onClose,
}: {
  existingTags: TagRow[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [opType, setOpType] = useState<'replace' | 'append'>('append')
  const [busy, setBusy] = useState(false)

  async function save() {
    const tags = parseTagList(text)
    if (tags.length === 0) {
      toast({ title: 'Enter at least one tag (comma-terminated)', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const existing = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))
      const toCreate = tags.filter((t) => !existing.has(t.toLowerCase()))
      let created = 0
      let failed = 0
      for (const name of toCreate) {
        const res = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (res.ok) created += 1
        else failed += 1
      }
      // Replace is REAL now: every existing tag absent from the new list is
      // deleted (its trade links cascade away), exactly what the option's
      // note promises.
      let removed = 0
      let removeFailed = 0
      if (opType === 'replace') {
        const keep = new Set(tags.map((t) => t.toLowerCase()))
        for (const t of existingTags) {
          if (keep.has(t.name.toLowerCase())) continue
          const res = await fetch(`/api/tags?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' })
          if (res.ok) removed += 1
          else removeFailed += 1
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['tags'] })
      await queryClient.invalidateQueries({ queryKey: ['trades'] })
      const skipped = tags.length - toCreate.length
      const bits: string[] = []
      if (created > 0) bits.push(`${created} created`)
      if (skipped > 0) bits.push(`${skipped} already existed`)
      if (removed > 0) bits.push(`${removed} removed (replace)`)
      if (failed > 0 || removeFailed > 0) bits.push(`${failed + removeFailed} failed`)
      toast({
        title: `Added ${created} tag${created === 1 ? '' : 's'}`,
        description: bits.length > 0 ? `${bits.join(' · ')}.` : undefined,
        variant: failed + removeFailed > 0 ? 'destructive' : undefined,
      })
      onClose()
    } catch {
      toast({ title: 'Failed to add tags', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Tags</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="add-tags-text" className="mb-1.5 block text-[13px]">
            Tags to Add
          </Label>
          <Textarea id="add-tags-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {COMMA_HELPER_ADD}
          </p>
        </div>
        <div>
          <Label className="mb-2 block text-[13px]">Operation Type</Label>
          <RadioGroup value={opType} onValueChange={(v) => setOpType(v as 'replace' | 'append')} className="gap-2">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="replace" id="op-replace" className="mt-0.5" />
              <div>
                <Label htmlFor="op-replace" className="text-[13px]">
                  Replace existing list
                </Label>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Note: The list of tags already in TAGLIST trade will be replaced by the above tags — existing tags
                  missing from your new list are deleted (their trade links are removed too).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="append" id="op-append" className="mt-0.5" />
              <div>
                <Label htmlFor="op-append" className="text-[13px]">
                  Append/Add to existing list
                </Label>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Note: tags entered above will be added to the list of tags in the TAGLIST trade
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Tags become available app-wide once created; they can be attached to trades from the table and
          explore pages.
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={save}
            disabled={busy}
            className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Remove Tags dialog — REAL for both trade and day tags               */
/* ------------------------------------------------------------------ */
function RemoveTagsDialog({
  tradeTags,
  dayTags,
  onClose,
}: {
  tradeTags: TagRow[]
  dayTags: TagRow[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [tagType, setTagType] = useState<TagType>('trade')
  const [busy, setBusy] = useState(false)

  async function save() {
    const patterns = parseTagList(text)
    if (patterns.length === 0) {
      toast({ title: 'Enter at least one tag (comma-terminated)', variant: 'destructive' })
      return
    }
    const list = tagType === 'trade' ? tradeTags : dayTags
    const matches = list.filter((t) => patterns.some((p) => matchesPattern(t.name, p)))
    if (matches.length === 0) {
      toast({ title: 'No matching tags found', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      let removed = 0
      let failed = 0
      for (const tag of matches) {
        const res = await fetch(`${API[tagType]}?id=${encodeURIComponent(tag.id)}`, { method: 'DELETE' })
        if (res.ok) removed += 1
        else failed += 1
      }
      await queryClient.invalidateQueries({ queryKey: [tagType === 'trade' ? 'tags' : 'day-tags'] })
      await queryClient.invalidateQueries({ queryKey: ['trades'] })
      toast({
        title: `Removed ${removed} ${tagType} tag${removed === 1 ? '' : 's'}`,
        description: failed > 0 ? `${failed} failed.` : undefined,
        variant: failed > 0 ? 'destructive' : undefined,
      })
      onClose()
    } catch {
      toast({ title: 'Failed to remove tags', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Remove Tags</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="remove-tags-text" className="mb-1.5 block text-[13px]">
            Tags to Remove
          </Label>
          <Textarea id="remove-tags-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {COMMA_HELPER_REMOVE}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Wildcard delete is supported with <span className="font-semibold">%</span>. Example:{' '}
            <span className="font-semibold">SPX%</span> removes tags that start with SPX. Deleting a tag also removes
            it from every trade it was attached to.
          </p>
        </div>
        <div>
          <Label className="mb-2 block text-[13px]">Tag Type</Label>
          <RadioGroup value={tagType} onValueChange={(v) => setTagType(v as TagType)} className="flex-row gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="trade" id="remove-type-trade" />
              <Label htmlFor="remove-type-trade" className="text-[13px]">
                Trade
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="day" id="remove-type-day" />
              <Label htmlFor="remove-type-day" className="text-[13px]">
                Day
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={busy} variant="destructive">
            {busy ? 'Removing…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Rename Tags dialog — REAL in-place PATCH for both tag types         */
/* ------------------------------------------------------------------ */
function RenameTagsDialog({
  tradeTags,
  dayTags,
  onClose,
}: {
  tradeTags: TagRow[]
  dayTags: TagRow[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [oldText, setOldText] = useState('')
  const [newText, setNewText] = useState('')
  const [tagType, setTagType] = useState<TagType>('trade')
  const [busy, setBusy] = useState(false)

  async function save() {
    const olds = parseTagList(oldText)
    const news = parseTagList(newText)
    if (olds.length === 0 || news.length === 0) {
      toast({ title: 'Enter tags in both boxes (comma-terminated)', variant: 'destructive' })
      return
    }
    if (olds.length !== news.length) {
      toast({ title: 'Tag counts do not match between the two boxes', variant: 'destructive' })
      return
    }
    const list = tagType === 'trade' ? tradeTags : dayTags
    setBusy(true)
    try {
      let renamed = 0
      let failed = 0
      for (let i = 0; i < olds.length; i++) {
        const oldTag = list.find((t) => t.name.toLowerCase() === olds[i].toLowerCase())
        if (!oldTag) {
          failed += 1
          continue
        }
        // In-place PATCH keeps the id, so every trade/day link survives the
        // rename (the Task 16-c rule).
        const res = await fetch(API[tagType], {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: oldTag.id, name: news[i], color: oldTag.color, groupId: oldTag.groupId }),
        })
        if (res.ok) renamed += 1
        else failed += 1
      }
      await queryClient.invalidateQueries({ queryKey: [tagType === 'trade' ? 'tags' : 'day-tags'] })
      await queryClient.invalidateQueries({ queryKey: ['trades'] })
      toast({
        title: `Renamed ${renamed} ${tagType} tag${renamed === 1 ? '' : 's'}`,
        description: failed > 0 ? `${failed} failed (not found or rejected).` : undefined,
        variant: failed > 0 ? 'destructive' : undefined,
      })
      onClose()
    } catch {
      toast({ title: 'Failed to rename tags', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rename Tags</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="rename-old" className="mb-1.5 block text-[13px]">
            Tags to Rename
          </Label>
          <Textarea id="rename-old" rows={2} value={oldText} onChange={(e) => setOldText(e.target.value)} />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {COMMA_HELPER_ADD}
          </p>
        </div>
        <div>
          <Label htmlFor="rename-new" className="mb-1.5 block text-[13px]">
            New tag names
          </Label>
          <Textarea id="rename-new" rows={2} value={newText} onChange={(e) => setNewText(e.target.value)} />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {COMMA_HELPER_ADD}
          </p>
        </div>
        <div>
          <Label className="mb-2 block text-[13px]">Tag Type</Label>
          <RadioGroup value={tagType} onValueChange={(v) => setTagType(v as TagType)} className="flex-row gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="trade" id="rename-type-trade" />
              <Label htmlFor="rename-type-trade" className="text-[13px]">
                Trade
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="day" id="rename-type-day" />
              <Label htmlFor="rename-type-day" className="text-[13px]">
                Day
              </Label>
            </div>
          </RadioGroup>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Renames run as in-place updates, so trades and days keep their tag links.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Renaming…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Tag Groups Management dialog — server-backed for BOTH tag types     */
/* ------------------------------------------------------------------ */
function TagGroupsDialog({
  title,
  ungroupedLabel,
  groupedLabel,
  tags,
  groups,
  tagType,
  onClose,
}: {
  title: string
  ungroupedLabel: string
  groupedLabel: string
  tags: TagRow[]
  groups: GroupRow[]
  tagType: TagType
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState(tagType === 'trade' ? '#64748b' : '#f59e0b')
  const [busy, setBusy] = useState(false)

  const qKey = tagType === 'trade' ? 'tags' : 'day-tags'

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: [qKey] })
  }

  /** Every mutation hits the real API immediately; react-query refetches the
   *  dialog state. A "Failed" toast names the action that did not land. */
  async function run(action: string, fn: () => Promise<Response>) {
    setBusy(true)
    try {
      const res = await fn()
      if (!res.ok) throw new Error()
      await refresh()
    } catch {
      toast({ title: `Failed to ${action}`, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function addGroup() {
    const name = newGroupName.trim()
    if (!name) {
      toast({ title: 'Enter a group name first', variant: 'destructive' })
      return
    }
    await run('create the group', () =>
      fetch(API[tagType], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', name, color: newGroupColor }),
      }),
    )
    setNewGroupName('')
  }

  async function renameGroup(g: GroupRow, name: string, color: string) {
    if (!name.trim()) {
      toast({ title: 'Group name cannot be empty', variant: 'destructive' })
      return
    }
    await run('rename the group', () =>
      fetch(API[tagType], {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', id: g.id, name: name.trim(), color }),
      }),
    )
  }

  async function deleteGroup(g: GroupRow) {
    // L2 verbatim note: deleting a group does NOT delete tags — it ungroups them.
    await run('delete the group', () =>
      fetch(`${API[tagType]}?id=${encodeURIComponent(g.id)}&kind=group`, { method: 'DELETE' }),
    )
  }

  async function assignTag(t: TagRow, groupId: string) {
    // groupId '' means Ungrouped (groupId → null). In-place PATCH keeps the
    // tag id and every trade/day link intact.
    await run(`update ${t.name}`, () =>
      fetch(API[tagType], {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, name: t.name, color: t.color, groupId: groupId || null }),
      }),
    )
  }

  /** One tag row: name chip + per-tag group select (no drag-drop in this build). */
  function tagRow(t: TagRow, currentGroupId: string) {
    return (
      <div key={t.id} className="flex items-center justify-between gap-2">
        <span
          className="truncate rounded-full border px-2 py-0.5 text-xs"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
        >
          {t.name}
        </span>
        <Select value={currentGroupId} onValueChange={(v) => assignTag(t, v)} disabled={busy}>
          <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Group for ${t.name}`}>
            <SelectValue placeholder="Ungrouped" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Ungrouped</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const ungrouped = tags.filter((t) => !t.groupId)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Ungrouped column */}
          <div>
            <p className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {ungroupedLabel}
            </p>
            <div
              className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2 shell-scroll"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
            >
              {ungrouped.length === 0 ? (
                <p className="p-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  No ungrouped tags.
                </p>
              ) : (
                ungrouped.map((t) => tagRow(t, 'none'))
              )}
            </div>
          </div>

          {/* Grouped column — server-backed, editable */}
          <div>
            <p className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {groupedLabel}
            </p>
            <div
              className="max-h-56 space-y-3 overflow-y-auto rounded-md border p-2 shell-scroll"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
            >
              {groups.map((g) => {
                const members = tags.filter((t) => t.groupId === g.id)
                return (
                  <div key={g.id} className="rounded-md border p-2" style={{ borderColor: 'var(--border-strong)' }}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={`Color for ${g.name}`}
                        defaultValue={g.color}
                        onBlur={(e) => {
                          if (e.target.value !== g.color) renameGroup(g, g.name, e.target.value)
                        }}
                        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <Input
                        defaultValue={g.name}
                        aria-label={`Group name ${g.name}`}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== g.name) renameGroup(g, e.target.value, g.color)
                        }}
                        className="h-7 text-xs"
                      />
                      <Badge variant="secondary" className="text-[10px]">
                        {members.length} tag{members.length === 1 ? '' : 's'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete group ${g.name}`}
                        disabled={busy}
                        onClick={() => deleteGroup(g)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {members.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        No tags — assign with the per-tag select.
                      </p>
                    ) : (
                      <div className="space-y-1.5">{members.map((t) => tagRow(t, g.id))}</div>
                    )}
                  </div>
                )
              })}

              {groups.length === 0 ? (
                <p className="p-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  No groups yet.
                </p>
              ) : null}
            </div>

            {/* Add New Group (L2 verbatim label) */}
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={newGroupName}
                placeholder="Group name"
                aria-label="New group name"
                onChange={(e) => setNewGroupName(e.target.value)}
                className="h-8 text-xs"
              />
              <input
                type="color"
                aria-label="New group color"
                value={newGroupColor}
                onChange={(e) => setNewGroupColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border bg-transparent p-0"
              />
              <Button variant="outline" size="sm" onClick={addGroup} disabled={busy}>
                <Plus className="h-3.5 w-3.5" />
                Add New Group
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Deleting a group does NOT delete tags — the tag becomes ungrouped.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Groups are saved on the server and are the exact grouping the Tags-analysis group views use.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Tags tab                                                            */
/* ------------------------------------------------------------------ */
export function TagsTab() {
  const { data: tagsData } = useQuery<{ tags: TagRow[]; groups: GroupRow[] }>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await fetch('/api/tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const { data: dayTagsData } = useQuery<{ dayTags: TagRow[]; groups: GroupRow[] }>({
    queryKey: ['day-tags'],
    queryFn: async () => {
      const res = await fetch('/api/day-tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const tradeTags = useMemo(() => tagsData?.tags ?? [], [tagsData])
  const tradeGroups = useMemo(() => tagsData?.groups ?? [], [tagsData])
  const dayTags = useMemo(() => dayTagsData?.dayTags ?? [], [dayTagsData])
  const dayGroups = useMemo(() => dayTagsData?.groups ?? [], [dayTagsData])

  const [dialog, setDialog] = useState<
    | { kind: 'add' }
    | { kind: 'remove' }
    | { kind: 'rename' }
    | { kind: 'groups'; tagType: TagType }
    | null
  >(null)

  return (
    <div className="space-y-4" data-testid="settings-tab-content-tags">
      {/* Tag Management (L1 §4.5 — verbatim blocks + buttons) */}
      <SectionCard title="Tag Management" testId="tags-management">
        <div className="space-y-3">
          <TagActionBlock
            label="Add Tags"
            buttonLabel="Add"
            accent
            testId="tags-add-block"
            onClick={() => setDialog({ kind: 'add' })}
          />
          <TagActionBlock
            label="Remove Tags"
            buttonLabel="Remove"
            testId="tags-remove-block"
            onClick={() => setDialog({ kind: 'remove' })}
          />
          <TagActionBlock
            label="Rename Tags"
            buttonLabel="Rename"
            testId="tags-rename-block"
            onClick={() => setDialog({ kind: 'rename' })}
          />
        </div>
      </SectionCard>

      {/* Trade Tag Groups (L1 §4.5 + L2 dialog) — server groups, used by analysis */}
      <SectionCard
        title="Trade Tag Groups"
        description="Assign custom groups and colors to your tags for group-wise analysis."
        testId="tags-trade-groups"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ kind: 'groups', tagType: 'trade' })}
        >
          Manage Groups
        </Button>
      </SectionCard>

      {/* Day Tag Groups (L1 §4.5 + L2 dialog) — server groups, used by analysis */}
      <SectionCard
        title="Day Tag Groups"
        description="Assign custom groups and colors to your day tags for group-wise analysis."
        testId="tags-day-groups"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ kind: 'groups', tagType: 'day' })}
        >
          Manage Groups
        </Button>
      </SectionCard>

      {dialog?.kind === 'add' ? (
        <AddTagsDialog existingTags={tradeTags} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveTagsDialog tradeTags={tradeTags} dayTags={dayTags} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <RenameTagsDialog tradeTags={tradeTags} dayTags={dayTags} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'groups' && dialog.tagType === 'trade' ? (
        <TagGroupsDialog
          title="Trade Tags Groups Management"
          ungroupedLabel="Ungrouped Tags"
          groupedLabel="Grouped Tags"
          tags={tradeTags}
          groups={tradeGroups}
          tagType="trade"
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'groups' && dialog.tagType === 'day' ? (
        <TagGroupsDialog
          title="Day Tags Groups Management"
          ungroupedLabel="Ungrouped Day Tags"
          groupedLabel="Grouped Day Tags"
          tags={dayTags}
          groups={dayGroups}
          tagType="day"
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
