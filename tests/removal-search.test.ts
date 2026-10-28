/**
 * TP2 — Removal completeness test (build prompt 2, testing §9).
 *
 * Searches the repository for every removed name and FAILS if one is found
 * outside the allowed homes (migration files, worklog notes, this test).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SEARCH_ROOTS = ['src', 'scripts', 'prisma']
const SKIP_DIRS = new Set(['node_modules', '.next', 'tool-results', 'upload', 'uploads', 'skills'])

/** Names that must no longer appear anywhere in shipped code. */
const REMOVED_NAMES = [
  // library
  'plan-checklist',
  'plan-rules-engine',
  'plan-check-runner',
  // projected tables / engine artifacts
  'PlanRule',
  'RuleCheckResult',
  'TradeChecklist',
  'db.tradeChecklist',
  'db.planRule',
  'db.ruleCheckResult',
  // dropped trade columns
  'checklistId',
  'planItems',
  // dropped Mistake column
  'ruleKey',
  // removed routes (checked with word boundaries below)
  'check-all',
]

/** Files where a hit is allowed (this test, the migration, the worklog). */
function isAllowed(rel: string): boolean {
  if (rel.startsWith('tests/')) return true
  if (rel.includes('tp2-drop-removed-tables')) return true
  if (rel.startsWith('worklog')) return true
  return false
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) listFiles(full, out)
    else if (/\.(ts|tsx|js|jsx|prisma|sql)$/.test(name)) out.push(full)
  }
  return out
}

describe('TP2 removal completeness', () => {
  it('finds none of the removed names in shipped code', () => {
    const offenders: string[] = []
    for (const root of SEARCH_ROOTS) {
      for (const file of listFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file)
        if (isAllowed(rel)) continue
        const content = readFileSync(file, 'utf8')
        for (const name of REMOVED_NAMES) {
          if (name === 'ruleKey' || name === 'planItems' || name === 'checklistId' || name === 'check-all') {
            // word-boundary match for the bare-column names
            const re = new RegExp(`\\b${name}\\b`)
            if (re.test(content)) offenders.push(`${rel}: ${name}`)
          } else if (content.includes(name)) {
            offenders.push(`${rel}: ${name}`)
          }
        }
      }
    }
    expect(offenders, `Removed names still present:\n${offenders.join('\n')}`).toEqual([])
  })
})
