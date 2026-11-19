/**
 * CONNECT-3 tests (Task CONNECT-3) — the EA source regression guard.
 *
 * The owner's 2026 MetaEditor build offers exactly TWO WebRequest
 * overloads (from its own compiler error report, 2026-11-19):
 *
 *   int WebRequest(const string,const string,const string,const string,
 *                  int,const uchar&[],int,uchar&[],string&)   // 9 params (cookie+referer+data_size)
 *   int WebRequest(const string,const string,const string,int,
 *                  const uchar&[],uchar&[],string&)            // 7 params (headers, NO data_size)
 *
 * The classic 8-parameter form (with data_size) does NOT exist in that
 * build — v1.0.1 used it and failed to compile ("wrong parameters count",
 * twice, at the HttpPost call). v1.0.2 pins the MT5 call to the 7-param
 * overload; MT4 keeps the 8-param form, which is MQL4's documented
 * signature (MT4's frozen compiler still wants exactly that).
 *
 * These tests pin the exact call shapes in both EA files so no future edit
 * can silently drift back into a non-compiling overload.
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

  it('keeps the version triplet consistent (1.0.2 / "1.02" / "1.0.2")', () => {
    expect(mt5).toMatch(/Version 1\.0\.2 · CONNECT-3/)
    expect(mt5).toMatch(/#property version   "1\.02"/)
    expect(mt5).toMatch(/#define EA_VERSION          "1\.0\.2"/)
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
      'resultArr', // 7  uchar&[]        response bytes
      'resultHeaders', // 8  string&         response headers
    ])
  })

  it('keeps the version triplet consistent (1.0.1 / "1.01" / "1.0.1")', () => {
    expect(mt4).toMatch(/Version 1\.0\.1 · CONNECT-2/)
    expect(mt4).toMatch(/#property version   "1\.01"/)
    expect(mt4).toMatch(/#define EA_VERSION          "1\.0\.1"/)
  })
})
