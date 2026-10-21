/**
 * Theme engine.
 *
 * Owns the wallpaper behind every view and the accent colour derived from it.
 * The wallpaper is either a vector scene (see wallpaper.js) or a photo. A
 * server may bring its own wallpaper through a `launcherTheme` block in
 * distribution.json; that wins while the per-server option is on, except in
 * Settings where the user always sees their own default.
 */
/* global document, Image */
const fs = require('fs-extra')
const path = require('path')
const { pathToFileURL } = require('url')

const ConfigManager = require('./configmanager')
const Wallpaper = require('./wallpaper')

const FADE_MS = 900
const PHOTO_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']

// Photos that ship with the launcher. Paths are relative to app/.
const BUILTIN_PHOTOS = [
    'assets/images/backgrounds/0.jpg'
]

let root = null
let serverTheme = null
let preferDefault = false
let currentKey = null
let clock = null
const accentCache = new Map()

function hexToRgb(hex){
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r, g, b){
    const f = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
    return '#' + f(r) + f(g) + f(b)
}

function rgbToHsl(r, g, b){
    r /= 255; g /= 255; b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    if(max === min) return [0, 0, l]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h
    if(max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if(max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return [h / 6, s, l]
}

function hslToRgb(h, s, l){
    if(s === 0) return [l * 255, l * 255, l * 255]
    const hue = (p, q, t) => {
        if(t < 0) t += 1
        if(t > 1) t -= 1
        if(t < 1 / 6) return p + (q - p) * 6 * t
        if(t < 1 / 2) return q
        if(t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

/**
 * Whether a path points at an image we can show.
 */
function isPhotoPath(p){
    return typeof p === 'string' && PHOTO_EXT.includes(path.extname(p).toLowerCase())
}

/**
 * Turn a stored photo reference into a URL the renderer can load.
 */
function photoUrl(p){
    if(p == null) return null
    if(/^(https?|file|data):/i.test(p)) return p
    if(BUILTIN_PHOTOS.includes(p)) return p
    return pathToFileURL(p).href
}

function getPhotosDirectory(){
    return path.join(ConfigManager.getLauncherDirectory(), 'wallpapers')
}

/**
 * Pick a light, readable accent out of a photo: the average of its most
 * colourful pixels, lifted so dark text (#021a30) stays legible on it.
 */
function extractAccent(url){
    if(accentCache.has(url)) return Promise.resolve(accentCache.get(url))
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            try {
                const size = 48
                const canvas = document.createElement('canvas')
                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext('2d', { willReadFrequently: true })
                ctx.drawImage(img, 0, 0, size, size)
                const data = ctx.getImageData(0, 0, size, size).data
                let r = 0, g = 0, b = 0, w = 0
                for(let i = 0; i < data.length; i += 4){
                    const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
                    // Favour saturated mid-tones over greys, blacks and whites.
                    const weight = s * (1 - Math.abs(l - 0.5) * 1.6) + 0.02
                    r += data[i] * weight
                    g += data[i + 1] * weight
                    b += data[i + 2] * weight
                    w += weight
                }
                const [h, s] = rgbToHsl(r / w, g / w, b / w)
                const accent = rgbToHex(...hslToRgb(h, Math.min(0.85, Math.max(0.35, s)), 0.76))
                accentCache.set(url, accent)
                resolve(accent)
            } catch {
                resolve(Wallpaper.accentFor('alpine', 'natural'))
            }
        }
        img.onerror = () => resolve(Wallpaper.accentFor('alpine', 'natural'))
        img.src = url
    })
}

/**
 * Apply an accent colour to the launcher's CSS tokens.
 */
function applyAccent(hex){
    const [r, g, b] = hexToRgb(hex)
    const style = document.documentElement.style
    style.setProperty('--accent', hex)
    style.setProperty('--accent-hi', Wallpaper.mix(hex, '#ffffff', 0.35))
    style.setProperty('--accent-lo', Wallpaper.mix(hex, '#021a30', 0.22))
    style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`)
    style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.45)`)
}

function currentTod(appearance){
    return appearance.timeOfDay === 'auto' || !Wallpaper.TODS.includes(appearance.timeOfDay)
        ? Wallpaper.autoTod()
        : appearance.timeOfDay
}

/**
 * Resolve what the user's own settings ask for, ignoring any server theme.
 *
 * @param {Object} appearance Appearance settings (defaults to the saved ones).
 */
function resolveDefault(appearance = ConfigManager.getAppearance()){
    const tod = currentTod(appearance)
    const motion = appearance.motion !== false
    if(appearance.theme === 'photo' && appearance.photo != null){
        return { kind: 'photo', url: photoUrl(appearance.photo), tod, motion }
    }
    const family = appearance.theme === 'geometry' ? 'geometry' : 'landscapes'
    return {
        kind: 'vector',
        scene: appearance.scene[family],
        palette: appearance.palette[family],
        tod,
        motion
    }
}

/**
 * Resolve the wallpaper to show right now.
 */
function resolve(){
    const appearance = ConfigManager.getAppearance()
    if(!preferDefault && appearance.perServerWallpaper !== false && serverTheme != null){
        const tod = currentTod(appearance)
        const motion = appearance.motion !== false
        const images = serverTheme.images
        if(images != null && typeof images === 'object'){
            const url = images[tod] || images.day || Object.values(images)[0]
            if(url) return { kind: 'photo', url, tod, motion }
        }
        if(serverTheme.scene){
            return {
                kind: 'vector',
                scene: serverTheme.scene,
                palette: serverTheme.palette || (Wallpaper.isGeo(serverTheme.scene) ? appearance.palette.geometry : appearance.palette.landscapes),
                tod,
                motion
            }
        }
    }
    return resolveDefault(appearance)
}

function keyOf(d){
    return d.kind === 'photo' ? `photo|${d.url}` : `vector|${d.scene}|${d.palette}|${d.tod}|${d.motion}`
}

/**
 * Build a wallpaper layer element for a resolved descriptor.
 */
function buildLayer(d){
    const layer = document.createElement('div')
    layer.className = 'wpLayer'
    if(d.kind === 'photo'){
        layer.classList.add('wpPhoto')
        layer.style.backgroundImage = `url("${d.url.replace(/"/g, '\\"')}")`
    } else {
        const out = Wallpaper.render(d)
        layer.style.background = out.background
        layer.innerHTML = out.html
    }
    return layer
}

async function accentOf(d){
    if(d.kind === 'photo') return extractAccent(d.url)
    return Wallpaper.accentFor(d.scene, d.palette)
}

/**
 * Re-resolve the wallpaper and cross-fade to it if it changed.
 *
 * @param {boolean} force Rebuild even if nothing changed.
 */
async function refresh(force = false){
    if(root == null) return
    const d = resolve()
    const key = keyOf(d)
    if(!force && key === currentKey) return
    currentKey = key

    const layer = buildLayer(d)
    const old = Array.from(root.getElementsByClassName('wpLayer'))
    root.appendChild(layer)
    // Let the browser lay the new layer out at opacity 0 before fading in.
    void layer.offsetWidth
    layer.classList.add('wpShown')
    setTimeout(() => old.forEach(el => el.remove()), FADE_MS + 60)

    const accent = await accentOf(d)
    if(key === currentKey){
        applyAccent(accent)
    }
}

exports.BUILTIN_PHOTOS = BUILTIN_PHOTOS
exports.photoUrl = photoUrl
exports.isPhotoPath = isPhotoPath
exports.resolveDefault = resolveDefault
exports.accentOf = accentOf
exports.refresh = refresh

/**
 * Mount the engine on the wallpaper element and start the clock.
 *
 * @param {HTMLElement} el The element the wallpaper layers live in.
 */
exports.init = function(el){
    root = el
    refresh(true)
    clearInterval(clock)
    // Auto time of day is re-checked every minute.
    clock = setInterval(() => refresh(), 60 * 1000)
}

/**
 * Set the selected server's raw object so its launcherTheme can apply.
 *
 * @param {Object | null} rawServer The raw server from distribution.json.
 */
exports.setServer = function(rawServer){
    const theme = rawServer != null ? rawServer.launcherTheme : null
    serverTheme = theme != null && typeof theme === 'object' ? theme : null
    refresh()
}

/**
 * Show the user's default wallpaper regardless of the server (Settings).
 */
exports.setPreferDefault = function(val){
    preferDefault = !!val
    refresh()
}

/**
 * Render a small, static preview of a vector scene.
 */
exports.preview = function(scene, palette, tod){
    return Wallpaper.render({ scene, palette, tod, motion: false })
}

/**
 * Copy a user picked image into the launcher's wallpaper folder.
 *
 * @param {File} file The picked file.
 * @returns {Promise.<string>} The stored path.
 */
exports.addPhoto = async function(file){
    const dir = getPhotosDirectory()
    await fs.ensureDir(dir)
    const ext = path.extname(file.name).toLowerCase() || '.png'
    const base = path.basename(file.name, path.extname(file.name)).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'photo'
    const dest = path.join(dir, `${Date.now()}-${base}${ext}`)
    await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()))
    return dest
}

/**
 * Delete a user photo from disk. Built-in photos are left alone.
 */
exports.removePhoto = async function(p){
    if(BUILTIN_PHOTOS.includes(p)) return
    if(path.dirname(p) === getPhotosDirectory()){
        await fs.remove(p).catch(() => {})
    }
}
