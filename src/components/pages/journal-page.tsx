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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BookOpen, Plus, Edit2, Trash2, Calendar, Star, FlaskConical, ArrowUpRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn, formatDateTime, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin } from '@/lib/drill'

const MOODS = [
  { value: 'confident', label: 'Confident', emoji: '💪', color: '#10b981' },
  { value: 'neutral', label: 'Neutral', emoji: '😐', color: '#64748b' },
  { value: 'anxious', label: 'Anxious', emoji: '😰', color: '#ef4444' },
]

// Task 176 — trade-level entry psychology (mentor's lens). The revenge/fomo/
// greedy states are the exact markers tilt-coaching keys on.
const EMOTIONS = [
  { value: 'calm', label: 'Calm', emoji: '😌', color: '#0ea5e9' },
  { value: 'confident', label: 'Confident', emoji: '💪', color: '#10b981' },
  { value: 'disciplined', label: 'Disciplined', emoji: '🎯', color: '#22c55e' },
  { value: 'neutral', label: 'Neutral', emoji: '😐', color: '#64748b' },
  { value: 'anxious', label: 'Anxious', emoji: '😰', color: '#f59e0b' },
  { value: 'fearful', label: 'Fearful', emoji: '😨', color: '#ef4444' },
  { value: 'greedy', label: 'Greedy', emoji: '🤑', color: '#eab308' },
  { value: 'fomo', label: 'FOMO', emoji: '😤', color: '#f97316' },
  { value: 'frustrated', label: 'Frustrated', emoji: '😖', color: '#fb7185' },
  { value: 'revenge', label: 'Revenge', emoji: '😠', color: '#dc2626' },
]

export function JournalPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  // Set when deep-linked (suite pages → "Note") — shows provenance in the dialog
  const [fromLabel, setFromLabel] = useState<string | null>(null)
  const [form, setForm] = useState({
    id: '',
    tradeId: '',
    title: '',
    content: '',
    mood: 'neutral',
    emotion: 'calm',
    confidence: '3',
    rating: '3',
  })

  const { data: tradesData } = useQuery({
    queryKey: ['trades-journal'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: journalData, isLoading } = useQuery({
    queryKey: ['journals'],
    queryFn: async () => {
      const res = await fetch('/api/journal')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const journals = journalData?.journals || []
  const trades = tradesData?.trades || []

  // Deep link (suite "Note" action): open that journal entry for editing.
  const focusJournalId = useAppStore((s) => s.focusJournalId)
  const setFocusJournalId = useAppStore((s) => s.setFocusJournalId)
  useEffect(() => {
    if (!focusJournalId || journals.length === 0) return
    const j = journals.find((x: any) => x.id === focusJournalId)
    setFocusJournalId(null)
    if (!j) return
    setEditing(j)
    setFromLabel('From suite')
    setForm({
      id: j.id,
      tradeId: j.tradeId || '',
      title: j.title,
      content: j.content,
      mood: j.mood || 'neutral',
      emotion: j.emotion || 'calm',
      confidence: j.confidence ? String(j.confidence) : '3',
      rating: String(j.rating || 3),
    })
    setModalOpen(true)
  }, [focusJournalId, journals.length])

  function openNew() {
    setEditing(null)
    setFromLabel(null)
    setForm({
      id: '',
      tradeId: '',
      title: '',
      content: '',
      mood: 'neutral',
      emotion: 'calm',
      confidence: '3',
      rating: '3',
    })
    setModalOpen(true)
  }

  function openEdit(j: any) {
    setEditing(j)
    setFromLabel(null)
    setForm({
      id: j.id,
      tradeId: j.tradeId || '',
      title: j.title,
      content: j.content,
      mood: j.mood || 'neutral',
      emotion: j.emotion || 'calm',
      confidence: j.confidence ? String(j.confidence) : '3',
      rating: String(j.rating || 3),
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title || !form.content) {
      toast({ title: 'Title and content required', variant: 'destructive' })
      return
    }
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? 'Entry updated' : 'Entry created' })
      queryClient.invalidateQueries({ queryKey: ['journals'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this journal entry?')) return
    try {
      await fetch(`/api/journal?id=${id}`, { method: 'DELETE' })
      toast({ title: 'Entry deleted' })
      queryClient.invalidateQueries({ queryKey: ['journals'] })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Trading Journal</h2>
          <p className="text-xs text-muted-foreground">
            Reflect on your trades, capture lessons, and track your growth
          </p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Entry
        </Button>
      </div>

      {journals.length === 0 ? (
        <Card className="p-12 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No journal entries yet</p>
          <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
            Write your first entry
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {journals.map((j: any) => {
            const mood = MOODS.find((m) => m.value === j.mood) || MOODS[1]
            return (
              <Card key={j.id} className="p-4 group">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className="p-2 rounded-md shrink-0"
                      style={{ background: `${mood.color}20` }}
                    >
                      <span className="text-lg">{mood.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold">{j.title}</h3>
                        {j.trade && (
                          <Badge variant="outline" className={cn('text-[10px]', pnlColor(j.trade.pnl))}>
                            {j.trade.symbol} · {formatCurrencyIn('table', j.trade.pnl)}
                          </Badge>
                        )}
                        {/* Task 148-c — cross-link: jump the entry's linked trade into Trade Explore */}
                        {j.trade && (
                          <button
                            type="button"
                            onClick={() => {
                              // Task 12 — breadcrumb: Trade Explore offers the way back.
                              markDrillOrigin('/explore/trade-explore')
                              navigate(`/explore/trade-explore?trade=${j.tradeId}`)
                            }}
                            aria-label="Open in Trade Explore"
                            title="Open in Trade Explore"
                            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn shrink-0"
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            Open trade
                          </button>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          <Calendar className="h-2.5 w-2.5 mr-1" />
                          {formatDateTime(j.createdAt)}
                        </Badge>
                        {j.rating && (
                          <span className="text-yellow-400 text-xs">
                            {'★'.repeat(j.rating)}{'☆'.repeat(5 - j.rating)}
                          </span>
                        )}
                        {j.emotion && (() => {
                          const emo = EMOTIONS.find((x) => x.value === j.emotion)
                          return emo ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded border"
                              style={{ borderColor: `${emo.color}40`, background: `${emo.color}15`, color: emo.color }}
                              title={`Emotion at entry: ${emo.label}`}
                            >
                              {emo.emoji} {emo.label}
                            </span>
                          ) : null
                        })()}
                        {j.confidence && (
                          <Badge variant="outline" className="text-[10px]" title="Confidence at entry">
                            Conviction {j.confidence}/5
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-4">
                        {j.content}
                      </p>
                    </div>
                  </div>
                  {/* MOBILE-3 — touch can't hover: below lg the actions are
                      always visible (max-lg:opacity-100 — Tailwind sorts
                      responsive variants after pseudo variants, so this wins
                      over BOTH base and group-hover below lg); at lg+ the
                      original hover-reveal is byte-identical. */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 max-lg:opacity-100">
                    <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7" onClick={() => openEdit(j)} aria-label="Edit entry">
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7 text-muted-foreground hover:text-red-400" onClick={() => handleDelete(j.id)} aria-label="Delete entry">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {editing ? 'Edit Journal Entry' : 'New Journal Entry'}
              {fromLabel && editing && (
                <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] font-normal">
                  <FlaskConical className="h-2.5 w-2.5 mr-1" />
                  {fromLabel}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            {editing ? 'Edit an existing journal entry.' : 'Write a new journal entry.'}
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Linked Trade (optional)</Label>
              <Select value={form.tradeId} onValueChange={(v) => setForm({ ...form, tradeId: v === 'none' ? '' : v })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Link to a specific trade..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (general reflection)</SelectItem>
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
                placeholder="e.g. AAPL Breakout - Perfect Setup"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <Label>Rating</Label>
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
            {/* Task 176 — entry psychology, captured when the entry is linked to a trade */}
            {form.tradeId && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed p-3">
                <div>
                  <Label className="text-xs">Emotion at entry</Label>
                  <Select value={form.emotion} onValueChange={(v) => setForm({ ...form, emotion: v })}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMOTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.emoji} {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Conviction at entry (1–5)</Label>
                  <Select value={form.confidence} onValueChange={(v) => setForm({ ...form, confidence: v })}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {'●'.repeat(r)}{'○'.repeat(5 - r)} {r}/5
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="col-span-2 text-[11px] text-muted-foreground">
                  Honest psychology beats a perfect hindsight story — these fields feed your AI coach's tilt analysis.
                </p>
              </div>
            )}
            <div>
              <Label>Content</Label>
              <Textarea
                className="mt-1.5"
                rows={10}
                placeholder="What was your thesis? What went well? What did you learn? What would you do differently?"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Update' : 'Save Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
