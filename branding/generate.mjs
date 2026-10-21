#!/usr/bin/env node
/**
 * Branding asset generator.
 *
 * Writes the Meridian logo + geode background SVGs (unless you replaced
 * them with your own) and renders every raster the launcher and installers
 * need from them. Requires `rsvg-convert` and ImageMagick (`magick`).
 *
 *   node branding/generate.mjs           # keep existing SVGs, render rasters
 *   node branding/generate.mjs --svg     # also regenerate the placeholder SVGs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const images = join(root, 'app', 'assets', 'images')
const tmp = join(here, '.out')

const LOGO = join(here, 'logo.svg')
const BACKGROUND = join(here, 'background.svg')
const regenerate = process.argv.includes('--svg')

// Meridian ramp, darkest to lightest. Keep in sync with --meridian-* in launcher.css.
const RAMP = ['#021a30', '#00335c', '#004477', '#0a508a', '#6a9ccd', '#b9d3ec', '#e8f1fa']

/* Deterministic PRNG so the placeholder art is stable between runs. */
function rng(seed) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const pt = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`

/* A single crystal point: two lit facets and a dark facet, tip toward (tx, ty). */
function crystal(bx, by, tx, ty, width, light, shade) {
    const ang = Math.atan2(ty - by, tx - bx)
    const nx = -Math.sin(ang), ny = Math.cos(ang)
    const len = Math.hypot(tx - bx, ty - by)
    const shoulder = 0.62 + shade * 0.12
    const sx = bx + (tx - bx) * shoulder, sy = by + (ty - by) * shoulder
    const w = width / 2
    const L = [bx + nx * w, by + ny * w], R = [bx - nx * w, by - ny * w]
    const SL = [sx + nx * w * 0.92, sy + ny * w * 0.92], SR = [sx - nx * w * 0.92, sy - ny * w * 0.92]
    const C = [bx, by], SC = [sx + nx * w * 0.1, sy + ny * w * 0.1]
    // Facet brightness from the angle between the facet normal and the light (top-left).
    const lit = (dx, dy) => Math.max(0, (dx * -0.6 + dy * -0.8))
    const idx = (v) => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(v)))]
    const base = 0.2 + light * 3.6
    const fL = idx(base + lit(nx, ny) * 2.4)
    const fR = idx(base - 0.8 + lit(-nx, -ny) * 2.4)
    const tipL = idx(base + 0.9 + lit(nx, ny) * 2.4)
    const tipR = idx(base + lit(-nx, -ny) * 2)
    const edge = len > 90 ? `<polyline points="${pt(...SC)} ${pt(tx, ty)}" stroke="${RAMP[6]}" stroke-opacity="${(0.18 + light * 0.3).toFixed(2)}" stroke-width="1.2" fill="none"/>` : ''
    return `<g>
<polygon points="${pt(...L)} ${pt(...SL)} ${pt(...SC)} ${pt(...C)}" fill="${fL}"/>
<polygon points="${pt(...C)} ${pt(...SC)} ${pt(...SR)} ${pt(...R)}" fill="${fR}"/>
<polygon points="${pt(...SL)} ${pt(tx, ty)} ${pt(...SC)}" fill="${tipL}"/>
<polygon points="${pt(...SC)} ${pt(tx, ty)} ${pt(...SR)}" fill="${tipR}"/>${edge}
</g>`
}

/* Rough closed ring path around an ellipse, for basalt and calcite bands. */
function ring(cx, cy, rx, ry, jitter, rand, steps = 90) {
    const pts = []
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        const j = 1 + (rand() - 0.5) * jitter
        pts.push(pt(cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j))
    }
    return pts.join(' ')
}

function backgroundSvg() {
    const W = 1960, H = 1104
    const rand = rng(1337)
    const cx = 1600, cy = 520, rx = 660, ry = 590
    const out = []

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <radialGradient id="cave" cx="0.72" cy="0.48" r="0.9">
    <stop offset="0" stop-color="#0a2440"/>
    <stop offset="0.55" stop-color="#041729"/>
    <stop offset="1" stop-color="#010d19"/>
  </radialGradient>
  <radialGradient id="hollow" cx="0.45" cy="0.42" r="0.7">
    <stop offset="0" stop-color="#0a3a66"/>
    <stop offset="0.6" stop-color="#05223f"/>
    <stop offset="1" stop-color="#021426"/>
  </radialGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#6a9ccd" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#6a9ccd" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="calcite" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#d6e2ee"/>
    <stop offset="1" stop-color="#5f7183"/>
  </linearGradient>
  <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#010d19" stop-opacity="0.85"/>
    <stop offset="0.45" stop-color="#010d19" stop-opacity="0.15"/>
    <stop offset="1" stop-color="#010d19" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.6" stop-color="#010d19" stop-opacity="0"/>
    <stop offset="1" stop-color="#010d19" stop-opacity="0.7"/>
  </linearGradient>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.55  0 0 0 0 0.65  0 0 0 0.08 0"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#cave)"/>`)

    // Smooth basalt rind, then calcite, then the hollow.
    out.push(`<polygon points="${ring(cx, cy, rx * 1.13, ry * 1.13, 0.05, rand)}" fill="#1b2633"/>`)
    out.push(`<polygon points="${ring(cx, cy, rx * 1.07, ry * 1.07, 0.035, rand)}" fill="#2c3a49"/>`)
    out.push(`<polygon points="${ring(cx, cy, rx * 1.02, ry * 1.02, 0.03, rand)}" fill="url(#calcite)"/>`)
    out.push(`<polygon points="${ring(cx, cy, rx * 0.97, ry * 0.97, 0.025, rand)}" fill="url(#hollow)"/>`)
    out.push(`<ellipse cx="${cx - 40}" cy="${cy - 30}" rx="${rx * 0.75}" ry="${ry * 0.7}" fill="url(#glow)"/>`)

    // Crystals: three rings, outer (long, dark) to inner (short, bright), painted back to front.
    const layers = [
        { count: 140, at: 0.97, len: [150, 300], w: [40, 74], light: 0.0 },
        { count: 110, at: 0.82, len: [90, 200], w: [30, 56], light: 0.2 },
        { count: 70, at: 0.66, len: [50, 130], w: [22, 42], light: 0.4 }
    ]
    for (const L of layers) {
        const items = []
        for (let i = 0; i < L.count; i++) {
            const a = (i / L.count) * Math.PI * 2 + rand() * 0.08
            const bx = cx + Math.cos(a) * rx * L.at
            const by = cy + Math.sin(a) * ry * L.at
            const len = L.len[0] + rand() * (L.len[1] - L.len[0])
            const toC = Math.atan2(cy - by, cx - bx) + (rand() - 0.5) * 0.55
            const tx = bx + Math.cos(toC) * len, ty = by + Math.sin(toC) * len
            const w = L.w[0] + rand() * (L.w[1] - L.w[0])
            // Upper-left of the geode catches more light.
            // Light pours in from the upper left; the lower right falls into shadow.
            const sideLight = (-(Math.cos(a) * 0.55 + Math.sin(a) * 0.83) + 1) / 2
            const lit = L.light + sideLight * sideLight * 0.75 + (rand() - 0.5) * 0.18
            items.push(crystal(bx, by, tx, ty, w, Math.min(1, Math.max(0, lit)), rand()))
        }
        out.push(...items.sort(() => rand() - 0.5))
    }

    // A few stray clusters in the lower-left so the composition isn't one object.
    for (const [x, y, n, s] of [[180, 1060, 9, 1], [470, 1110, 6, 0.7], [90, 80, 5, 0.55]]) {
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (rand() - 0.5) * 1.9
            const len = (60 + rand() * 120) * s
            const bx = x + (rand() - 0.5) * 90 * s
            out.push(crystal(bx, y, bx + Math.cos(a) * len, y + Math.sin(a) * len * (y < 200 ? -1 : 1), (18 + rand() * 26) * s, 0.15 + rand() * 0.25, rand()))
        }
    }

    out.push(`<rect width="${W}" height="${H}" fill="url(#scrim)"/>`)
    out.push(`<rect width="${W}" height="${H}" fill="url(#floor)"/>`)
    out.push(`<rect width="${W}" height="${H}" filter="url(#grain)"/>`)
    out.push('</svg>')
    return out.join('\n')
}

// Corner radius of the logo's tile, out of its 480 side. 240 makes it a disc,
// matching the round modpack icons and pill controls in the launcher.
const TILE_RADIUS = 240

/* Meridian compass rose on a navy tile: the app icon (no text). */
function logoSvg() {
    const [navy, face, mid, light] = ['#004477', '#0a508a', '#6a9ccd', '#b9d3ec']
    const deg = (d) => (d - 90) * Math.PI / 180
    const at = (d, r) => pt(Math.cos(deg(d)) * r, Math.sin(deg(d)) * r)
    // One point of the rose as two halves: the clockwise half takes the shade.
    const point = (d, len, waist, lit, shade) =>
        `<polygon points="0,0 ${at(d, len)} ${at(d - 45, waist)}" fill="${lit}"/>` +
        `<polygon points="0,0 ${at(d, len)} ${at(d + 45, waist)}" fill="${shade}"/>`
    const ticks = [30, 60, 120, 150, 210, 240, 300, 330]
        .map(d => `<line x1="${at(d, 146).split(',')[0]}" y1="${at(d, 146).split(',')[1]}" x2="${at(d, 160).split(',')[0]}" y2="${at(d, 160).split(',')[1]}"/>`)
        .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect x="16" y="16" width="480" height="480" rx="${TILE_RADIUS}" fill="${navy}"/>
<g transform="translate(256 256)">
  <circle r="172" fill="${face}" stroke="#ffffff" stroke-width="20"/>
  <g stroke="${mid}" stroke-width="7" stroke-linecap="round" opacity="0.9">${ticks}</g>
  ${[45, 135, 225, 315].map(d => point(d, 128, 30, mid, '#4f86bd')).join('\n  ')}
  ${[0, 90, 180, 270].map(d => point(d, 206, 30, '#ffffff', light)).join('\n  ')}
  <circle r="23" fill="#ffffff"/>
  <circle r="12" fill="${navy}"/>
</g>
</svg>`
}

function run(cmd, args) {
    execFileSync(cmd, args, { stdio: 'inherit' })
}

function render(svg, out, w, h) {
    run('rsvg-convert', ['-w', String(w), ...(h ? ['-h', String(h)] : []), '-o', out, svg])
}

if (regenerate || !existsSync(LOGO)) writeFileSync(LOGO, logoSvg())
if (regenerate || !existsSync(BACKGROUND)) writeFileSync(BACKGROUND, backgroundSvg())

mkdirSync(tmp, { recursive: true })

// Logo: in-app copy, window icons, installer icon.
run('cp', [LOGO, join(images, 'logo.svg')])
render(LOGO, join(root, 'build', 'icon.png'), 1024)
render(LOGO, join(images, 'SealCircle.png'), 512)
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
for (const s of icoSizes) render(LOGO, join(tmp, `icon-${s}.png`), s)
run('magick', [...icoSizes.map(s => join(tmp, `icon-${s}.png`)), join(images, 'SealCircle.ico')])

// Background: the launcher picks a random backgrounds/<n>.jpg, so keep exactly
// the art you want in that folder, numbered from 0.
const bgDir = join(images, 'backgrounds')
for (const f of readdirSync(bgDir)) rmSync(join(bgDir, f))
const bgPng = join(tmp, 'bg.png')
render(BACKGROUND, bgPng, 1960, 1104)
run('magick', [bgPng, '-quality', '88', join(bgDir, '0.jpg')])

rmSync(tmp, { recursive: true, force: true })
console.log('Branding assets written.')
