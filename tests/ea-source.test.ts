/**
 * EA source regression guards — CONNECT-3 + CONNECT-4.
 *
 * CONNECT-3 (the overload pin): the owner's 2026 MetaEditor build offers
 * exactly TWO WebRequest overloads (from its own compiler error report,
 * 2026-11-19):
 *
 *   int WebRequest(const string,const string,const string,const string,
 *                  int,const uchar&[],int,uchar&[],string&)   // 9 params (cookie+referer+data_size)
 *   int WebRequest(const string,const string,const string,int,
 *                  const uchar&[],uchar&[],string&)            // 7 params (headers, NO data_size)
 *
 * The classic 8-parameter form (with data_size) does NOT exist in that
 * build — v1.0.1 used it and failed to compile ("wrong parameters count",
 * twice, at the HttpPost call). v1.0.2+ pins the MT5 call to the 7-param
 * overload; MT4 keeps the 8-param form, which is MQL4's documented
 * signature (MT4's frozen compiler still wants exactly that).
 *
 * CONNECT-4 (the diagnosability pin): the owner's first live attach
 * (2026-11-19) sat on "status: starting" for 10 minutes because WebRequest
 * was terminal-blocked (the URL was not in Tools→Options→Expert
 * Advisors→"Allow WebRequest for listed URL") and the failure reason
 * lived only in the Experts log — invisible on the chart panel. v1.0.3
 * (MT5) / v1.0.2 (MT4) must keep the panel self-diagnosing: last HTTP
 * status + decoded err (4014 = allow-list) + server URL + token
 * fingerprint + attempts/retry countdown, a ≤60 s retry cap while
 * unpaired, and token paste-trimming. These tests pin all of it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const mt5 = readFileSync(join(ROOT, 'public/downloads/EmorTradesAutoSync-MT5.mq5'), 'utf8')
const mt4 = readFileSync(join(ROOT, 'public/downloads/EmorTradesAutoSync-MT4.mq4'), 'utf8')

/**
 * Extract the argument list of the single `WebRequest("POST", ...)` call.
 * Scans to the matching ')' with paren/bracket depth. Safe against the
 * pinned argument lists: their string literals contain no parens/brackets.
 */
function webRequestArgs(source: string): string[] {
  const marker = 'WebRequest("POST"'
  expect(source.split(marker).length - 1, 'exactly one WebRequest call site').toBe(1)
  const callIdx = source.indexOf(marker)
  const open = callIdx + 'WebRequest'.length // the '(' right before "POST"
  expect(source[open]).toBe('(')
  let depth = 1
  let end = -1
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  expect(end, 'the call has a matching close paren').toBeGreaterThan(open)
  return source
    .slice(open + 1, end)
    .replace(/\s+/g, ' ')
    .split(',')
    .map((a) => a.trim())
}

describe('CONNECT-3: MT5 EA uses the 7-parameter WebRequest overload', () => {
  const args = webRequestArgs(mt5)

  it('passes exactly 7 arguments — the only count the owner’s 2026 compiler accepts for a headers call', () => {
    // 8 args (v1.0.1, the removed data_size form) and 9 args (cookie/referer
    // form, drops custom headers) are the two wrong shapes for this call.
    expect(args).toHaveLength(7)
  })

  it('pins the exact argument list (string,string,string,int,uchar[],uchar[],string)', () => {
    expect(args).toEqual([
      '"POST"', // 1  const string    method
      'InpBaseUrl + path', // 2  const string    url
      'headers', // 3  const string    headers (Content-Type + x-connector-token)
      'HTTP_TIMEOUT_MS', // 4  int             timeout
      'dataArr', // 5  const uchar&[]  body bytes
      'resultArr', // 6  uchar&[]        response bytes
      'resultHeaders', // 7  string&         response headers
    ])
  })

  it('does not pass a data_size argument (the 8-param overload the build removed)', () => {
    expect(args).not.toContain('bytes')
  })

  it('keeps the exact-resize discipline — the whole array IS the payload (no trailing NUL)', () => {
    // With no data_size argument the overload sends the WHOLE array, so the
    // file must keep: UTF-8 convert → trailing-NUL strip → ArrayResize,
    // all before the call.
    const convert = mt5.indexOf('StringToCharArray(body, dataArr, 0, -1, CP_UTF8)')
    const nulStrip = mt5.indexOf('if(bytes > 0 && dataArr[bytes - 1] == 0) bytes--')
    const resize = mt5.indexOf('ArrayResize(dataArr, bytes)')
    const call = mt5.indexOf('WebRequest("POST"')
    expect(convert).toBeGreaterThan(-1)
    expect(nulStrip).toBeGreaterThan(convert)
    expect(resize).toBeGreaterThan(nulStrip)
    expect(call).toBeGreaterThan(resize)
  })

  it('keeps the version triplet consistent (1.0.5 / "1.05" / "1.0.5")', () => {
    expect(mt5).toMatch(/Version 1\.0\.5 · CONNECT-6/)
    expect(mt5).toMatch(/#property version   "1\.05"/)
    expect(mt5).toMatch(/#define EA_VERSION          "1\.0\.5"/)
  })
})

describe('CONNECT-3: MT4 EA keeps MQL4’s documented 8-parameter form', () => {
  const args = webRequestArgs(mt4)

  it('passes exactly 8 arguments — MQL4’s documented signature (with data_size)', () => {
    expect(args).toHaveLength(8)
  })

  it('pins the exact argument list', () => {
    expect(args).toEqual([
      '"POST"', // 1  const string    method
      'InpBaseUrl + path', // 2  const string    url
      'headers', // 3  const string    headers
      'HTTP_TIMEOUT_MS', // 4  int             timeout
      'dataArr', // 5  const uchar&[]  body bytes
      'bytes', // 6  int             data_size
      'resultArr', // 7  uchar&[]       response bytes
      'resultHeaders', // 8  string&        response headers
    ])
  })

  it('keeps the version triplet consistent (1.0.4 / "1.04" / "1.0.4")', () => {
    expect(mt4).toMatch(/Version 1\.0\.4 · CONNECT-6/)
    expect(mt4).toMatch(/#property version   "1\.04"/)
    expect(mt4).toMatch(/#define EA_VERSION          "1\.0\.4"/)
  })
})

describe('CONNECT-4: both EAs surface pairing failures on the chart panel (never silent)', () => {
  for (const [name, src] of [
    ['MT5', mt5],
    ['MT4', mt4],
  ] as const) {
    describe(name, () => {
      it('StatusText renders the diagnostics lines: server, token, last, attempts/retry', () => {
        expect(src).toContain('server: %s · token: %s')
        expect(src).toContain('last: %s%s')
        expect(src).toContain('attempts: %d · retry in %d s')
      })

      it('HttpPost records the last HTTP status + GetLastError into panel globals right after the call', () => {
        const call = src.indexOf('WebRequest("POST"')
        const recHttp = src.indexOf('g_lastHttp    = status;')
        const recErr = src.indexOf('g_lastErrCode = (status == -1) ? GetLastError() : 0;')
        expect(call).toBeGreaterThan(-1)
        expect(recHttp).toBeGreaterThan(call)
        expect(recErr).toBeGreaterThan(recHttp)
      })

      it('decodes err 4014 to the exact terminal remedy (the allow-list, with the server URL riding along)', () => {
        expect(src).toContain('err == 4014')
        expect(src).toMatch(/Allow WebRequest for listed URL/)
        // the remedy must embed InpBaseUrl so the panel shows the exact URL to allow
        expect(src).toMatch(/add " \+ InpBaseUrl \+ ", click OK/)
      })

      it('caps the retry back-off at 60 s while unpaired (600 s only after pairing)', () => {
        expect(src).toContain('int cap = (g_paired || g_stopped) ? 600 : 60;')
      })

      it('trims the pasted token (a stray space/newline would otherwise fail every call)', () => {
        expect(src).toContain('StringTrimLeft(g_token);')
        expect(src).toContain('StringTrimRight(g_token);')
      })

      it('shows a token fingerprint (never the full secret) and counts pairing attempts', () => {
        expect(src).toContain('string TokenFingerprint()')
        expect(src).toContain('g_pairAttempts++;')
      })
    })
  }

  it('MT4 additionally decodes 4060 (MQL4’s “function not allowed” family) to the same remedy', () => {
    expect(mt4).toContain('err == 4014 || err == 4060')
  })
})

describe('CONNECT-5: the sync pipeline cannot silently die (the live incident pins)', () => {
  // The owner's live attach (2026-11-19, EA v1.0.3, MetaQuotes-Demo
  // 115890520) paired and then synced NOTHING for hours: MT5's
  // ORDER_VOLUME_CURRENT (the REMAINING volume) reads 0 for every
  // fully-filled order, the EA sent it as BOTH requestedVolume and
  // filledVolume, the server's validator rejected the whole batch (422),
  // the durable queue never drained, and the heartbeat — which ran AFTER
  // the flush — was starved, so the card froze on pair-time data
  // ("Connected · Never synced · Queue 0") and the "Sync now" nudge never
  // reached the EA. These pins keep every link of that chain fixed.

  it('MT5 order builders read ORDER_VOLUME_INITIAL for the requested volume (not the remaining volume)', () => {
    expect(mt5).toContain('HistoryOrderGetDouble(ticket, ORDER_VOLUME_INITIAL)')
    expect(mt5).toContain('OrderGetDouble(ORDER_VOLUME_INITIAL)')
    // v1.0.3's defect must not come back: CURRENT as BOTH volume fields
    const historyOrderJson = mt5.slice(mt5.indexOf('string HistoryOrderJson'))
    const liveOrderJson = mt5.slice(mt5.indexOf('string OrderStateJson'))
    expect(historyOrderJson.indexOf('ORDER_VOLUME_CURRENT'), 'ORDER_VOLUME_CURRENT may appear only as the remaining-volume read').toBeGreaterThan(-1)
    expect(liveOrderJson).toContain('OrderGetDouble(ORDER_VOLUME_CURRENT)')
  })

  it('MT5 filled = INITIAL − CURRENT (what actually filled, floored at 0)', () => {
    expect(mt5).toContain('MathMax(volReq - volRem, 0.0)')
    expect(mt5).toContain('if(volReq <= 0.0) volReq = volRem;')
  })

  it('both EAs send the heartbeat BEFORE the flush (a failing flush must never starve the control channel)', () => {
    for (const [name, src] of [
      ['MT5', mt5],
      ['MT4', mt4],
    ] as const) {
      const onTimer = src.slice(src.indexOf('void OnTimer()'))
      const beat = onTimer.indexOf('DoHeartbeat();')
      const flush = onTimer.indexOf('FlushQueue("live")')
      expect(beat, `${name}: OnTimer must call DoHeartbeat`).toBeGreaterThan(-1)
      expect(flush, `${name}: OnTimer must call FlushQueue("live")`).toBeGreaterThan(-1)
      expect(beat, `${name}: the beat must come before the flush`).toBeLessThan(flush)
    }
  })

  it('both EAs re-check g_stopped right after the heartbeat (a beat can carry a disconnect)', () => {
    expect(mt5).toContain('if(g_stopped) return; // the beat may have carried a disconnect request')
    expect(mt4).toContain('if(g_stopped) return; // the beat may have carried a disconnect request')
  })
})

describe('CONNECT-6: a 409 never kills the EA (stale binding ≠ server disconnect)', () => {
  // The owner's terminal wedged for good: a token rotated on a retired
  // (superseded) card stayed bound to that dead row, every flush 422/409'd,
  // and v1.0.4's FlushQueue treated ANY 409 as a server-requested disconnect
  // → g_stopped → never flushed again, silent forever. But a REAL disconnect
  // revokes the token (hard 401); a 409 can only mean a stale binding. The
  // EA must re-pair instead of dying, and a beat that says desired=sync must
  // clear a stale stop (the server re-bound the token to the live row).

  for (const [name, src] of [
    ['MT5', mt5],
    ['MT4', mt4],
  ] as const) {
    describe(name, () => {
      it('FlushQueue treats 409 as a stale binding: drops g_paired for a re-pair (never g_stopped)', () => {
        const flush = src.slice(src.indexOf('bool FlushQueue'), src.indexOf('int CountMatches'))
        expect(flush).not.toContain('g_stopped = true')
        expect(flush).toContain('else if(st == 409)')
        expect(flush).toContain('g_paired = false;')
      })

      it('DoHeartbeat treats a beat 409 as a stale binding too (re-pair, not death)', () => {
        const beat = src.slice(src.indexOf('void DoHeartbeat'), src.indexOf('void DoRecovery'))
        expect(beat).toContain('else if(st == 409)')
        expect(beat).toContain('g_paired = false;')
      })

      it('a beat answer of desired=sync clears a stale stop (the server re-linked the account)', () => {
        const beat = src.slice(src.indexOf('void DoHeartbeat'), src.indexOf('void DoRecovery'))
        expect(beat).toContain('else if(g_stopped && StringLen(desired) > 0)')
        expect(beat).toContain('g_stopped = false;')
        expect(beat).toContain('resuming sync')
      })
    })
  }
})
