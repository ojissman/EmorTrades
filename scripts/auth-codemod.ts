/**
 * AUTH CODEMOD — converts the single-user era `db.user.findFirst()` lookups
 * across src/app/api/** into authenticated `requireUser()` calls.
 *
 *   const user = await db.user.findFirst(<ARGS>)
 * becomes
 *   const auth = await requireUser(<ARGS>)
 *   if (!auth.ok) return auth.response
 *   const user = auth.user
 *
 * · ARGS (select/include) are preserved so downstream typings still work.
 * · Any findFirst WITH a `where:` clause is skipped (email-clash checks etc.)
 *   and reported for manual review.
 * · Injects `import { requireUser } from '@/lib/server/auth'` when missing.
 *
 * Run: bun scripts/auth-codemod.ts
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = 'src/app/api'
const changed: string[] = []
const skipped: { file: string; line: number; snippet: string }[] = []

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (entry === 'route.ts') out.push(p)
  }
  return out
}

/** Find the index of the `)` matching the `(` at `openIdx` (paren counting). */
function matchParen(src: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Line number of a char index. */
function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length
}

for (const file of walk(ROOT)) {
  let src = readFileSync(file, 'utf8')
  const orig = src
  let searchFrom = 0

  while (true) {
    const idx = src.indexOf('db.user.findFirst(', searchFrom)
    if (idx === -1) break

    const openParen = idx + 'db.user.findFirst'.length
    const closeParen = matchParen(src, openParen)
    if (closeParen === -1) {
      skipped.push({ file, line: lineOf(src, idx), snippet: 'UNMATCHED PAREN' })
      searchFrom = idx + 1
      continue
    }

    const argsRaw = src.slice(openParen + 1, closeParen)
    const stmtStart = src.lastIndexOf('const ', idx)
    // ensure "const X = await " directly precedes
    const between = src.slice(stmtStart, idx)
    const m = between.match(/^const (\w+) = await\s*$/)
    if (!m) {
      skipped.push({ file, line: lineOf(src, idx), snippet: src.slice(idx - 30, closeParen + 1).trim() })
      searchFrom = closeParen + 1
      continue
    }
    const varName = m[1]

    if (argsRaw.includes('where:')) {
      skipped.push({ file, line: lineOf(src, idx), snippet: 'HAS where: — kept manual' })
      searchFrom = closeParen + 1
      continue
    }

    // indentation of the `const` line
    const lineStart = src.lastIndexOf('\n', stmtStart) + 1
    const indent = src.slice(lineStart, stmtStart).match(/^[ \t]*/)?.[0] ?? ''

    const argsTrim = argsRaw.trim()
    const argsCall = argsTrim ? argsTrim : ''
    const replacement =
      `${indent}const auth = await requireUser(${argsCall})\n` +
      `${indent}if (!auth.ok) return auth.response\n` +
      `${indent}const ${varName} = auth.user`

    src = src.slice(0, lineStart) + replacement + src.slice(closeParen + 1)
    searchFrom = lineStart + replacement.length + 1
  }

  if (src !== orig) {
    // ensure import
    if (!src.includes("@/lib/server/auth")) {
      const dbImport = src.match(/^import \{ db \} from '@\/lib\/db'$/m)
      if (dbImport) {
        src = src.replace(dbImport[0], `${dbImport[0]}\nimport { requireUser } from '@/lib/server/auth'`)
      } else {
        // fall back: after the last import line
        const imports = [...src.matchAll(/^import .*$/gm)]
        const last = imports[imports.length - 1]
        if (last) {
          const at = last.index! + last[0].length
          src = src.slice(0, at) + `\nimport { requireUser } from '@/lib/server/auth'` + src.slice(at)
        } else {
          // prepend after first line comment block — safest at very top
          src = `import { requireUser } from '@/lib/server/auth'\n` + src
        }
      }
    }
    writeFileSync(file, src)
    changed.push(file)
  }
}

console.log(`CHANGED ${changed.length} files:`)
changed.forEach((f) => console.log('  ✓', f))
console.log(`\nSKIPPED ${skipped.length} sites (manual review):`)
skipped.forEach((s) => console.log(`  ✗ ${s.file}:${s.line} — ${s.snippet}`))
