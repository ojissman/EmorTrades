/**
 * MOBILE-2 — one-time PWA icon generator (sharp).
 * Derives every icon from the brand logo (public/logo.png, 1024²) on the
 * midnight bar background (#1f2937 — the same color as the in-app header
 * chrome), so the launcher icon, splash and browser chrome read as one
 * brand with the app shell.
 *
 *   bun scripts/gen-pwa-icons.ts
 *
 * Outputs to public/icons/ (all committed):
 *   icon-192.png / icon-512.png        — purpose "any" (launcher, desktop PWA)
 *   maskable-192.png / maskable-512.png — purpose "maskable" (Android adaptive:
 *                                        logo at 68% inside the 80% safe zone)
 *   apple-touch-icon.png               — 180², iOS home screen / splash source
 */
import sharp from 'sharp'
import { mkdirSync } from 'fs'

const SRC = 'public/logo.png'
const OUT = 'public/icons'
const BG = '#1f2937' // midnight shell bar — matches theme_color + in-app header

async function make(size: number, logoPct: number, file: string) {
  const logoSize = Math.round(size * logoPct)
  const offset = Math.round((size - logoSize) / 2)
  const logo = await sharp(SRC).resize(logoSize, logoSize, { fit: 'contain' }).png().toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, left: offset, top: offset }])
    .png()
    .toFile(`${OUT}/${file}`)
  console.log(`  ${OUT}/${file} (${size}×${size}, logo ${logoPct * 100}%)`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // "any" purpose: logo slightly larger — no system masking to survive.
  await make(192, 0.8, 'icon-192.png')
  await make(512, 0.8, 'icon-512.png')
  // "maskable": logo at 68% — inside the 80%-circle safe zone, survives any crop.
  await make(192, 0.68, 'maskable-192.png')
  await make(512, 0.68, 'maskable-512.png')
  // Apple touch icon: 180², iOS rounds the corners itself; bg + 72% logo.
  await make(180, 0.72, 'apple-touch-icon.png')
  console.log('done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
