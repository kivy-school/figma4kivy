#!/usr/bin/env node
// Post-build script for Figma plugin:
//
// Inline the entire JS bundle into index.html as a <script> block.
// Figma loads plugin UI HTML via document.write() into a data:text/html iframe,
// which has no base URL. This means <script src="./assets/ui-*.js"> can never
// resolve — the script silently never loads. We must make index.html fully
// self-contained.

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const distDir   = new URL('../dist', import.meta.url).pathname
const assetsDir = join(distDir, 'assets')
const files     = readdirSync(assetsDir)

const jsFile = files.find(f => f.endsWith('.js'))

if (!jsFile) {
  console.error('[inline] ERROR: could not find .js in dist/assets/')
  process.exit(1)
}

const jsPath = join(assetsDir, jsFile)
const js     = readFileSync(jsPath, 'utf8')

// ── Inline JS into index.html ─────────────────────────────────────────────────
const htmlPath = join(distDir, 'index.html')
let html = readFileSync(htmlPath, 'utf8')

html = html.replace(
  /<link[^>]+modulepreload[^>]*>/gi,
  ''
)
html = html.replace(
  /<script\s[^>]*\bsrc=["'][^"']*assets\/[^"']*\.js["'][^>]*><\/script>/gi,
  `<script type="module">\n${js}\n</script>`
)

writeFileSync(htmlPath, html)
console.log(`[inline] JS inlined into index.html — done.`)
console.log(`[inline] Final index.html size: ${(readFileSync(htmlPath).length / 1024).toFixed(1)} kB`)
