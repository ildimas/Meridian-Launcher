/**
 * Wallpaper engine.
 *
 * Builds the vector wallpapers from the launcher redesign: three landscapes
 * (alpine, dunes, valley) and three geometry scenes (prism, orbit, lattice).
 * Each scene is tinted by a time of day and a colour palette. The output is
 * plain markup so it can be dropped into any element, including the small
 * previews in Settings > Appearance.
 */

function wpRgb(h){
    h = String(h).replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function wpHex(r, g, b){
    const f = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
    return '#' + f(r) + f(g) + f(b)
}
function wpMix(a, b, t){
    if(!b || !t) return a
    const x = wpRgb(a)
    const y = wpRgb(b)
    return wpHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t)
}
function wpGray(c){
    const x = wpRgb(c)
    const l = 0.299 * x[0] + 0.587 * x[1] + 0.114 * x[2]
    return wpHex(l, l, l + 6)
}
function wpRng(seed){
    let s = seed
    return function(){
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646
    }
}

const LAND_SCENES = ['alpine', 'dunes', 'valley']
const GEO_SCENES = ['prism', 'orbit', 'lattice']
const ALL_SCENES = LAND_SCENES.concat(GEO_SCENES)
const TODS = ['dawn', 'day', 'dusk', 'night']
const LAND_PALETTES = ['natural', 'frost', 'ember', 'mono']
const GEO_PALETTES = ['meridian', 'amethyst', 'cobalt', 'coral', 'graphite']

const LAND_NATURAL = { alpine: '#9cc8ff', dunes: '#ffc38a', valley: '#a6e0b0' }
const LAND_ACCENT = { frost: '#b8d4ff', ember: '#ffab7a', mono: '#eef0f3' }
const LAND_SWATCH = { frost: '#b8d4ff', ember: '#ffab7a', mono: '#c9ccd2' }
const LAND_TILE = { alpine: ['#79b1e3', '#2f4f6c'], dunes: ['#f2cf9f', '#8a5634'], valley: ['#9fcbe8', '#33604a'] }

const WP_LAND = {
    alpine: {
        p: [
            'M0 430 L120 360 L210 400 L330 300 L430 380 L560 280 L690 370 L820 290 L940 360 L1060 300 L1180 350 L1280 320 L1280 720 L0 720 Z',
            'M0 500 L150 420 L260 470 L400 380 L520 460 L640 400 L780 480 L900 410 L1030 470 L1160 420 L1280 450 L1280 720 L0 720 Z',
            'M0 580 L180 500 L320 560 L470 490 L620 570 L760 520 L930 590 L1080 530 L1280 580 L1280 720 L0 720 Z',
            'M0 650 C200 610 360 640 520 630 C700 620 900 660 1080 640 C1180 630 1240 640 1280 650 L1280 720 L0 720 Z'
        ],
        snow: 'M330 300 L365 328 L350 324 L338 332 L322 322 L306 330 L296 328 Z M560 280 L603 310 L586 305 L572 314 L556 303 L540 312 L521 310 Z M820 290 L865 316 L848 312 L834 320 L818 309 L800 318 L778 316 Z M1060 300 L1094 321 L1080 318 L1068 325 L1054 316 L1040 322 L1028 319 Z',
        cols: ['#a9c4dc', '#7f9fbf', '#557a9c', '#2f4f6c'], sky: ['#5d9bd6', '#a8cdea', '#e2eef6']
    },
    dunes: {
        p: [
            'M0 450 C200 400 380 430 560 410 C760 390 980 440 1280 400 L1280 720 L0 720 Z',
            'M0 520 C180 470 420 540 640 490 C860 440 1060 520 1280 480 L1280 720 L0 720 Z',
            'M0 600 C260 540 480 620 760 570 C980 530 1140 590 1280 560 L1280 720 L0 720 Z',
            'M0 680 C300 630 600 690 900 650 C1080 630 1200 660 1280 650 L1280 720 L0 720 Z'
        ],
        snow: '', cols: ['#ecd0aa', '#dcae7e', '#c08657', '#8a5634'], sky: ['#6fb0e0', '#b9d9ee', '#f4e2c8']
    },
    valley: {
        p: [
            'M0 420 C140 380 260 400 380 370 C520 340 640 390 780 360 C920 330 1100 380 1280 350 L1280 720 L0 720 Z',
            'M0 490 C200 450 320 500 500 470 C680 440 820 500 1000 460 C1120 440 1220 470 1280 460 L1280 720 L0 720 Z',
            'M0 570 C220 520 400 590 640 550 C880 510 1060 580 1280 540 L1280 720 L0 720 Z',
            'M0 660 C240 620 460 670 700 640 C940 610 1120 660 1280 640 L1280 720 L0 720 Z'
        ],
        snow: '', cols: ['#b3d1bb', '#86b493', '#5c8f6c', '#33604a'], sky: ['#6aa7da', '#b0d4ec', '#e6f2ea']
    }
}

const WP_TOD = {
    dawn: { tint: '#4a3f7a', t: 0.38, sky: ['#26305a', '#8a6a9a', '#f4b08a'], sun: [330, 330, 34], sunC: '#ffd9b0', stars: 0.25, cloud: 0.35, cloudC: '#ffd7c2', haze: [0.32, 0.2, 0.08, 0] },
    day: { tint: null, t: 0, sky: null, sun: [930, 150, 30], sunC: '#fff8e0', stars: 0, cloud: 0.55, cloudC: '#ffffff', haze: [0, 0, 0, 0] },
    dusk: { tint: '#4c1f45', t: 0.42, sky: ['#1c1838', '#7a3a68', '#f28a5a'], sun: [1010, 350, 38], sunC: '#ffb27a', stars: 0.35, cloud: 0.3, cloudC: '#ffb59a', haze: [0.34, 0.2, 0.08, 0] },
    night: { tint: '#070b24', t: 0.72, sky: ['#03050f', '#0b1230', '#1b2950'], sun: [960, 130, 22], sunC: '#e9edff', stars: 1, cloud: 0.06, cloudC: '#9aa6c8', haze: [0.25, 0.14, 0.05, 0] }
}

const WP_GEO = {
    meridian: { bg: ['#021a30', '#00335c', '#004477'], c: ['#0a508a', '#6a9ccd', '#b9d3ec'], tile: ['#004477', '#6a9ccd'], accent: '#7db4e6', swatch: '#6a9ccd' },
    amethyst: { bg: ['#0d0918', '#1b1135', '#2d1b56'], c: ['#5b3fc4', '#8f6cf5', '#cdbbff'], tile: ['#2d1b56', '#8f6cf5'], accent: '#b9a2ff', swatch: '#8f6cf5' },
    cobalt: { bg: ['#060c1a', '#0e1f40', '#17325f'], c: ['#2a59c9', '#5c8dff', '#b3caff'], tile: ['#17325f', '#5c8dff'], accent: '#8fb2ff', swatch: '#5c8dff' },
    coral: { bg: ['#150909', '#2c1317', '#462029'], c: ['#c4513f', '#ff8668', '#ffcbb5'], tile: ['#462029', '#ff8668'], accent: '#ff9f84', swatch: '#ff8668' },
    graphite: { bg: ['#090a0c', '#16181c', '#25282e'], c: ['#454a53', '#878d97', '#d5d9df'], tile: ['#25282e', '#878d97'], accent: '#e6e8eb', swatch: '#878d97' }
}

// Geometry that never changes: stars, prism shards, orbit bodies, lattice.
const WP_STATIC = (function(){
    const out = {}
    const rs = wpRng(3)
    let stars = ''
    for(let i = 0; i < 90; i++){
        const x = rs() * 1280
        const y = rs() * 430
        const s = rs() < 0.15 ? 2.6 : 1.6
        stars += 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h' + s + 'v' + s + 'h-' + s + 'Z '
    }
    out.stars = stars

    const shards = (seed, cx, cy, count, r0a, r0b, la, lb, wa, wb) => {
        const r = wpRng(seed)
        const d = ['', '', '']
        for(let i = 0; i < count; i++){
            const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.14
            const r0 = r0a + r() * r0b
            const L = la + r() * lb
            const w = wa + r() * wb
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const P = (al, sd) => (cx + ca * al - sa * sd).toFixed(1) + ' ' + (cy + sa * al + ca * sd).toFixed(1)
            d[i % 3] += 'M' + P(r0, -w) + ' L' + P(r0 + L * 0.82, -w * 0.7) + ' L' + P(r0 + L, 0) + ' L' + P(r0 + L * 0.82, w * 0.7) + ' L' + P(r0, w) + ' Z '
        }
        return d
    }
    const big = shards(7, 960, 360, 46, 96, 26, 120, 240, 10, 16)
    out.pr0 = big[0]
    out.pr1 = big[1]
    out.pr2 = big[2]
    out.prS = shards(11, 170, 150, 12, 6, 6, 20, 46, 4, 5).join(' ')

    const ring = [[120, 30], [190, 200], [270, 110], [360, 300], [470, 160]]
    out.orbit = ring.map((o) => {
        const a = o[1] * Math.PI / 180
        return [(930 + o[0] * Math.cos(a)).toFixed(1), (380 + o[0] * Math.sin(a)).toFixed(1)]
    })

    let lines = ''
    const t = Math.tan(Math.PI / 6)
    for(let b = -760; b <= 1480; b += 64){
        lines += 'M0 ' + b + ' L1280 ' + (b + 1280 * t).toFixed(1) + ' M0 ' + b + ' L1280 ' + (b - 1280 * t).toFixed(1) + ' '
    }
    out.latLines = lines
    let cT = ''
    let cL = ''
    let cR = ''
    const f = (v) => v.toFixed(1)
    ;[[820, 250, 70], [1000, 380, 48], [900, 520, 90], [1130, 200, 36], [700, 430, 40], [1160, 560, 60]].forEach((c) => {
        const x = c[0]
        const y = c[1]
        const a = c[2]
        const k = a * 0.866
        cT += 'M' + f(x) + ' ' + f(y - a) + ' L' + f(x + k) + ' ' + f(y - a / 2) + ' L' + f(x) + ' ' + f(y) + ' L' + f(x - k) + ' ' + f(y - a / 2) + ' Z '
        cL += 'M' + f(x - k) + ' ' + f(y - a / 2) + ' L' + f(x) + ' ' + f(y) + ' L' + f(x) + ' ' + f(y + a) + ' L' + f(x - k) + ' ' + f(y + a / 2) + ' Z '
        cR += 'M' + f(x) + ' ' + f(y) + ' L' + f(x + k) + ' ' + f(y - a / 2) + ' L' + f(x + k) + ' ' + f(y + a / 2) + ' L' + f(x) + ' ' + f(y + a) + ' Z '
    })
    out.cubeT = cT
    out.cubeL = cL
    out.cubeR = cR
    return out
})()

const SVG_OPEN = '<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" class="wpSvg" aria-hidden="true">'

function isGeo(scene){
    return GEO_SCENES.includes(scene)
}

function normalize(opts){
    let scene = opts.scene
    if(!ALL_SCENES.includes(scene)) scene = 'alpine'
    let tod = opts.tod
    if(!TODS.includes(tod)) tod = 'day'
    let palette = opts.palette
    if(isGeo(scene)){
        if(!WP_GEO[palette]) palette = 'meridian'
    } else if(!LAND_PALETTES.includes(palette)){
        palette = 'natural'
    }
    return { scene, tod, palette, motion: opts.motion !== false }
}

/**
 * Render a wallpaper.
 *
 * @param {{scene: string, tod: string, palette: string, motion: boolean}} opts
 * @returns {{background: string, html: string}} A CSS background for the
 * container and the SVG markup to place inside it.
 */
exports.render = function(opts){
    const { scene, tod, palette, motion } = normalize(opts)
    const anim = (v) => motion ? v : 'none'
    const stars = (op) => `<g opacity="${op}"><g class="wpMotion" style="animation: ${anim('wp-tw 5s ease-in-out infinite alternate')}"><path d="${WP_STATIC.stars}" fill="#ffffff"/></g></g>`

    if(!isGeo(scene)){
        const P = (c) => palette === 'frost' ? wpMix(c, '#a9bedb', 0.4) : palette === 'ember' ? wpMix(c, '#cf7d55', 0.32) : palette === 'mono' ? wpGray(c) : c
        const S = WP_LAND[scene]
        const T = WP_TOD[tod]
        const skyRaw = T.sky || S.sky
        const sky = skyRaw.map(P)
        const cols = S.cols.map((c, i) => P(wpMix(wpMix(c, T.tint, T.t), skyRaw[2], T.haze[i])))
        const cs = P(wpMix(wpMix('#eef4fa', T.tint, T.t * 0.9), skyRaw[2], 0.2))
        const sunC = P(T.sunC)
        const [sx, sy, sr] = T.sun
        const html = SVG_OPEN
            + stars(T.stars)
            + `<circle cx="${sx}" cy="${sy}" r="${sr * 4.2}" fill="${sunC}" opacity="0.06"/>`
            + `<circle cx="${sx}" cy="${sy}" r="${sr * 2.2}" fill="${sunC}" opacity="0.14"/>`
            + `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${sunC}"/>`
            + `<g opacity="${T.cloud}"><g class="wpMotion" style="animation: ${anim('wp-drift 80s ease-in-out infinite alternate')}" fill="${P(T.cloudC)}">`
            + '<ellipse cx="250" cy="170" rx="130" ry="13"/><ellipse cx="330" cy="188" rx="80" ry="9"/>'
            + '<ellipse cx="760" cy="112" rx="150" ry="15"/><ellipse cx="860" cy="130" rx="70" ry="8"/>'
            + '<ellipse cx="1120" cy="220" rx="96" ry="11"/><ellipse cx="560" cy="246" rx="110" ry="10"/>'
            + '</g></g>'
            + `<path d="${S.p[0]}" fill="${cols[0]}"/>`
            + (S.snow ? `<path d="${S.snow}" fill="${cs}"/>` : '')
            + `<path d="${S.p[1]}" fill="${cols[1]}"/>`
            + `<path d="${S.p[2]}" fill="${cols[2]}"/>`
            + `<path d="${S.p[3]}" fill="${cols[3]}"/>`
            + '</svg>'
        return {
            background: `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 55%, ${sky[2]} 100%)`,
            html
        }
    }

    const G = WP_GEO[palette]
    const m = { dawn: ['#5a3d6e', 0.18], day: [G.c[0], 0.24], dusk: ['#6a2a3a', 0.2], night: ['#000000', 0.4] }[tod]
    const bg = G.bg.map((c) => wpMix(c, m[0], m[1]))
    const [g0, g1, g2] = G.c.map((x) => tod === 'night' ? wpMix(x, '#000000', 0.18) : x)
    const starsOp = tod === 'night' ? 0.7 : (tod === 'day' ? 0 : 0.25)
    const spin = (s, rev) => anim('wp-spin ' + s + 's linear infinite' + (rev ? ' reverse' : ''))
    const background = `radial-gradient(120% 100% at 72% 48%, ${bg[2]} 0%, ${bg[1]} 50%, ${bg[0]} 100%)`
    let html = SVG_OPEN + stars(starsOp)

    if(scene === 'prism'){
        html += `<circle cx="960" cy="360" r="430" fill="none" stroke="${g2}" opacity="0.08" stroke-width="1"/>`
            + `<circle cx="960" cy="360" r="470" fill="none" stroke="${g2}" opacity="0.05" stroke-width="1"/>`
            + `<g class="wpMotion" style="transform-origin: 960px 360px; animation: ${spin(360)}">`
            + `<path d="${WP_STATIC.pr0}" fill="${g0}"/><path d="${WP_STATIC.pr1}" fill="${g1}"/><path d="${WP_STATIC.pr2}" fill="${g2}" opacity="0.9"/>`
            + '</g>'
            + `<circle cx="960" cy="360" r="104" fill="${bg[0]}" opacity="0.94"/>`
            + `<circle cx="960" cy="360" r="66" fill="${g0}" opacity="0.2"/>`
            + `<path d="${WP_STATIC.prS}" fill="${g1}" opacity="0.32"/>`
            + '</svg>'
    } else if(scene === 'orbit'){
        const o = WP_STATIC.orbit
        const ring = (r, op, speed, rev, body) => `<g class="wpMotion" style="transform-origin: 930px 380px; animation: ${spin(speed, rev)}"><circle cx="930" cy="380" r="${r}" fill="none" stroke="${g1}" opacity="${op}" stroke-width="1.2"/>${body}</g>`
        html += ring(120, 0.4, 70, false, `<circle cx="${o[0][0]}" cy="${o[0][1]}" r="6" fill="${g2}"/>`)
            + ring(190, 0.32, 120, true, `<circle cx="${o[1][0]}" cy="${o[1][1]}" r="9" fill="${g1}"/>`)
            + ring(270, 0.26, 180, false, `<circle cx="${o[2][0]}" cy="${o[2][1]}" r="5" fill="${g2}"/>`)
            + ring(360, 0.2, 260, true, `<circle cx="${o[3][0]}" cy="${o[3][1]}" r="13" fill="${g0}"/><circle cx="${o[3][0]}" cy="${o[3][1]}" r="22" fill="none" stroke="${g2}" opacity="0.5" stroke-width="1"/>`)
            + ring(470, 0.14, 340, false, `<circle cx="${o[4][0]}" cy="${o[4][1]}" r="7" fill="${g2}"/>`)
            + `<circle cx="930" cy="380" r="72" fill="${g0}"/>`
            + `<circle cx="914" cy="362" r="50" fill="${g1}" opacity="0.55"/>`
            + `<circle cx="902" cy="350" r="20" fill="${g2}" opacity="0.5"/>`
            + '</svg>'
    } else {
        html += `<path d="${WP_STATIC.latLines}" fill="none" stroke="${g1}" opacity="0.17" stroke-width="1"/>`
            + `<g class="wpMotion" style="animation: ${anim('wp-bob 10s ease-in-out infinite alternate')}">`
            + `<path d="${WP_STATIC.cubeL}" fill="${g1}"/><path d="${WP_STATIC.cubeR}" fill="${g0}"/><path d="${WP_STATIC.cubeT}" fill="${g2}"/>`
            + '</g></svg>'
            + `<div class="wpFade" style="background: linear-gradient(90deg, ${bg[0]} 0%, ${bg[0]}cc 22%, ${bg[0]}00 55%)"></div>`
    }
    return { background, html }
}

/**
 * The accent colour for a scene + palette. Text on the accent is always
 * #021a30.
 */
exports.accentFor = function(scene, palette){
    const n = normalize({ scene, palette })
    if(isGeo(n.scene)) return WP_GEO[n.palette].accent
    return n.palette === 'natural' ? LAND_NATURAL[n.scene] : LAND_ACCENT[n.palette]
}

/**
 * Gradient stops used for a server tile on the dial.
 */
exports.tileColors = function(scene, palette){
    const n = normalize({ scene, palette })
    return isGeo(n.scene) ? WP_GEO[n.palette].tile : LAND_TILE[n.scene]
}

/**
 * Swatch colour for a palette chip. Natural follows the scene's own colour.
 */
exports.swatchFor = function(scene, palette){
    if(WP_GEO[palette]) return WP_GEO[palette].swatch
    return palette === 'natural' ? (LAND_NATURAL[scene] || LAND_NATURAL.alpine) : LAND_SWATCH[palette]
}

/**
 * Time of day from the local clock.
 */
exports.autoTod = function(date = new Date()){
    const h = date.getHours()
    if(h >= 5 && h < 8) return 'dawn'
    if(h >= 8 && h < 17) return 'day'
    if(h >= 17 && h < 20) return 'dusk'
    return 'night'
}

exports.mix = wpMix
exports.isGeo = isGeo
exports.LAND_SCENES = LAND_SCENES
exports.GEO_SCENES = GEO_SCENES
exports.ALL_SCENES = ALL_SCENES
exports.LAND_PALETTES = LAND_PALETTES
exports.GEO_PALETTES = GEO_PALETTES
exports.TODS = TODS
