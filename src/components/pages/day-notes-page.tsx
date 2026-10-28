'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
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
import { CalendarDays, Plus, Edit2, Trash2, Star, Sparkles, ArrowUpRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn, formatDate, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
// Task 22-c — day-note templates: applied default prefills NEW notes, and
// the "Insert template" control offers the day-type templates.
import { useUserSettings, settingsSlice } from '@/hooks/use-user-settings'
import { appliedTemplateBody, templatesForType, type NoteTemplate } from '@/lib/note-templates'

const MOODS = [
  { value: 'confident', label: 'Confident', emoji: '💪', color: '#10b981' },
  { value: 'neutral', label: 'Neutral', emoji: '😐', color: '#64748b' },
  { value: 'anxious', label: 'Anxious', emoji: '😰', color: '#ef4444' },
]

export function DayNotesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { focusDate, setFocusDate, navigate } = useAppStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null)
  // Task 22-c — day-note templates (refreshed per dialog open, like the
  // trade modal) + the once-per-open guard for the applied-default prefill.
  const { data: settingsRow } = useUserSettings()
  const [dayTemplates, setDayTemplates] = useState<NoteTemplate[]>([])
  const [templateApplied, setTemplateApplied] = useState(false)
  const [form, setForm] = useState({
    id: '',
    date: new Date().toISOString().split('T')[0],
    title: '',
    content: '',
    mood: 'neutral',
    rating: '3',
  })

  const { data: notesData, isLoading } = useQuery({
    queryKey: ['day-notes'],
    queryFn: async () => {
      const res = await fetch('/api/day-notes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: tradesData } = useQuery({
    queryKey: ['trades-day-notes'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const notes = notesData?.dayNotes || []

  // Task 22-c — refresh the day-note template list each time the dialog
  // opens (localStorage-backed; cheap single read).
  useEffect(() => {
    if (modalOpen) setDayTemplates(templatesForType('day'))
  }, [modalOpen])

  // Task 22-c — applied day-notes template: prefill a NEW note's content once
  // per dialog open (never on edit; only while the content starts empty).
  useEffect(() => {
    if (!modalOpen || editing || templateApplied) return
    const body = appliedTemplateBody('day', settingsSlice(settingsRow, 'notesPlans'))
    if (body == null) return
    setTemplateApplied(true)
    setForm((f) => (f.content.trim() === '' ? { ...f, content: body } : f))
  }, [modalOpen, editing, templateApplied, settingsRow])

  // Deep link: Calendar day cell → "Open day note" lands here with focusDate set.
  // If a note exists for that date, highlight + edit it; otherwise prefill a new note.
  useEffect(() => {
    if (!focusDate || isLoading || !notesData) return
    const existing = notes.find(
      (n: any) => new Date(n.date).toISOString().split('T')[0] === focusDate
    )
    if (existing) {
      setFocusedNoteId(existing.id)
      openEdit(existing)
    } else {
      openNew(focusDate)
    }
    setFocusDate(null)
  }, [focusDate, isLoading, notesData])

  function openNew(forDate?: string) {
    setEditing(null)
    setTemplateApplied(false)
    setForm({
      id: '',
      date: forDate || new Date().toISOString().split('T')[0],
      title: '',
      content: '',
      mood: 'neutral',
      rating: '3',
    })
    setModalOpen(true)
  }

  function openEdit(n: any) {
    setEditing(n)
    setTemplateApplied(true) // edit mode NEVER prefills
    setForm({
      id: n.id,
      date: new Date(n.date).toISOString().split('T')[0],
      title: n.title,
      content: n.content,
      mood: n.mood || 'neutral',
      rating: String(n.rating || 3),
    })
    setModalOpen(true)
  }

  // Task 22-c — "Insert template": put the chosen day-note template's body
  // into the content (replace when empty, append on a blank line otherwise).
  function insertDayTemplate(id: string) {
    const tpl = dayTemplates.find((t) => t.id === id)
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
      const res = await fetch('/api/day-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? 'Day note updated' : 'Day note saved' })
      queryClient.invalidateQueries({ queryKey: ['day-notes'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this day note?')) return
    try {
      await fetch(`/api/day-notes?id=${id}`, { method: 'DELETE' })
      toast({ title: 'Note deleted' })
      queryClient.invalidateQueries({ queryKey: ['day-notes'] })
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
          <h2 className="text-lg font-semibold">Day Notes</h2>
          <p className="text-xs text-muted-foreground">Daily market reflections and observations</p>
        </div>
        <Button onClick={() => openNew()} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Day Note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No day notes yet</p>
          <Button onClick={() => openNew()} className="bg-emerald-600 hover:bg-emerald-700">
            Write your first day note
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map((n: any) => {
            const mood = MOODS.find((m) => m.value === n.mood) || MOODS[1]
            const dayDate = String(n.date).slice(0, 10)
            const dayTrades = (tradesData?.trades || []).filter((t: any) => {
              // Task 6 — trade-day convention: a trade belongs to its ENTRY
              // day (UTC), so the note's day P&L matches the calendar grid and
              // Day Explore for the same date.
              if (!t.entryTime) return false
              return String(t.entryTime).slice(0, 10) === dayDate
            })
            const dayPnl = dayTrades.reduce((s: number, t: any) => s + t.pnl, 0)
            const isFocused = n.id === focusedNoteId
            return (
              <Card
                key={n.id}
                className={cn(
                  'p-4 group transition-all',
                  isFocused && 'ring-2 ring-sky-500/60 border-sky-500/40 bg-sky-500/5'
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="p-2 rounded-md shrink-0" style={{ background: `${mood.color}20` }}>
                      <span className="text-lg">{mood.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold">{n.title}</h3>
                        {isFocused && (
                          <Badge variant="outline" className="text-[10px] border-sky-500/40 bg-sky-500/10 text-sky-300 gap-1">
                            <Sparkles className="h-2.5 w-2.5" />
                            From calendar
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          <CalendarDays className="h-2.5 w-2.5 mr-1" />
                          {formatDate(n.date)}
                        </Badge>
                        {/* Task 148-c — cross-link: jump this day note into Day Explore */}
                        <button
                          type="button"
                          onClick={() => navigate(`/explore/day-explore?date=${dayDate}`)}
                          aria-label="Open in Day Explore"
                          title="Open in Day Explore"
                          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn shrink-0"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          Open day
                        </button>
                        {n.rating && (
                          <span className="text-yellow-400 text-xs">
                            {'★'.repeat(n.rating)}{'☆'.repeat(5 - n.rating)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-3">
                        {n.content}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit day note ${String(n.date).slice(0, 10)}`} title={`Edit day note ${String(n.date).slice(0, 10)}`} onClick={() => openEdit(n)}>
                      <Edit2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" aria-label={`Delete day note ${String(n.date).slice(0, 10)}`} title={`Delete day note ${String(n.date).slice(0, 10)}`} onClick={() => del(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
                {dayTrades.length > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">{dayTrades.length} trades this day</span>
                    <span className={cn('text-sm font-semibold tnum', pnlColor(dayPnl))}>
                      {dayPnl > 0 ? '+' : ''}{formatCurrencyIn('table', dayPnl)}
                    </span>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Day Note' : 'New Day Note'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Create or edit a day note.</DialogDescription>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input
                  className="mt-1.5"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <Label>Mood</Label>
                <Select value={form.mood} onValueChange={(v) => setForm({ ...form, mood: v })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.emoji} {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. Strong momentum day"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Content</Label>
                {/* Task 22-c — Insert template (day-note templates; hidden
                    entirely when none exist). Sentinel-controlled select so
                    every pick re-fires while the placeholder label stays. */}
                {dayTemplates.length > 0 ? (
                  <Select value="" onValueChange={insertDayTemplate}>
                    <SelectTrigger
                      className="h-7 w-[190px] text-xs"
                      aria-label="Insert template into content"
                      data-testid="day-notes-template"
                    >
                      <SelectValue placeholder="Insert template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {dayTemplates.map((t) => (
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
                className="mt-1.5"
                rows={8}
                placeholder="What happened today? What did you learn?"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div>
              <Label>Day Rating</Label>
              <Select value={form.rating} onValueChange={(v) => setForm({ ...form, rating: v })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {'★'.repeat(r)}{'☆'.repeat(5 - r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Update' : 'Save Day Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
