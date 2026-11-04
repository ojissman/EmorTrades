// Task 99 — shared session-start baseline for the GLOBAL FILTER
// change-indicators (the amber "changed this session" dots, introduced on
// the palette footer chips in Task 98 and extended to the top bar here).
//
// Module scope survives React remounts and the palette's unmount-on-close
// cycle; a full page reload — a fresh session — resets it. First caller
// wins: the TOP BAR mounts at app start and seeds the true session-start
// values, so the palette's later capture is a no-op and BOTH surfaces
// diff against the same reference.
//
// Raw filter fields are stored (not the display label) so a reset can
// write them back verbatim through the same setters the apply paths use.
import type { FilterState } from '@/store/filter-store'

export interface SessionBaseline {
  account: string
  dateRange: FilterState['dateRange']
  customStartDate?: string
  customEndDate?: string
  /** PRESET-CHIP (2026-11-04) — the preset active at session start, so the
   *  "was <preset>" tooltip and the session-start restore keep the preset
   *  WORDING, and a reset re-stamps the preset identity. */
  presetKey?: FilterState['presetKey']
}

let baseline: SessionBaseline | null = null

export function captureSessionBaseline(b: SessionBaseline): SessionBaseline {
  if (!baseline) baseline = b
  return baseline
}
