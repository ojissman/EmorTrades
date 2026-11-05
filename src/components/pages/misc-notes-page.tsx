'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BookOpen, Plus, Edit2, Trash2, Tag, ArrowUpRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'
import { formatCurrencyIn, formatDateTime } from '@/lib/format'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin } from '@/lib/drill'
// Task 22-c — misc-note templates: applied default prefills NEW notes, and
// the "Insert template" control offers the misc-type templates.
import { useUserSettings, settingsSlice } from '@/hooks/use-user-settings'
import { appliedTemplateBody, templatesForType, type NoteTemplate } from '@/lib/note-templates'

export function MiscNotesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  // Task 22-c — misc-note templates (refreshed per dialog open, like the
  // trade modal) + the once-per-open guard for the applied-default prefill.
  const { data: settingsRow } = useUserSettings()
  const [miscTemplates, setMiscTemplates] = useState<NoteTemplate[]>([])
  const [templateApplied, setTemplateApplied] = useState(false)
  const [form, setForm] = useState({
    id: '',
    title: '',
    content: '',
    tradeId: '',
    tagIds: [] as string[],
  })

  const { data, isLoading } = useQuery({
    queryKey: ['misc-notes'],
    queryFn: async () => {
      const res = await fetch('/api/misc-notes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Trades for the "Linked Trade" select (same pattern as the journal's
  // dialog). Without it, form.tradeId could never be set from the UI, so the
  // card's "Linked trade" chip + "Open trade" button were unreachable.
  const { data: tradesData } = useQuery({
    queryKey: ['trades-misc-notes'],
    queryFn: async () => {
      const res = await fetch('/api/trades?limit=500')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const trades: any[] = tradesData?.trades ?? []

  const notes = data?.notes || []
  const tags = data?.tags || []

  // Task 22-c — refresh the misc-note template list each time the dialog
  // opens (localStorage-backed; cheap single read).
  useEffect(() => {
    if (modalOpen) setMiscTemplates(templatesForType('misc'))
  }, [modalOpen])

  // Task 22-c — applied misc-notes template: prefill a NEW note's content
  // once per dialog open (never on edit; only while content starts empty).
  useEffect(() => {
    if (!modalOpen || editing || templateApplied) return
    const body = appliedTemplateBody('misc', settingsSlice(settingsRow, 'notesPlans'))
    if (body == null) return
    setTemplateApplied(true)
    setForm((f) => (f.content.trim() === '' ? { ...f, content: body } : f))
  }, [modalOpen, editing, templateApplied, settingsRow])

  function openNew() {
    setEditing(null)
    setTemplateApplied(false)
    setForm({ id: '', title: '', content: '', tradeId: '', tagIds: [] })
    setModalOpen(true)
  }

  function openEdit(n: any) {
    setEditing(n)
    setTemplateApplied(true) // edit mode NEVER prefills
    setForm({
      id: n.id,
      title: n.title,
      content: n.content,
      tradeId: n.tradeId || '',
      tagIds: n.tags?.map((t: any) => t.noteTagId) || [],
    })
    setModalOpen(true)
  }

  // Task 22-c — "Insert template": put the chosen misc-note template's body
  // into the content (replace when empty, append on a blank line otherwise).
  function insertMiscTemplate(id: string) {
    const tpl = miscTemplates.find((t) => t.id === id)
    if (!tpl || !tpl.body) return
    setForm((f) => ({
      ...f,
      content: f.content.trim() === '' ? tpl.body : `${f.content.replace(/\s+$/, '')}\n\n${tpl.body}`,
    }))
  }

  async function save() {
    if (!form.title || !form.content) {
      toast({ title: 'Title and content required', variant: 'destructive' })
      return
    }
    try {
      const res = await fetch('/api/misc-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? 'Note updated' : 'Note created' })
      queryClient.invalidateQueries({ queryKey: ['misc-notes'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this note?')) return
    try {
      const res = await fetch(`/api/misc-notes?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Note deleted' })
      queryClient.invalidateQueries({ queryKey: ['misc-notes'] })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Misc Notes</h2>
          <p className="text-xs text-muted-foreground">
            General trading notes, rules, playbooks, and ideas
          </p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card className="p-12 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No misc notes yet</p>
          <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
            Create your first note
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {notes.map((n: any) => (
            <Card key={n.id} className="p-4 group">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold">{n.title}</h3>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Edit note ${n.title}`} title={`Edit note ${n.title}`} onClick={() => openEdit(n)}>
                    <Edit2 className="h-3 w-3" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-400" aria-label={`Delete note ${n.title}`} title={`Delete note ${n.title}`} onClick={() => del(n.id)}>
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </Button>
                </div>
              </div>
              {n.tags && n.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {n.tags.map((t: any) => (
                    <Badge
                      key={t.noteTagId}
                      variant="outline"
                      className="text-[10px] border-l-2"
                      style={{ borderColor: t.noteTag?.color }}
                    >
                      <Tag className="h-2 w-2 mr-1" />
                      {t.noteTag?.name}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                {n.content}
              </p>
              {/* Task 148-c — cross-link: surface the linked trade (id only — this page
                  doesn't load /api/trades) and jump it into Trade Explore */}
              {n.tradeId && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
                  <span
                    className="inline-flex h-5 items-center rounded-md border border-[var(--border-strong)] px-1.5 text-[10px] text-muted-foreground"
                    title={`Linked to trade ${n.tradeId}`}
                  >
                    Linked trade
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // Task 12 — breadcrumb: Trade Explore offers the way back.
                      markDrillOrigin('/explore/trade-explore')
                      navigate(`/explore/trade-explore?trade=${n.tradeId}`)
                    }}
                    aria-label="Open in Trade Explore"
                    title="Open in Trade Explore"
                    className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    Open trade
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Note' : 'New Note'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Create or edit a miscellaneous note.</DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Linked Trade (optional)</Label>
              <Select value={form.tradeId} onValueChange={(v) => setForm({ ...form, tradeId: v === 'none' ? '' : v })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Link to a specific trade..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (general note)</SelectItem>
                  {trades.slice(0, 100).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.symbol} · {t.side} · {formatDateTime(t.entryTime)} · {formatCurrencyIn('table', t.pnl)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. My Trading Rules"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Content</Label>
                {/* Task 22-c — Insert template (misc-note templates; hidden
                    entirely when none exist). Sentinel-controlled select so
                    every pick re-fires while the placeholder label stays. */}
                {miscTemplates.length > 0 ? (
                  <Select value="" onValueChange={insertMiscTemplate}>
                    <SelectTrigger
                      className="h-7 w-[190px] text-xs"
                      aria-label="Insert template into content"
                      data-testid="misc-notes-template"
                    >
                      <SelectValue placeholder="Insert template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {miscTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.isDefault ? (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">
                              default
                            </Badge>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              <Textarea
                className="mt-1.5 font-mono text-sm"
                rows={12}
                placeholder="Write your note content..."
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div>
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((tag: any) => {
                  const sel = form.tagIds.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          tagIds: sel
                            ? form.tagIds.filter((t) => t !== tag.id)
                            : [...form.tagIds, tag.id],
                        })
                      }
                      className={cn(
                        'text-xs px-2 py-1 rounded-md border transition-all',
                        sel
                          ? 'border-transparent text-white'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                      style={sel ? { background: tag.color } : {}}
                    >
                      <Tag className="h-2.5 w-2.5 inline mr-1" />
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Update' : 'Save Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
