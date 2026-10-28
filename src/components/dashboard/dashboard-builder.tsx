'use client'

/**
 * DashboardBuilder — the Custom Dashboard editing canvas (Navigation Bar #3,
 * spec: "full control on how that particular Overview looks — the widget,
 * card, section, positions, size, compact or standard resizing, what to
 * display, what not to display… full customization without limitation").
 *
 * Design: sticky toolbar (identity + status + actions), collapsible widget
 * library (left), live canvas on a dot-grid (right). Preview renders REAL
 * data through the same registry the Overview uses — what you see is exactly
 * what ships.
 *
 * Direct manipulation (this round):
 *  - DRAG ANYWHERE: cells reorder by dropping before/after any cell (the
 *    insertion edge lights up); library widgets drag straight into the canvas
 *    at any position; dropping on empty canvas space appends/moves to end.
 *  - EDGE RESIZE: every cell has pointer-capture resize handles on all four
 *    edges + four corners. Horizontal drag = width (grid span), vertical drag
 *    = free pixel height (committed as heightPx, overriding the size bucket).
 *  - DRAG AUTO-SCROLL: holding a drag near the main container's top/bottom
 *    edge scrolls the page, so widgets below the fold are reachable.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, type CustomDashboardMeta, type DashboardWidgetInstance, CUSTOM_LAYOUT_TYPE, WIDGET_HEIGHT_MIN, WIDGET_HEIGHT_MAX } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { computeOverviewStats, type OverviewTradeRow } from '@/lib/overview-stats'
import {
  WIDGET_DEFS, WIDGET_CATEGORIES, getWidgetDef, SPAN_CLASS, PRESET_WIDGET_LAYOUTS,
  type WidgetSizeId, type WidgetSettingDef,
} from './widget-registry'
import { downloadDashboardJson } from './dashboard-share'
import { captureFilterSnapshot, applyFilterSnapshot, describeSnapshot } from '@/lib/dashboard-filters'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff, Plus, Search, Save,
  Trash2, Lock, Play, RotateCcw, Columns3, Rows3, GripVertical, Gauge,
  LineChart, Table2, Sparkles, LayoutGrid, SlidersHorizontal, Download,
  PanelLeftClose, PanelLeftOpen, CalendarRange, X, Undo2, Redo2, Copy, Keyboard, FolderInput, type LucideIcon,
} from 'lucide-react'
import { ToastAction } from '@/components/ui/toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const SPAN_LABEL: Record<1 | 2 | 3, string> = { 1: '⅓ width', 2: '⅔ width', 3: 'Full width' }
const SPAN_ICON = { 1: Columns3, 2: Columns3, 3: Rows3 }
const SIZE_LABEL: Record<WidgetSizeId, string> = { compact: 'Compact', standard: 'Standard', tall: 'Tall' }
const SIZE_ORDER: WidgetSizeId[] = ['compact', 'standard', 'tall']

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  KPIs: Gauge,
  Charts: LineChart,
  'Tables & Lists': Table2,
  'AI & Briefing': Sparkles,
}

/** What is being dragged: an existing canvas cell or a widget from the library. */
type DragPayload = { kind: 'cell'; index: number } | { kind: 'library'; widgetId: string } | null
/** Where a drop would land relative to the hovered cell. */
type InsertPoint = { index: number; after: boolean } | null
/** Resize handle position: four edges + four corners. */
type ResizeEdge = 'left' | 'right' | 'top' | 'bottom' | 'nw' | 'ne' | 'sw' | 'se'
/** Live resize preview written into the cell while the pointer is down. */
type ResizeGhost = { index: number; span: 1 | 2 | 3; heightPx?: number; edge: ResizeEdge; pointerX: number; pointerY: number } | null
/**
 * Touch drag session — HTML5 drag-and-drop is mouse-only, so coarse pointers
 * reorder by PRESS-AND-HOLD: hold a cell/library row ~420ms without moving,
 * then drag. The finger gets a floating ghost + the same insertion edges as
 * desktop, and vertical movement is claimed (scroll blocked) once active.
 */
type TouchDragSession = {
  kind: 'cell' | 'library'
  index?: number
  widgetId?: string
  label: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  active: boolean
}

const LONG_PRESS_MS = 420
/** Finger travel that disarms a pending long-press (it's a scroll, not a drag). */
const LONG_PRESS_SLOP = 12

const LIB_OPEN_KEY = 'builder.libraryOpen'
/** History depth cap — beyond this the oldest step falls off (memory + sanity). */
const HISTORY_MAX = 60
const RESIZE_CURSOR: Record<ResizeEdge, string> = {
  left: 'cursor-ew-resize',
  right: 'cursor-ew-resize',
  top: 'cursor-ns-resize',
  bottom: 'cursor-ns-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
}
/** Grid gap (gap-3) — used for span-step math during width resize. */
const GRID_GAP = 12
/** Drag direction multipliers per handle: +1 = drag outward to grow. */
const EDGE_H: Record<ResizeEdge, 1 | 0 | -1> = { left: -1, right: 1, top: 0, bottom: 0, nw: -1, ne: 1, sw: -1, se: 1 }
const EDGE_V: Record<ResizeEdge, 1 | 0 | -1> = { left: 0, right: 0, top: -1, bottom: 1, nw: -1, ne: -1, sw: 1, se: 1 }

function IconChip({ icon: Icon }: { icon: ComponentType<{ className?: string; style?: CSSProperties }> }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--bg-hover)' }} aria-hidden>
      <Icon className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
    </span>
  )
}

export function DashboardBuilder({ dashboard, onClose }: { dashboard: CustomDashboardMeta; onClose: () => void }) {
  const updateCustomDashboard = useAppStore((s) => s.updateCustomDashboard)
  const customDashboards = useAppStore((s) => s.customDashboards)
  const setOverviewType = useAppStore((s) => s.setOverviewType)
  const navigate = useAppStore((s) => s.navigate)
  const filterStore = useFilterStore()
  const { toast } = useToast()

  const [draft, setDraft] = useState<DashboardWidgetInstance[]>(
    () => (dashboard.widgets ?? []).map((w) => ({ ...w })),
  )
  /** Synchronous draft mirror — history pushes must never read stale state. */
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  /** Undo/redo stacks (snapshots of the committed draft). */
  const historyRef = useRef<{ past: DashboardWidgetInstance[][]; future: DashboardWidgetInstance[][] }>({ past: [], future: [] })
  /** Mirror of the stack depths — re-renders the toolbar disabled states. */
  const [histDepth, setHistDepth] = useState({ undo: 0, redo: 0 })
  const [search, setSearch] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [settingsFor, setSettingsFor] = useState<number | null>(null)
  /** Cell whose "copy to another board" picker is open (index into draft). */
  const [copyFor, setCopyFor] = useState<number | null>(null)
  const [libOpen, setLibOpen] = useState<boolean>(() => {
    // The builder only mounts after a user click (never during SSR/hydration),
    // so reading localStorage in the initializer is safe here.
    if (typeof window === 'undefined') return true
    try { return localStorage.getItem(LIB_OPEN_KEY) !== '0' } catch { return true }
  })
  const [dragKind, setDragKind] = useState<null | 'cell' | 'library'>(null)
  /** State mirror of dragPayloadRef for cell drags — drives the dimmed source cell. */
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null)
  const [insertAt, setInsertAt] = useState<InsertPoint>(null)
  const [resizeGhost, setResizeGhost] = useState<ResizeGhost>(null)
  /** Active touch-drag session (state mirror for the ghost + dimmed source). */
  const [touchDrag, setTouchDrag] = useState<TouchDragSession | null>(null)
  const [touchPoint, setTouchPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Coarse pointer → touch-first affordances (long-press hints, no HTML5 drag). */
  const [coarsePointer] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true)

  /** Synchronous mirrors — drag/resize events fire faster than React state settles. */
  const dragPayloadRef = useRef<DragPayload>(null)
  const resizeRef = useRef<null | {
    index: number
    edge: ResizeEdge
    startX: number
    startY: number
    startSpan: 1 | 2 | 3
    startHeightPx?: number
    measuredHeight: number
    colStep: number
    columns: number
    liveSpan: 1 | 2 | 3
    liveHeight?: number
    moved: boolean
  }>(null)
  const contentRefs = useRef<(HTMLDivElement | null)[]>([])
  const autoScrollRef = useRef<{ y: number | null; raf: number }>({ y: null, raf: 0 })
  /** Synchronous touch-drag session — touch events fire faster than state settles. */
  const touchSessionRef = useRef<TouchDragSession | null>(null)
  const longPressTimerRef = useRef(0)
  /** Latest insertion point as a ref — touchend commits before React re-renders. */
  const insertAtRef = useRef<InsertPoint>(null)
  /** Document listener identities actually attached for the current session. */
  const docTouchHandlersRef = useRef<{ move: (e: TouchEvent) => void; end: () => void } | null>(null)
  /** True right after a touch drag commits — swallows the trailing click. */
  const suppressLibClickRef = useRef(false)

  const locked = !!dashboard.locked

  // Persist the library toggle preference.
  useEffect(() => {
    try { localStorage.setItem(LIB_OPEN_KEY, libOpen ? '1' : '0') } catch { /* ignore */ }
  }, [libOpen])

  // Same query as the Overview page → shared TanStack cache, instant preview.
  const { data } = useQuery({
    queryKey: ['overview-trades', filterStore.accountId, filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate],
    queryFn: async () => {
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '500')
      const res = await fetch(`/api/trades?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load trades')
      return res.json() as Promise<{ trades: OverviewTradeRow[]; total: number }>
    },
  })
  const trades = useMemo(() => data?.trades ?? [], [data])
  const stats = useMemo(() => computeOverviewStats(trades), [trades])

  const dirty = JSON.stringify(draft) !== JSON.stringify(dashboard.widgets ?? [])
  const hiddenCount = draft.filter((w) => w.hidden).length

  // ---- draft history (undo / redo) --------------------------------------------

  /**
   * The single funnel for every committed draft mutation: evaluates the
   * transform against the synchronous mirror, pushes the previous snapshot
   * onto the undo stack, and clears the redo stack. Pure no-op transforms
   * (returned the same array) skip the history push.
   */
  function updateDraft(transform: (d: DashboardWidgetInstance[]) => DashboardWidgetInstance[]) {
    const before = draftRef.current
    const after = transform(before)
    if (after === before) return
    const h = historyRef.current
    h.past.push(before)
    if (h.past.length > HISTORY_MAX) h.past.shift()
    h.future.length = 0
    draftRef.current = after
    setDraft(after)
    setHistDepth({ undo: h.past.length, redo: 0 })
  }

  function undo() {
    const h = historyRef.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(draftRef.current)
    draftRef.current = prev
    setDraft(prev)
    setHistDepth({ undo: h.past.length, redo: h.future.length })
  }

  function redo() {
    const h = historyRef.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(draftRef.current)
    draftRef.current = next
    setDraft(next)
    setHistDepth({ undo: h.past.length, redo: h.future.length })
  }

  // Ctrl/Cmd+Z (⇧ for redo) / Ctrl+Y — bound while the builder is mounted.
  const keyHandlersRef = useRef({ undo, redo })
  useEffect(() => {
    keyHandlersRef.current = { undo, redo }
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) keyHandlersRef.current.redo()
        else keyHandlersRef.current.undo()
      } else if (k === 'y') {
        e.preventDefault()
        keyHandlersRef.current.redo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Esc closes transient surfaces (configure panel, copy-to-board picker).
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setSettingsFor((v) => (v === null ? v : null))
      setCopyFor(null)
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])

  function patch(index: number, patchObj: Partial<DashboardWidgetInstance>) {
    updateDraft((d) => d.map((w, i) => (i === index ? { ...w, ...patchObj } : w)))
  }

  function move(index: number, dir: -1 | 1) {
    updateDraft((d) => {
      const next = [...d]
      const target = index + dir
      if (target < 0 || target >= next.length) return d
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function add(widgetId: string) {
    const def = getWidgetDef(widgetId)
    if (!def) return
    updateDraft((d) => [...d, { widgetId, span: def.defaultSpan, size: def.defaultSize, hidden: false }])
    toast({ title: `${def.title} added`, description: 'Drag it anywhere on the canvas, drag its edges to resize.' })
  }

  function removeAt(index: number) {
    updateDraft((d) => d.filter((_, i) => i !== index))
    if (settingsFor === index) setSettingsFor(null)
    toast({
      title: 'Widget removed',
      description: 'The instance was taken off the canvas (not saved yet).',
      action: (
        <ToastAction altText="Undo removal" onClick={() => undo()} data-testid="toast-undo-remove">
          Undo
        </ToastAction>
      ),
    })
  }

  /** Clone the instance at `index` and insert the copy right after it. */
  function duplicateAt(index: number) {
    const def = getWidgetDef(draftRef.current[index]?.widgetId ?? '')
    updateDraft((d) => {
      if (index < 0 || index >= d.length) return d
      const src = d[index]
      const clone: DashboardWidgetInstance = { ...src, settings: src.settings ? { ...src.settings } : undefined }
      const next = [...d]
      next.splice(index + 1, 0, clone)
      return next
    })
    if (def) toast({ title: `${def.title} duplicated`, description: 'An identical copy was inserted right after the original.' })
  }

  /** Append a clone of the instance at `index` to another board's saved layout. */
  function copyToBoard(index: number, targetId: string) {
    const src = draftRef.current[index]
    const target = useAppStore.getState().customDashboards.find((d) => d.id === targetId)
    if (!src || !target || target.locked) return
    const clone: DashboardWidgetInstance = { ...src, settings: src.settings ? { ...src.settings } : undefined }
    updateCustomDashboard(target.id, { widgets: [...(target.widgets ?? []), clone] })
    setCopyFor(null)
    toast({
      title: `Copied to “${target.name}”`,
      description: `${getWidgetDef(src.widgetId)?.title ?? 'Widget'} appended at the end of that board (opens with it next time).`,
    })
  }

  // ---- drag & drop (insert anywhere) -----------------------------------------

  function clearDrag() {
    dragPayloadRef.current = null
    setDragKind(null)
    setDragFromIndex(null)
    setInsertAt(null)
    stopAutoScroll()
  }

  /**
   * Insert semantics for cell moves: `from` is removed first, then placed at
   * the requested boundary (`targetIndex` before/after — adjusted once the
   * removed element shifts the indices).
   */
  function reorderInsert(from: number, targetIndex: number, after: boolean) {
    updateDraft((d) => {
      if (from < 0 || from >= d.length) return d
      const insertPos = Math.max(0, Math.min(d.length, targetIndex + (after ? 1 : 0)))
      if (insertPos === from || insertPos === from + 1) return d // dropped on itself
      const next = [...d]
      const [item] = next.splice(from, 1)
      next.splice(insertPos > from ? insertPos - 1 : insertPos, 0, item)
      return next
    })
  }

  /** Cell drop with no insertion point → push to the end of the draft. */
  function moveCellToEnd(index: number) {
    updateDraft((d) => {
      if (index < 0 || index >= d.length) return d
      const next = [...d]
      const [item] = next.splice(index, 1)
      next.push(item)
      return next
    })
  }

  function insertLibraryWidget(widgetId: string, targetIndex: number, after: boolean) {
    const def = getWidgetDef(widgetId)
    if (!def) return
    const instance: DashboardWidgetInstance = { widgetId, span: def.defaultSpan, size: def.defaultSize, hidden: false }
    updateDraft((d) => {
      const next = [...d]
      next.splice(Math.max(0, Math.min(d.length, targetIndex + (after ? 1 : 0))), 0, instance)
      return next
    })
    toast({ title: `${def.title} added`, description: 'Dropped into position — drag its edges to resize.' })
  }

  /** Before/after split of the hovered cell (X split on desktop, Y on mobile). */
  function cellInsertSide(e: DragEvent, index: number): { index: number; after: boolean } {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vertical = typeof window !== 'undefined' && window.innerWidth < 768
    const after = vertical
      ? e.clientY > rect.top + rect.height / 2
      : e.clientX > rect.left + rect.width / 2
    return { index, after }
  }

  function onCellDragStart(e: DragEvent, index: number) {
    if (locked || resizeRef.current) return
    dragPayloadRef.current = { kind: 'cell', index }
    setDragKind('cell')
    setDragFromIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    startAutoScroll()
  }

  function onCellDragOver(e: DragEvent, index: number) {
    const payload = dragPayloadRef.current
    if (!payload || locked) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = payload.kind === 'library' ? 'copy' : 'move'
    trackAutoScroll(e.clientY)
    const side = cellInsertSide(e, index)
    setInsertAt((prev) => (prev && prev.index === side.index && prev.after === side.after ? prev : side))
  }

  function onCellDrop(e: DragEvent, index: number) {
    const payload = dragPayloadRef.current
    if (!payload || locked) return
    e.preventDefault()
    e.stopPropagation()
    const side = cellInsertSide(e, index)
    if (payload.kind === 'library') insertLibraryWidget(payload.widgetId, side.index, side.after)
    else reorderInsert(payload.index, side.index, side.after)
    clearDrag()
  }

  /** Canvas-level (outside any cell): hover = "place at the end", drop appends/moves to end. */
  function onCanvasDragOver(e: DragEvent) {
    const payload = dragPayloadRef.current
    if (!payload || locked) return
    e.preventDefault()
    e.dataTransfer.dropEffect = payload.kind === 'library' ? 'copy' : 'move'
    trackAutoScroll(e.clientY)
    setInsertAt((prev) => (prev === null ? prev : null))
  }

  function onCanvasDrop(e: DragEvent) {
    const payload = dragPayloadRef.current
    if (!payload || locked) return
    e.preventDefault()
    updateDraft((d) => {
      if (payload.kind === 'library') {
        const def = getWidgetDef(payload.widgetId)
        if (!def) return d
        return [...d, { widgetId: payload.widgetId, span: def.defaultSpan, size: def.defaultSize, hidden: false }]
      }
      if (payload.index < 0 || payload.index >= d.length) return d
      const next = [...d]
      const [item] = next.splice(payload.index, 1)
      next.push(item)
      return next
    })
    if (payload.kind === 'library') {
      const def = getWidgetDef(payload.widgetId)
      if (def) toast({ title: `${def.title} added`, description: 'Placed at the end — drag it anywhere on the canvas.' })
    }
    clearDrag()
  }

  // ---- touch long-press drag (mobile reordering) ------------------------------

  /** A click right after a touch drag must never land on a cell control. */
  function swallowNextClick() {
    const kill = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      document.removeEventListener('click', kill, true)
    }
    document.addEventListener('click', kill, { capture: true, once: true })
    setTimeout(() => document.removeEventListener('click', kill, true), 350)
  }

  function disarmTouchListeners() {
    const h = docTouchHandlersRef.current
    if (h) {
      document.removeEventListener('touchmove', h.move)
      document.removeEventListener('touchend', h.end)
      document.removeEventListener('touchcancel', h.end)
      docTouchHandlersRef.current = null
    }
  }

  /** Abandon an armed (not yet active) session — the finger is scrolling. */
  function cancelTouchArm() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = 0
    }
    touchSessionRef.current = null
    disarmTouchListeners()
  }

  /**
   * Arm a potential drag on touchstart: wait LONG_PRESS_MS without movement,
   * listening at document level (non-passive) so an active drag can claim the
   * gesture with preventDefault.
   */
  function armTouchDrag(session: TouchDragSession) {
    suppressLibClickRef.current = false
    touchSessionRef.current = session
    longPressTimerRef.current = window.setTimeout(() => {
      const s = touchSessionRef.current
      if (!s) return
      s.active = true
      setTouchDrag({ ...s })
      setTouchPoint({ x: s.lastX, y: s.lastY })
      setDragKind(s.kind)
      if (s.kind === 'cell') setDragFromIndex(s.index ?? null)
      try { navigator.vibrate?.(12) } catch { /* unsupported */ }
      startAutoScroll()
      trackAutoScroll(s.lastY)
    }, LONG_PRESS_MS)
    const handlers = {
      move: onDocTouchMove,
      end: onDocTouchEnd,
    }
    docTouchHandlersRef.current = handlers
    document.addEventListener('touchmove', handlers.move, { passive: false })
    document.addEventListener('touchend', handlers.end)
    document.addEventListener('touchcancel', handlers.end)
  }

  function onDocTouchMove(e: TouchEvent) {
    const s = touchSessionRef.current
    if (!s) return
    const t = e.touches[0]
    if (!t) return
    s.lastX = t.clientX
    s.lastY = t.clientY
    if (!s.active) {
      // Moved before the timer fired → this is a scroll, not a drag.
      if (Math.hypot(t.clientX - s.startX, t.clientY - s.startY) > LONG_PRESS_SLOP) cancelTouchArm()
      return
    }
    e.preventDefault() // we own the gesture now — block page scroll
    setTouchPoint({ x: t.clientX, y: t.clientY })
    trackAutoScroll(t.clientY)
    // Hit-test what's under the finger (ghost is pointer-events-none).
    const el = document.elementFromPoint(t.clientX, t.clientY)
    const cell = (el?.closest('[data-cell]') ?? null) as HTMLElement | null
    if (cell?.dataset.index !== undefined) {
      const idx = Number(cell.dataset.index)
      if (!Number.isNaN(idx)) {
        const rect = cell.getBoundingClientRect()
        const vertical = window.innerWidth < 768
        const after = vertical
          ? t.clientY > rect.top + rect.height / 2
          : t.clientX > rect.left + rect.width / 2
        const next: InsertPoint = { index: idx, after }
        insertAtRef.current = next
        setInsertAt((prev) => (prev && prev.index === next.index && prev.after === next.after ? prev : next))
        return
      }
    }
    insertAtRef.current = null
    setInsertAt((prev) => (prev === null ? prev : null))
  }

  function onDocTouchEnd() {
    const s = touchSessionRef.current
    if (!s) return
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = 0
    }
    disarmTouchListeners()
    touchSessionRef.current = null
    if (s.active) {
      const insert = insertAtRef.current
      if (s.kind === 'cell' && s.index !== undefined) {
        if (insert) reorderInsert(s.index, insert.index, insert.after)
        else moveCellToEnd(s.index)
      } else if (s.kind === 'library' && s.widgetId) {
        if (insert) {
          insertLibraryWidget(s.widgetId, insert.index, insert.after)
        } else {
          const def = getWidgetDef(s.widgetId)
          updateDraft((d) => [
            ...d,
            { widgetId: s.widgetId!, span: def?.defaultSpan ?? 1, size: def?.defaultSize ?? 'standard', hidden: false },
          ])
          if (def) toast({ title: `${def.title} added`, description: 'Placed at the end — press-and-hold it to reposition.' })
        }
      }
      suppressLibClickRef.current = true
      swallowNextClick()
      clearDrag()
    }
    setTouchDrag(null)
    stopAutoScroll()
  }

  function onCellTouchStart(e: ReactTouchEvent, index: number) {
    if (locked || resizeRef.current) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    armTouchDrag({
      kind: 'cell',
      index,
      label: getWidgetDef(draft[index]?.widgetId ?? '')?.title ?? 'Widget',
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      active: false,
    })
  }

  function onLibTouchStart(e: ReactTouchEvent, widgetId: string, label: string) {
    if (locked) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    armTouchDrag({
      kind: 'library',
      widgetId,
      label,
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      active: false,
    })
  }

  useEffect(
    () => () => {
      // Unmount: drop any pending timer + document listeners from this session.
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      disarmTouchListeners()
    },
    [],
  )

  // ---- drag auto-scroll (main is the scroll container, not the window) -------

  function autoScrollTick() {
    const y = autoScrollRef.current.y
    if (y !== null) {
      const main = document.getElementById('main-content')
      if (main) {
        const r = main.getBoundingClientRect()
        const edge = 80
        if (y < r.top + edge) main.scrollTop -= Math.max(4, Math.ceil((r.top + edge - y) / 3))
        else if (y > r.bottom - edge) main.scrollTop += Math.max(4, Math.ceil((y - (r.bottom - edge)) / 3))
      }
    }
    autoScrollRef.current.raf = requestAnimationFrame(autoScrollTick)
  }

  function trackAutoScroll(clientY: number) {
    autoScrollRef.current.y = clientY
  }

  function startAutoScroll() {
    if (!autoScrollRef.current.raf) autoScrollRef.current.raf = requestAnimationFrame(autoScrollTick)
  }

  function stopAutoScroll() {
    autoScrollRef.current.y = null
    if (autoScrollRef.current.raf) cancelAnimationFrame(autoScrollRef.current.raf)
    autoScrollRef.current.raf = 0
  }

  useEffect(() => stopAutoScroll, []) // unmount cleanup

  // ---- free resize (all four edges + corners, pointer capture) ---------------

  function onResizePointerDown(e: ReactPointerEvent, index: number, edge: ResizeEdge) {
    if (locked) return
    e.preventDefault()
    e.stopPropagation()
    const section = (e.currentTarget as HTMLElement).closest('[data-cell]') as HTMLElement | null
    const content = contentRefs.current[index]
    if (!section || !content) return
    const inst = draft[index]
    const rect = section.getBoundingClientRect()
    const measured = content.getBoundingClientRect().height
    const columns = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1
    const colWidth = (rect.width - (inst.span - 1) * GRID_GAP) / inst.span
    resizeRef.current = {
      index,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startSpan: inst.span,
      measuredHeight: measured,
      colStep: colWidth + GRID_GAP,
      columns,
      liveSpan: inst.span,
      startHeightPx: inst.heightPx,
      liveHeight: inst.heightPx,
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setResizeGhost({ index, span: inst.span, heightPx: inst.heightPx, edge, pointerX: e.clientX, pointerY: e.clientY })
  }

  function onResizePointerMove(e: ReactPointerEvent) {
    const r = resizeRef.current
    if (!r) return
    // Safety net: if the button was released without a pointerup reaching us
    // (alt-tab, lost capture, stray stream), abandon the session instead of
    // committing garbage on a later event.
    if (e.buttons === 0 && e.type === 'pointermove') {
      resizeRef.current = null
      setResizeGhost(null)
      return
    }
    const dx = e.clientX - r.startX
    const dy = e.clientY - r.startY

    // Width: dragging a right/corner-east edge outward (or left/west edge
    // outward) widens. EDGE_H carries the per-handle outward direction.
    const hDir = EDGE_H[r.edge] * dx
    let span = r.startSpan
    if (hDir !== 0 && r.columns > 1) {
      span = Math.min(r.columns, Math.max(1, r.startSpan + Math.round(hDir / r.colStep))) as 1 | 2 | 3
    }

    // Height: bottom/south edges grow downward (+dy), top/north edges grow
    // upward (−dy).
    const vDir = EDGE_V[r.edge] * dy
    let heightPx = r.liveHeight
    if (vDir !== 0) {
      heightPx = Math.min(WIDGET_HEIGHT_MAX, Math.max(WIDGET_HEIGHT_MIN, Math.round(r.measuredHeight + vDir)))
    }

    r.liveSpan = span
    r.liveHeight = heightPx
    if (span !== r.startSpan || heightPx !== r.startHeightPx) r.moved = true
    setResizeGhost({ index: r.index, span, heightPx: heightPx ?? undefined, edge: r.edge, pointerX: e.clientX, pointerY: e.clientY })
  }

  function onResizePointerUp(e: ReactPointerEvent) {
    const r = resizeRef.current
    if (!r) return
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
    resizeRef.current = null
    setResizeGhost(null)
    if (!r.moved) return // click on a handle without dragging — nothing to commit
    const span = r.liveSpan
    const heightPx = r.liveHeight
    updateDraft((d) =>
      d.map((w, i) => {
        if (i !== r.index) return w
        const next = { ...w, span }
        if (heightPx !== undefined) next.heightPx = Math.round(heightPx)
        else delete next.heightPx
        return next
      }),
    )
  }

  // ---- settings --------------------------------------------------------------

  /** Write one settings knob on the instance at `index`. */
  function setSetting(index: number, def: WidgetSettingDef, value: number | boolean, current?: Record<string, number | string | boolean>) {
    updateDraft((d) =>
      d.map((w, i) =>
        i === index ? { ...w, settings: { ...(current ?? {}), [def.key]: value } } : w,
      ),
    )
  }

  /** Builder chip label for a settings option (numbers show the unit, booleans the toggle state). */
  function settingChipLabel(def: WidgetSettingDef, opt: number | boolean): string {
    if (def.optionLabel) return def.optionLabel(opt)
    if (typeof opt === 'boolean') return opt ? 'On' : 'Off'
    return `${opt} ${def.unit ?? ''}`.trim()
  }

  function resetToBase() {
    const preset = PRESET_WIDGET_LAYOUTS[dashboard.overviewType]
    if (!preset) {
      toast({ title: 'No base preset', description: `“${dashboard.overviewType}” has no default widget map to reset to.` })
      return
    }
    updateDraft(() => preset.map((w) => ({ ...w })))
    toast({
      title: 'Reset to base layout',
      description: `${dashboard.overviewType} — ${preset.length} widgets restored (not saved yet).`,
      action: (
        <ToastAction altText="Undo reset" onClick={() => undo()} data-testid="toast-undo-reset">
          Undo
        </ToastAction>
      ),
    })
  }

  function save(): boolean {
    if (locked) {
      toast({ title: 'Dashboard is locked', description: 'Unlock it first to modify its layout.' })
      return false
    }
    if (draft.length === 0) {
      toast({ title: 'Nothing to save', description: 'Add at least one widget from the library.' })
      return false
    }
    updateCustomDashboard(dashboard.id, { widgets: draft.map((w) => ({ ...w })) })
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1800)
    toast({ title: 'Layout saved', description: `${draft.length} widgets · ${hiddenCount} hidden — “${dashboard.name}”.` })
    return true
  }

  function saveAndOpen() {
    if (!save()) return
    // Board filter snapshot: re-apply the remembered account + date-range so
    // the Overview opens in the context the board was composed for.
    const freshest = useAppStore.getState().customDashboards.find((d) => d.id === dashboard.id)
    const applied = freshest?.snapshot
    if (applied) applyFilterSnapshot(applied)
    setOverviewType(CUSTOM_LAYOUT_TYPE, dashboard.id)
    navigate('/overview')
    if (applied) {
      toast({ title: 'Board filters applied', description: describeSnapshot(applied) })
    }
  }

  /** Remember the CURRENT top-bar account + range on this board. */
  function captureSnapshot() {
    const snap = captureFilterSnapshot()
    updateCustomDashboard(dashboard.id, { snapshot: snap })
    toast({ title: 'Board filters saved', description: `${describeSnapshot(snap)} — “Save & open” re-applies them.` })
  }

  /** Forget the board's filter snapshot. */
  function clearSnapshot() {
    updateCustomDashboard(dashboard.id, { snapshot: undefined })
    toast({ title: 'Board filters cleared', description: 'The board no longer switches account or date range.' })
  }

  const q = search.trim().toLowerCase()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of draft) m.set(w.widgetId, (m.get(w.widgetId) ?? 0) + 1)
    return m
  }, [draft])

  /** Boards this widget can be copied to — everything except the one being edited. */
  const otherBoards = useMemo(
    () => customDashboards.filter((d) => d.id !== dashboard.id),
    [customDashboards, dashboard.id],
  )

  const ctrlBtn =
    'rounded p-1 transition-colors hover:bg-[var(--chip-bg)] disabled:opacity-30 disabled:hover:bg-transparent'

  /** Effective per-instance values honoring the live resize ghost. */
  const effectiveSpan = (i: number, base: 1 | 2 | 3) => (resizeGhost?.index === i ? resizeGhost.span : base)
  const effectiveHeight = (i: number, base?: number) => (resizeGhost?.index === i ? resizeGhost.heightPx : base)

  /** Insertion indicator styles for the hovered cell edge. */
  function insertStyle(i: number): CSSProperties | undefined {
    if (!insertAt || insertAt.index !== i) return undefined
    const accent = 'var(--shell-accent)'
    const vertical = typeof window !== 'undefined' && window.innerWidth < 768
    return {
      border: `1px solid ${accent}`,
      background: 'color-mix(in srgb, var(--shell-accent) 7%, var(--bg-bar))',
      boxShadow: vertical
        ? `inset 0 ${insertAt.after ? '-' : ''}3px 0 ${accent}`
        : `inset ${insertAt.after ? '-' : ''}3px 0 0 ${accent}`,
    }
  }

  return (
    // NOTE: no `overflow-hidden` here — an overflow-hidden ancestor turns the
    // sticky toolbar/library into no-ops (they stick to the clipped box, not
    // the viewport). Rounded corners are handled on the toolbar itself.
    <div data-testid="dashboard-builder" className="rounded-xl" style={{ border: '1px solid var(--shell-accent)', background: 'var(--bg-bar)' }}>
      {/* ---- resize ruler: viewport-wide crosshair that tracks the dragged edge ---- */}
      {resizeGhost && (
        <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="resize-ruler" aria-hidden>
          {/* horizontal guide — height edges (top/bottom + corners) */}
          {EDGE_V[resizeGhost.edge] !== 0 && (
            <>
              <div
                className="absolute left-0 right-0 border-t border-dashed fade-in"
                style={{ top: resizeGhost.pointerY, borderColor: 'var(--shell-accent)', opacity: 0.65 }}
                data-testid="ruler-line-h"
              />
              <span
                className="absolute rounded px-1.5 py-0.5 text-[9px] font-bold tnum fade-in"
                style={{ top: resizeGhost.pointerY + 8, left: Math.min(resizeGhost.pointerX + 10, (typeof window !== 'undefined' ? window.innerWidth : 0) - 90), background: 'var(--shell-accent)', color: '#fff' }}
                data-testid="ruler-chip-h"
              >
                H {Math.round(resizeGhost.heightPx ?? 0)}px
              </span>
            </>
          )}
          {/* vertical guide — width edges (left/right + corners) */}
          {EDGE_H[resizeGhost.edge] !== 0 && (
            <>
              <div
                className="absolute top-0 bottom-0 border-l border-dashed fade-in"
                style={{ left: resizeGhost.pointerX, borderColor: 'var(--shell-accent)', opacity: 0.65 }}
                data-testid="ruler-line-v"
              />
              <span
                className="absolute rounded px-1.5 py-0.5 text-[9px] font-bold tnum fade-in"
                style={{ left: resizeGhost.pointerX + 8, top: Math.max(resizeGhost.pointerY - 26, 8), background: 'var(--shell-accent)', color: '#fff' }}
                data-testid="ruler-chip-v"
              >
                {resizeGhost.span} col{resizeGhost.span > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      )}
      {/* ---- touch-drag ghost: floating chip that follows the finger ---- */}
      {touchDrag?.active && (
        <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="touch-drag-ghost" aria-hidden>
          <span
            className="absolute h-10 w-10 rounded-full"
            style={{
              left: touchPoint.x - 20,
              top: touchPoint.y - 20,
              background: 'radial-gradient(circle, color-mix(in srgb, var(--shell-accent) 35%, transparent) 0%, transparent 68%)',
            }}
          />
          <div
            className="absolute flex items-center gap-2 rounded-lg px-2.5 py-1.5 fade-in"
            style={{
              left: Math.min(touchPoint.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 0) - 190),
              top: touchPoint.y + 20,
              background: 'var(--bg-bar)',
              border: '1px solid var(--shell-accent)',
              boxShadow: '0 12px 32px -10px rgba(0,0,0,.65), 0 0 0 3px color-mix(in srgb, var(--shell-accent) 22%, transparent)',
            }}
          >
            <GripVertical className="h-3.5 w-3.5" style={{ color: 'var(--shell-accent-hover)' }} />
            <span className="max-w-[150px] truncate text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>
              {touchDrag.label}
            </span>
            <span
              className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide"
              style={{ background: insertAt ? 'var(--shell-accent)' : 'var(--chip-bg)', color: insertAt ? '#fff' : 'var(--text-secondary)' }}
              data-testid="touch-drag-mode"
            >
              {insertAt ? 'insert' : 'end'}
            </span>
          </div>
        </div>
      )}
      {/* ---- sticky toolbar ---- */}
      <div
        className="sticky top-11 z-20 flex flex-wrap items-center gap-2 rounded-t-xl px-4 py-3 backdrop-blur-md"
        style={{ background: 'color-mix(in srgb, var(--bg-bar) 88%, transparent)', borderBottom: '1px solid var(--border-strong)' }}
      >
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={onClose} data-testid="builder-close">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setLibOpen((v) => !v)}
          aria-label={libOpen ? 'Hide widget library' : 'Show widget library'}
          aria-pressed={libOpen}
          title={libOpen ? 'Hide the widget library' : 'Show the widget library'}
          data-testid="builder-lib-toggle"
        >
          {libOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            {dashboard.name}
            {locked && <Lock className="h-3 w-3 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-label="locked" />}
            {dirty && !locked && (
              <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide" style={{ background: 'var(--chip-bg)', color: 'var(--text-secondary)' }}>
                unsaved
              </span>
            )}
            {justSaved && (
              <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide" style={{ background: 'var(--shell-success)', color: 'var(--bg-bar)' }}>
                saved
              </span>
            )}
          </p>
          <p className="text-[11px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
            {draft.filter((w) => !w.hidden).length} visible · {hiddenCount} hidden · base {dashboard.overviewType}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* undo / redo — one segmented pair, keyboard shortcuts in the titles */}
          <div className="flex items-center rounded-md border" style={{ borderColor: 'var(--border-strong)' }} role="group" aria-label="Edit history">
            <button
              type="button"
              onClick={undo}
              disabled={locked || histDepth.undo === 0}
              aria-label="Undo last layout change"
              data-testid="builder-undo"
              title={`Undo (Ctrl+Z) — ${histDepth.undo} step${histDepth.undo === 1 ? '' : 's'} recorded`}
              className={`${ctrlBtn} h-8 w-8 rounded-l-md`}
            >
              <Undo2
                className="mx-auto h-3.5 w-3.5"
                style={{ color: histDepth.undo > 0 && !locked ? 'var(--shell-accent-hover)' : 'var(--text-secondary)' }}
              />
            </button>
            <span aria-hidden className="h-4 w-px" style={{ background: 'var(--border-strong)' }} />
            <button
              type="button"
              onClick={redo}
              disabled={locked || histDepth.redo === 0}
              aria-label="Redo layout change"
              data-testid="builder-redo"
              title={`Redo (Ctrl+Shift+Z) — ${histDepth.redo} step${histDepth.redo === 1 ? '' : 's'} available`}
              className={`${ctrlBtn} h-8 w-8 rounded-r-md`}
            >
              <Redo2
                className="mx-auto h-3.5 w-3.5"
                style={{ color: histDepth.redo > 0 && !locked ? 'var(--shell-accent-hover)' : 'var(--text-secondary)' }}
              />
            </button>
          </div>
          {/* keyboard/mouse shortcuts cheat-sheet */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Builder shortcuts"
                data-testid="builder-shortcuts"
                title="Shortcuts & gestures"
                className={`${ctrlBtn} h-8 w-8`}
              >
                <Keyboard className="mx-auto h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-72 p-3" data-testid="builder-shortcuts-panel">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                Shortcuts &amp; gestures
              </p>
              <ul className="grid gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {[
                  ['Ctrl / ⌘ + Z', 'Undo the last layout change'],
                  ['Ctrl / ⌘ + ⇧ + Z  ·  Ctrl + Y', 'Redo'],
                  ['Drag cell / library row', 'Reorder — drop on a cell edge to insert'],
                  ['Press-and-hold (touch)', 'Long-press ~0.4s, then drag to reposition'],
                  ['Drag any edge or corner', 'Free resize — width snaps to grid columns'],
                  ['Drag below the fold', 'Auto-scroll brings distant widgets in reach'],
                ].map(([k, d]) => (
                  <li key={k} className="flex items-start justify-between gap-2">
                    <span
                      className="shrink-0 rounded px-1.5 py-px font-semibold"
                      style={{ background: 'var(--chip-bg)', color: 'var(--text-primary)' }}
                    >
                      {k}
                    </span>
                    <span className="text-right leading-snug">{d}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
          {/* board filter snapshot — remember / show / forget account + range */}
          {dashboard.snapshot ? (
            <>
              <span
                className="flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold"
                style={{ borderColor: 'var(--shell-accent)', color: 'var(--shell-accent-hover)', background: 'color-mix(in srgb, var(--shell-accent) 8%, transparent)' }}
                data-testid="board-snapshot-chip"
                title="This board remembers its filters — “Save & open” re-applies them"
              >
                <CalendarRange className="h-3.5 w-3.5" />
                <span className="max-w-[190px] truncate">{describeSnapshot(dashboard.snapshot)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={clearSnapshot}
                disabled={locked}
                aria-label="Forget board filters"
                data-testid="board-snapshot-clear"
                title="Forget the board's account + date range"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[11px]"
              onClick={captureSnapshot}
              disabled={locked}
              data-testid="board-snapshot-capture"
              title="Remember the current account + date range on this board — “Save & open” will re-apply them"
            >
              <CalendarRange className="h-3 w-3" />
              Use current filters
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={resetToBase} disabled={locked} data-testid="builder-reset">
            <RotateCcw className="h-3 w-3" />
            Reset to base
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => {
              downloadDashboardJson(dashboard)
              toast({ title: 'Layout exported', description: `“${dashboard.name}” downloaded as JSON — import it on any device.` })
            }}
            data-testid="builder-export"
            title="Download this dashboard as a portable JSON file"
          >
            <Download className="h-3 w-3" />
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[11px]"
            onClick={save}
            disabled={locked || !dirty}
            data-testid="builder-save"
            style={dirty && !locked ? { borderColor: 'var(--shell-accent)', color: 'var(--shell-accent-hover)' } : undefined}
          >
            <Save className="h-3 w-3" />
            Save
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[11px]" onClick={saveAndOpen} disabled={locked} data-testid="builder-save-open">
            <Play className="h-3 w-3" />
            Save &amp; open
          </Button>
        </div>
      </div>

      {/* ---- body: library + canvas ---- */}
      <div className={`grid gap-4 p-4 items-start ${libOpen ? 'lg:grid-cols-[280px_1fr]' : 'grid-cols-1'}`}>
        {/* library — collapsible via the toolbar toggle */}
        {libOpen && (
          <aside
            className="rounded-xl p-3 lg:sticky lg:top-[112px] max-h-[70vh] overflow-y-auto shell-scroll"
            style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
            aria-label="Widget library"
            data-testid="widget-library"
          >
            <div className="mb-2 flex items-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
                Widget library
              </p>
              <button
                onClick={() => setLibOpen(false)}
                className="ml-auto rounded p-1 transition-colors hover:bg-[var(--bg-hover)]"
                aria-label="Hide widget library"
                title="Hide the widget library"
                data-testid="widget-library-collapse"
              >
                <PanelLeftClose className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search widgets…"
                className="h-7 pl-7 text-xs"
                aria-label="Search widgets"
              />
            </div>
            <p className="mb-2 text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              {coarsePointer ? (
                <>
                  Tap to append, or <span style={{ color: 'var(--shell-accent-hover)' }}>press &amp; hold</span> to drag it into place on the canvas.
                </>
              ) : (
                <>
                  Click to append, or <span style={{ color: 'var(--shell-accent-hover)' }}>drag onto the canvas</span> to place it exactly where you want.
                </>
              )}
            </p>
            {WIDGET_CATEGORIES.map((cat) => {
              const defs = WIDGET_DEFS.filter((d) => d.category === cat && (!q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)))
              if (defs.length === 0) return null
              const CatIcon = CATEGORY_ICONS[cat] ?? LayoutGrid
              return (
                <div key={cat} className="mb-3 last:mb-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <CatIcon className="h-3 w-3" aria-hidden />
                    {cat}
                    <span className="ml-auto font-normal tnum" style={{ opacity: 0.7 }}>{defs.length}</span>
                  </p>
                  <div className="grid gap-0.5">
                    {defs.map((def) => {
                      const used = counts.get(def.id) ?? 0
                      return (
                        <button
                          key={def.id}
                          onClick={() => {
                            // Long-press drag committed → the trailing click is a ghost, swallow it.
                            if (suppressLibClickRef.current) {
                              suppressLibClickRef.current = false
                              return
                            }
                            add(def.id)
                          }}
                          draggable={!locked && !coarsePointer}
                          onDragStart={(e) => {
                            if (locked) return
                            dragPayloadRef.current = { kind: 'library', widgetId: def.id }
                            setDragKind('library')
                            e.dataTransfer.effectAllowed = 'copy'
                            e.dataTransfer.setData('text/plain', `lib:${def.id}`)
                            startAutoScroll()
                          }}
                          onDragEnd={clearDrag}
                          onTouchStart={(e) => onLibTouchStart(e, def.id, def.title)}
                          onContextMenu={(e) => {
                            if (touchSessionRef.current) e.preventDefault()
                          }}
                          disabled={locked}
                          data-testid={`lib-${def.id}`}
                          title={coarsePointer ? 'Tap to append · press & hold to drag into place' : 'Click to append · drag onto the canvas to place'}
                          className="touch-drag-source group flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] active:cursor-grabbing disabled:opacity-50"
                        >
                          <IconChip icon={def.icon ?? CatIcon} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{def.title}</span>
                              {used > 0 && (
                                <span className="shrink-0 rounded px-1 text-[9px] font-bold" style={{ background: 'var(--chip-bg)', color: 'var(--text-secondary)' }}>
                                  ×{used}
                                </span>
                              )}
                            </span>
                            <span className="block text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                              {def.description}
                            </span>
                          </span>
                          <Plus className={`mt-0.5 h-3 w-3 shrink-0 transition-opacity ${used > 0 ? 'opacity-40' : 'opacity-0 group-hover:opacity-100'}`} style={{ color: 'var(--shell-accent-hover)' }} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {q && WIDGET_DEFS.every((d) => !d.title.toLowerCase().includes(q) && !d.description.toLowerCase().includes(q)) && (
              <p className="text-xs px-1" style={{ color: 'var(--text-secondary)' }}>No widgets match “{search}”.</p>
            )}
          </aside>
        )}

        {/* canvas */}
        <div
          data-testid="builder-canvas"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {draft.length === 0 ? (
            <div
              className="rounded-xl px-4 py-12 flex flex-col items-center justify-center gap-2 text-center"
              style={{
                border: `1px dashed ${dragKind === 'library' ? 'var(--shell-accent)' : 'var(--border-strong)'}`,
                background: dragKind === 'library' ? 'color-mix(in srgb, var(--shell-accent) 6%, transparent)' : undefined,
              }}
              data-testid="builder-empty"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--bg-hover)' }} aria-hidden>
                <LayoutGrid className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
              </span>
              <p className="text-sm font-semibold">{dragKind === 'library' ? 'Drop to place the widget' : 'Empty canvas'}</p>
              <p className="max-w-md text-xs" style={{ color: 'var(--text-secondary)' }}>
                {dragKind === 'library'
                  ? 'Release to drop the widget here.'
                  : 'Drag widgets here from the library, or press “Reset to base” to start from the arrangement.'}
              </p>
            </div>
          ) : (
            <div
              className="rounded-xl p-3"
              style={{
                border: `1px solid ${dragKind && !insertAt ? 'var(--shell-accent)' : 'var(--border-strong)'}`,
                // NOTE: backgroundColor (not the `background` shorthand) — this
                // element also sets backgroundImage/backgroundSize for the dot
                // grid, and the shorthand would reset them (React conflict
                // warning + the grid silently disappearing after a drag).
                backgroundColor: dragKind && !insertAt ? 'color-mix(in srgb, var(--shell-accent) 4%, var(--bg-content))' : 'var(--bg-content)',
                backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
              }}
            >
              <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 ${libOpen ? '' : 'lg:gap-4'}`}>
                {draft.map((w, i) => {
                  const def = getWidgetDef(w.widgetId)
                  if (!def) return null
                  const span = effectiveSpan(i, w.span)
                  const heightPx = effectiveHeight(i, w.heightPx)
                  const SpanIcon = SPAN_ICON[span]
                  const hasSettings = (def.settingsSchema?.length ?? 0) > 0
                  const settingsOpen = settingsFor === i
                  const settingsActive = def.settingsSchema?.some((sd) => {
                    const v = w.settings?.[sd.key]
                    return (typeof v === 'number' || typeof v === 'boolean') && v !== sd.options[0]
                  })
                  const isDragged = dragFromIndex === i
                  const showInsert = insertAt?.index === i
                  const resizing = resizeGhost?.index === i
                  return (
                    <section
                      key={`${w.widgetId}-${i}`}
                      data-cell
                      draggable={!locked && !resizing && !coarsePointer}
                      onDragStart={(e) => onCellDragStart(e, i)}
                      onDragOver={(e) => onCellDragOver(e, i)}
                      onDrop={(e) => onCellDrop(e, i)}
                      onDragEnd={clearDrag}
                      onTouchStart={(e) => onCellTouchStart(e, i)}
                      onContextMenu={(e) => {
                        // Long-press on touch must not pop the native context menu.
                        if (touchSessionRef.current) e.preventDefault()
                      }}
                      className={`touch-drag-source ${SPAN_CLASS[span]} group/cell relative rounded-xl p-2.5 select-none transition-[border-color,box-shadow] duration-150 ${isDragged ? 'opacity-40' : ''}`}
                      style={{
                        border: `1px ${w.hidden ? 'dashed' : 'solid'} ${showInsert || resizing ? 'var(--shell-accent)' : 'var(--border-strong)'}`,
                        background: showInsert ? 'color-mix(in srgb, var(--shell-accent) 7%, var(--bg-bar))' : 'var(--bg-bar)',
                        opacity: w.hidden && !isDragged ? 0.55 : undefined,
                        boxShadow: resizing
                          ? '0 0 0 2px var(--shell-accent)'
                          : showInsert
                            ? (typeof window !== 'undefined' && window.innerWidth < 768
                                ? `inset 0 ${insertAt!.after ? '-' : ''}3px 0 var(--shell-accent)`
                                : `inset ${insertAt!.after ? '-' : ''}3px 0 0 var(--shell-accent)`)
                            : undefined,
                      }}
                      data-testid={`cell-${w.widgetId}`}
                      data-index={i}
                    >
                      {/* hover + keyboard-focus affordance — accent ring hinting the cell is interactive */}
                      {!showInsert && !resizing && (
                        <div
                          aria-hidden
                          className={`pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-150 ${dragKind ? 'opacity-0' : 'opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100'}`}
                          style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--shell-accent) 38%, transparent)' }}
                        />
                      )}
                      {/* instance toolbar */}
                      <div className="mb-2 flex items-center gap-1 rounded-lg px-1.5 py-1" style={{ background: 'var(--bg-card)' }}>
                        <GripVertical
                          className="h-3 w-3 shrink-0 cursor-grab active:cursor-grabbing"
                          style={{ color: 'var(--border-strong)' }}
                          aria-hidden
                        />
                        <span className="text-[10px] font-bold uppercase tracking-wider truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                          {def.title}
                        </span>
                        {resizing && (
                          <span className="rounded px-1 py-px text-[8px] font-bold tnum" style={{ background: 'var(--shell-accent)', color: '#fff' }} data-testid={`resize-badge-${i}`}>
                            {span} col{span > 1 ? 's' : ''} · {Math.round(heightPx ?? 0)}px
                          </span>
                        )}
                        {w.hidden && (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase" style={{ background: 'var(--chip-bg)', color: 'var(--text-secondary)' }}>
                            hidden
                          </span>
                        )}
                        <button
                          onClick={() => move(i, -1)}
                          disabled={locked || i === 0}
                          aria-label={`Move ${def.title} earlier`}
                          data-testid={`mvup-${i}`}
                          className={ctrlBtn}
                        >
                          <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button
                          onClick={() => move(i, 1)}
                          disabled={locked || i === draft.length - 1}
                          aria-label={`Move ${def.title} later`}
                          data-testid={`mvdown-${i}`}
                          className={ctrlBtn}
                        >
                          <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button
                          onClick={() => patch(i, { span: ((span % 3) + 1) as 1 | 2 | 3 })}
                          disabled={locked}
                          aria-label={`Resize ${def.title} — now ${SPAN_LABEL[span]}`}
                          data-testid={`span-${i}`}
                          title={`Width: ${SPAN_LABEL[span]} (click to change) · drag the side edges for free width`}
                          className={ctrlBtn}
                        >
                          <SpanIcon className="h-3.5 w-3.5" style={{ color: 'var(--shell-accent-hover)' }} />
                        </button>
                        <button
                          onClick={() => patch(i, { size: SIZE_ORDER[(SIZE_ORDER.indexOf(w.size as WidgetSizeId) + 1) % 3], heightPx: undefined })}
                          disabled={locked}
                          aria-label={`Density ${def.title} — now ${SIZE_LABEL[w.size as WidgetSizeId]}`}
                          data-testid={`size-${i}`}
                          title={`Density: ${SIZE_LABEL[w.size as WidgetSizeId]}${w.heightPx ? ` · free height ${w.heightPx}px (clicking a density resets it)` : ' (click to change) · drag the top/bottom edges for free height'}`}
                          className="rounded px-1.5 h-5 text-[9px] font-bold uppercase transition-colors hover:bg-[var(--chip-bg)] disabled:opacity-30"
                          style={{ color: w.heightPx ? 'var(--shell-accent-hover)' : 'var(--text-secondary)' }}
                        >
                          {w.size === 'compact' ? 'C' : w.size === 'standard' ? 'S' : 'T'}
                        </button>
                        <button
                          onClick={() => setSettingsFor(settingsOpen ? null : i)}
                          disabled={locked || !hasSettings}
                          aria-label={`Configure ${def.title}`}
                          aria-expanded={settingsOpen}
                          data-testid={`cfg-${i}`}
                          title={hasSettings ? 'Widget settings' : 'No settings for this widget'}
                          className={ctrlBtn}
                        >
                          <SlidersHorizontal
                            className="h-3.5 w-3.5"
                            style={{ color: settingsActive ? 'var(--shell-accent-hover)' : settingsOpen ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                          />
                        </button>
                        <button
                          onClick={() => duplicateAt(i)}
                          disabled={locked}
                          aria-label={`Duplicate ${def.title}`}
                          data-testid={`dup-${i}`}
                          title="Duplicate this widget — an identical copy is inserted right after it"
                          className={ctrlBtn}
                        >
                          <Copy className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        {otherBoards.length > 0 && (
                          <Popover open={copyFor === i} onOpenChange={(o) => setCopyFor(o ? i : null)}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                disabled={locked}
                                aria-label={`Copy ${def.title} to another board`}
                                aria-expanded={copyFor === i}
                                data-testid={`copyboard-${i}`}
                                title="Copy to another board — appends an identical instance to that board's saved layout"
                                className={ctrlBtn}
                              >
                                <FolderInput className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="end" className="w-64 p-2" data-testid={`copyboard-panel-${i}`}>
                              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                Copy “{def.title}” to…
                              </p>
                              {otherBoards.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  disabled={b.locked}
                                  onClick={() => copyToBoard(i, b.id)}
                                  data-testid={`copyboard-target-${b.id}`}
                                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                                  style={{ color: 'var(--text-primary)' }}
                                >
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    {b.locked && <Lock className="h-3 w-3 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-label="locked" />}
                                    <span className="truncate font-semibold">{b.name}</span>
                                  </span>
                                  <span className="shrink-0 text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
                                    {b.widgets?.length ?? 0} widget{(b.widgets?.length ?? 0) === 1 ? '' : 's'}
                                  </span>
                                </button>
                              ))}
                              {otherBoards.every((b) => b.locked) && (
                                <p className="px-2 py-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                  All other boards are locked — unlock one first.
                                </p>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                        <button
                          onClick={() => patch(i, { hidden: !w.hidden })}
                          disabled={locked}
                          aria-label={w.hidden ? `Show ${def.title}` : `Hide ${def.title}`}
                          data-testid={`eye-${i}`}
                          className={ctrlBtn}
                        >
                          {w.hidden ? <EyeOff className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} /> : <Eye className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />}
                        </button>
                        <button
                          onClick={() => removeAt(i)}
                          disabled={locked}
                          aria-label={`Remove ${def.title}`}
                          data-testid={`rm-${i}`}
                          className={ctrlBtn}
                        >
                          <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--shell-danger)' }} />
                        </button>
                      </div>
                      {/* inline settings row — per-instance knobs */}
                      {settingsOpen && hasSettings && !locked && (
                        <div
                          className="mb-2 rounded-lg px-2.5 py-2 grid gap-1.5 fade-in"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)' }}
                          data-testid={`settings-${i}`}
                        >
                          {def.settingsSchema!.map((sd) => {
                            const currentValue =
                              w.settings?.[sd.key] !== undefined && sd.options.includes(w.settings[sd.key] as never)
                                ? w.settings[sd.key]
                                : sd.options[0]
                            return (
                              <div key={sd.key} className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                  {sd.label}
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {sd.options.map((opt) => {
                                    const activeOpt = opt === currentValue
                                    return (
                                      <button
                                        key={String(opt)}
                                        onClick={() => setSetting(i, sd, opt, w.settings)}
                                        data-testid={`set-${i}-${sd.key}-${String(opt)}`}
                                        aria-pressed={activeOpt}
                                        className="rounded px-1.5 py-0.5 text-[10px] font-bold tnum transition-colors"
                                        style={{
                                          background: activeOpt ? 'var(--shell-accent)' : 'var(--bg-hover)',
                                          color: activeOpt ? '#fff' : 'var(--text-secondary)',
                                        }}
                                      >
                                        {settingChipLabel(sd, opt)}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {/* live preview through the shared registry — this box is what edge-resize measures */}
                      <div
                        ref={(el) => { contentRefs.current[i] = el }}
                        className="relative"
                        style={heightPx ? { minHeight: heightPx } : undefined}
                        data-testid={`content-${i}`}
                      >
                        {def.render({ stats, trades, settings: w.settings, heightPx }, w.size as WidgetSizeId)}
                      </div>

                      {/* ---- resize handles: 4 edges + 4 corners ---- */}
                      {!locked && (
                        <>
                          {(['left', 'right'] as const).map((edge) => (
                            <span
                              key={edge}
                              onPointerDown={(e) => onResizePointerDown(e, i, edge)}
                              onPointerMove={onResizePointerMove}
                              onPointerUp={onResizePointerUp}
                              onPointerCancel={onResizePointerUp}
                              className={`absolute inset-y-2 ${edge === 'left' ? '-left-[5px]' : '-right-[5px]'} w-[9px] z-10 touch-none ${RESIZE_CURSOR[edge]} group/rz opacity-0 group-hover/cell:opacity-100 transition-opacity`}
                              data-testid={`rz-${i}-${edge}`}
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Resize ${def.title} width — drag to widen or narrow`}
                            >
                              <span
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-1 rounded-full transition-colors group-hover/rz:bg-[var(--shell-accent)]"
                                style={{ background: 'var(--border-strong)' }}
                              />
                            </span>
                          ))}
                          {(['top', 'bottom'] as const).map((edge) => (
                            <span
                              key={edge}
                              onPointerDown={(e) => onResizePointerDown(e, i, edge)}
                              onPointerMove={onResizePointerMove}
                              onPointerUp={onResizePointerUp}
                              onPointerCancel={onResizePointerUp}
                              className={`absolute inset-x-3 ${edge === 'top' ? '-top-[5px]' : '-bottom-[5px]'} h-[9px] z-10 touch-none ${RESIZE_CURSOR[edge]} group/rz opacity-0 group-hover/cell:opacity-100 transition-opacity`}
                              data-testid={`rz-${i}-${edge}`}
                              role="separator"
                              aria-orientation="horizontal"
                              aria-label={`Resize ${def.title} height — drag to grow or shrink`}
                            >
                              <span
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-1 rounded-full transition-colors group-hover/rz:bg-[var(--shell-accent)]"
                                style={{ background: 'var(--border-strong)' }}
                              />
                            </span>
                          ))}
                          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                            <span
                              key={corner}
                              onPointerDown={(e) => onResizePointerDown(e, i, corner)}
                              onPointerMove={onResizePointerMove}
                              onPointerUp={onResizePointerUp}
                              onPointerCancel={onResizePointerUp}
                              className={`absolute h-3.5 w-3.5 z-10 touch-none ${RESIZE_CURSOR[corner]} ${
                                corner === 'nw' ? '-left-[4px] -top-[4px]' : corner === 'ne' ? '-right-[4px] -top-[4px]' : corner === 'sw' ? '-left-[4px] -bottom-[4px]' : '-right-[4px] -bottom-[4px]'
                              } opacity-0 group-hover/cell:opacity-100 transition-opacity`}
                              data-testid={`rz-${i}-${corner}`}
                              aria-label={`Resize ${def.title} in both directions`}
                            >
                              <span
                                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] transition-colors group-hover/cell:bg-[var(--shell-accent)]"
                                style={{ background: 'var(--border-strong)' }}
                              />
                            </span>
                          ))}
                        </>
                      )}
                    </section>
                  )
                })}
              </div>
              {/* drop-at-end hint while dragging over empty canvas space */}
              {dragKind && !insertAt && (
                <p
                  className="pointer-events-none sticky bottom-0 mx-auto mt-2 w-fit rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider fade-in"
                  style={{ background: 'var(--shell-accent)', color: '#fff' }}
                  data-testid="canvas-drop-hint"
                >
                  {dragKind === 'library' ? 'Release to place at the end' : 'Release to move to the end'}
                </p>
              )}
            </div>
          )}
          {/* status line */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {locked ? (
              <p className="flex items-center gap-1.5">
                <Lock className="h-3 w-3" />
                Locked — controls are read-only. Unlock from the list above to edit.
              </p>
            ) : (
              <p>
                Everything above renders with your live account data — the Overview page shows exactly this arrangement.
              </p>
            )}
            {!locked && draft.length > 0 && (
              <span className="tnum">
                {draft.length} placed · {hiddenCount} hidden ·{' '}
                {coarsePointer ? 'press & hold a widget to drag it · drag edges to resize' : 'drag cells to reorder · drag edges to resize'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
