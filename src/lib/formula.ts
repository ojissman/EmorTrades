/**
 * ============================================================================
 * FORMULA ENGINE — custom trade columns (Task 156)
 * ============================================================================
 * A tiny, SAFE expression evaluator for the Trades grid's "Custom Columns"
 * (Action menu ▸ Custom Columns). No eval / no Function constructor — a
 * classic tokenizer + shunting-yard → RPN walk over arithmetic only:
 *
 *   [Open Price] * [Qty] - [Fees] - [Commission]
 *   ([Close Price] - [Open Price]) / [Open Price] * 100
 *
 * Operators: + - * / ( ) with standard precedence and unary minus.
 * Operands:  numeric literals and [Field] tokens (case-insensitive).
 * Null propagation: any missing field makes the whole expression null (the
 * cell renders "—") — never NaN/Infinity in a cell.
 */

export type CustomColumnFormat = 'currency' | 'number' | 'percent'

export interface CustomColumn {
  /** Stable local id (colId is `custom-<id>`). */
  id: string
  name: string
  format: CustomColumnFormat
  formula: string
}

/** The [Field] tokens a formula may use + what they resolve to on a trade. */
export const FORMULA_VARIABLES: { token: string; label: string }[] = [
  { token: 'Open Price', label: 'Trade open price ($)' },
  { token: 'Close Price', label: 'Trade close price ($)' },
  { token: 'Qty', label: 'Quantity (shares/units)' },
  { token: 'Volume', label: 'Total volume (same as Qty)' },
  { token: 'PnL', label: 'Realized PnL ($)' },
  { token: 'PnL %', label: 'PnL percent' },
  { token: 'R', label: 'R-Value' },
  { token: 'Fees', label: 'Total fees ($)' },
  { token: 'Commission', label: 'Total commission ($)' },
  { token: 'Duration Min', label: 'Holding duration (minutes)' },
  { token: 'Stop Loss', label: 'Stop loss ($)' },
  { token: 'Profit Target', label: 'Profit target ($)' },
  { token: 'MFE', label: 'Maximum favorable excursion ($)' },
  { token: 'MAE', label: 'Maximum adverse excursion ($)' },
  // Task 179 — futures contract multiplier (P&L = move × qty × multiplier)
  { token: 'Multiplier', label: 'Contract multiplier (futures)' },
]

const VAR_LOOKUP = new Map(FORMULA_VARIABLES.map((v) => [v.token.toLowerCase(), v.token]))

/** Quick starter formulas offered in the dialog. */
export const FORMULA_PRESETS: { name: string; format: CustomColumnFormat; formula: string }[] = [
  { name: 'PnL per Share', format: 'currency', formula: '[PnL] / [Qty]' },
  { name: 'Cost Basis', format: 'currency', formula: '[Open Price] * [Qty]' },
  // AUDIT M7 — [PnL] is ALREADY net of fees + commission (write-time math),
  // so the old "Net after Costs" ([PnL] − [Fees] − [Commission]) subtracted
  // the costs TWICE. Gross adds them back — what the trade made before costs.
  { name: 'Gross P&L (before costs)', format: 'currency', formula: '[PnL] + [Fees] + [Commission]' },
  { name: 'Fees + Commission', format: 'currency', formula: '[Fees] + [Commission]' },
  { name: 'Risk to Stop', format: 'currency', formula: '([Open Price] - [Stop Loss]) * [Qty] * [Multiplier]' },
  { name: 'Reward to Target', format: 'currency', formula: '([Profit Target] - [Open Price]) * [Qty] * [Multiplier]' },
  { name: 'Return on Cost %', format: 'percent', formula: '[PnL] / ([Open Price] * [Qty] * [Multiplier]) * 100' },
]

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' }

function tokenize(src: string): Tok[] | string {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '[') {
      const end = src.indexOf(']', i + 1)
      if (end === -1) return 'Unclosed bracket — expected a closing "]"'
      const name = src.slice(i + 1, end).trim()
      if (!name) return 'Empty bracket — put a field name inside [ ]'
      toks.push({ t: 'var', name })
      i = end + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v) || /\..*\./.test(src.slice(i, j))) return `Bad number "${src.slice(i, j)}"`
      toks.push({ t: 'num', v })
      i = j
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
      toks.push({ t: 'op', v: ch })
      i += 1
      continue
    }
    return `Unexpected character "${ch}" — use numbers, [Field] tokens and + - * / ( )`
  }
  if (toks.length === 0) return 'Formula is empty'
  return toks
}

/* ------------------------------------------------------------------ */
/* Shunting-yard → RPN, then evaluate                                  */
/* ------------------------------------------------------------------ */

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

interface RpnNum {
  t: 'num'
  v: number
}
interface RpnVar {
  t: 'var'
  name: string
}
interface RpnOp {
  t: 'op'
  v: '+' | '-' | '*' | '/' | 'u-'
}
type RpnTok = RpnNum | RpnVar | RpnOp

/** Operator-stack token (adds the synthetic unary minus). */
type OpTok = { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' | 'u-' }

function toRpn(toks: Tok[]): RpnTok[] | string {
  const out: RpnTok[] = []
  const stack: OpTok[] = []
  let prev: Tok | null = null

  const isUnaryContext = () => {
    if (!prev) return true
    if (prev.t === 'op' && prev.v !== ')') return true
    return false
  }

  for (const tok of toks) {
    if (tok.t === 'num' || tok.t === 'var') {
      out.push(tok.t === 'num' ? { t: 'num', v: tok.v } : { t: 'var', name: tok.name })
    } else if (tok.v === '(') {
      stack.push({ t: 'op', v: '(' })
    } else if (tok.v === ')') {
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.v === '(') break
        out.push(popOp(stack))
      }
      if (!stack.length) return 'Unbalanced ")"'
      stack.pop() // drop the "("
    } else {
      // operator — detect unary minus (start, or after an operator / "(")
      if (tok.v === '-' && isUnaryContext()) {
        stack.push({ t: 'op', v: 'u-' })
      } else {
        while (stack.length) {
          const top = stack[stack.length - 1]
          if (top.v === '(') break
          const topPrec = top.v === 'u-' ? 3 : PREC[top.v as '+' | '-' | '*' | '/']
          if (topPrec >= PREC[tok.v as '+' | '-' | '*' | '/']) out.push(popOp(stack))
          else break
        }
        stack.push({ t: 'op', v: tok.v as '+' | '-' | '*' | '/' })
      }
    }
    prev = tok
  }
  while (stack.length) {
    if (stack[stack.length - 1].v === '(') return 'Unbalanced "("'
    out.push(popOp(stack))
  }
  return out
}

function popOp(stack: OpTok[]): RpnTok {
  const t = stack.pop()!
  return t.v === 'u-' ? { t: 'op', v: 'u-' } : { t: 'op', v: t.v as '+' | '-' | '*' | '/' }
}

/** True when the token stream is structurally a valid RPN program. */
function checkRpnShape(rpn: RpnTok[]): string | null {
  let depth = 0
  for (const tok of rpn) {
    if (tok.t === 'num' || tok.t === 'var') depth += 1
    else if (tok.v === 'u-') {
      if (depth < 1) return 'Dangling "-" — missing a value before it'
    } else {
      if (depth < 2) return `Dangling "${tok.v}" — missing a value on one side`
      depth -= 1
    }
  }
  if (depth !== 1) return 'Incomplete formula — too few values'
  return null
}

export interface FormulaFieldNames {
  ok: true
  fields: string[]
}
export interface FormulaError {
  ok: false
  error: string
}

/** Parse-only check. Returns the referenced field names or an error message. */
export function validateFormula(src: string): FormulaFieldNames | FormulaError {
  const toks = tokenize(src)
  if (typeof toks === 'string') return { ok: false, error: toks }
  const rpn = toRpn(toks)
  if (typeof rpn === 'string') return { ok: false, error: rpn }
  const shapeErr = checkRpnShape(rpn)
  if (shapeErr) return { ok: false, error: shapeErr }
  const unknown = rpn
    .filter((t): t is RpnVar => t.t === 'var')
    .map((t) => t.name)
    .filter((name) => !VAR_LOOKUP.has(name.toLowerCase()))
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown field [${unknown[0]}] — available: ${FORMULA_VARIABLES.map((v) => `[${v.token}]`).join(' ')}`,
    }
  }
  return { ok: true, fields: rpn.filter((t): t is RpnVar => t.t === 'var').map((t) => t.name) }
}

/**
 * Evaluate a formula. `resolve` maps a field name to a number (or null when
 * the trade has no such value). Returns null whenever any operand is null,
 * a division by zero happens, or the result is not finite.
 */
export function evaluateFormula(
  src: string,
  resolve: (fieldName: string) => number | null
): number | null {
  const check = validateFormula(src)
  if (!check.ok) return null
  const toks = tokenize(src) as Exclude<Tok[], string>
  const rpn = toRpn(toks) as RpnTok[]
  const st: (number | null)[] = []
  for (const tok of rpn) {
    if (tok.t === 'num') st.push(tok.v)
    else if (tok.t === 'var') st.push(resolve(tok.name))
    else if (tok.v === 'u-') {
      const a = st.pop() ?? null
      st.push(a == null ? null : -a)
    } else {
      const b = st.pop() ?? null
      const a = st.pop() ?? null
      if (a == null || b == null) {
        st.push(null)
        continue
      }
      let r: number
      switch (tok.v) {
        case '+':
          r = a + b
          break
        case '-':
          r = a - b
          break
        case '*':
          r = a * b
          break
        case '/':
          r = b === 0 ? NaN : a / b
          break
      }
      st.push(Number.isFinite(r) ? r : null)
    }
  }
  const result = st[0]
  return result == null || !Number.isFinite(result) ? null : result
}

/* ------------------------------------------------------------------ */
/* Trade → formula variables                                           */
/* ------------------------------------------------------------------ */

const nOrNull = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Map a trade row onto the [Field] tokens (shared by grid + dialog preview). */
export function tradeFormulaVars(t: any): (fieldName: string) => number | null {
  const durationMin = (() => {
    if (t?.entryTime && t?.exitTime) {
      const ms = new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()
      if (Number.isFinite(ms)) return ms / 60000
    }
    return typeof t?.holdingPeriod === 'number' ? t.holdingPeriod : null
  })()
  const map: Record<string, number | null> = {
    'open price': nOrNull(t?.entryPrice),
    'close price': nOrNull(t?.exitPrice),
    qty: nOrNull(t?.quantity),
    volume: nOrNull(t?.quantity),
    pnl: nOrNull(t?.pnl),
    'pnl %': nOrNull(t?.pnlPercent),
    r: nOrNull(t?.rMultiple),
    fees: nOrNull(t?.fees),
    commission: nOrNull(t?.commission),
    'duration min': durationMin,
    'stop loss': nOrNull(t?.stopLoss),
    'profit target': nOrNull(t?.takeProfit),
    mfe: nOrNull(t?.mfe),
    mae: nOrNull(t?.mae),
    // Task 179 — defaults to 1 (stocks/forex/crypto/multi-leg rollups)
    multiplier: typeof t?.multiplier === 'number' && t.multiplier > 0 ? t.multiplier : 1,
  }
  return (name: string) => map[name.toLowerCase()] ?? null
}
