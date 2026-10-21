/**
 * Modpack screenshots.
 *
 * Lists the screenshots the game saved for each server (F2 in game) and keeps
 * small JPEG copies of them in the launcher's cache: thumbnails for the picker
 * in Settings and screen-sized backdrops for the wallpaper. Minecraft saves
 * full-size PNGs, which are slow to decode; the copies make switching servers
 * instant. Copies are keyed by path and modification time, so an edited or
 * replaced screenshot gets fresh ones.
 */
/* global OffscreenCanvas, createImageBitmap, screen, window */
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const { pathToFileURL } = require('url')

const ConfigManager = require('./configmanager')

const SHOT_EXT = ['.png', '.jpg', '.jpeg', '.webp']
const THUMB_WIDTH = 384
const PREVIEW_WIDTH = 1024
// Encoding is queued so a folder of hundreds of screenshots can't flood memory.
const MAX_JOBS = 2

const ready = new Map()
// Screenshot lists per folder, with the folder's mtime when read.
const listCache = new Map()
const pending = new Map()
const queue = []
let running = 0

function cacheDirectory(){
    return path.join(ConfigManager.getLauncherDirectory(), 'cache', 'screenshots')
}

/**
 * The folder the game saves a server's screenshots in.
 *
 * @param {string} serverId The server id from distribution.json.
 */
function directory(serverId){
    return path.join(ConfigManager.getInstanceDirectory(), serverId, 'screenshots')
}

/**
 * A server's screenshots, newest first.
 *
 * @param {string} serverId The server id.
 * @returns {Promise.<Array.<{path: string, time: number}>>}
 */
async function list(serverId){
    const dir = directory(serverId)
    // Adding, removing or renaming a file changes the folder's mtime; the
    // wallpaper asks every cycle, so only re-read the folder when it changed.
    let dirTime
    try {
        dirTime = (await fs.stat(dir)).mtimeMs
    } catch {
        return []
    }
    const cached = listCache.get(dir)
    if(cached != null && cached.time === dirTime){
        return cached.shots
    }
    let names
    try {
        names = await fs.readdir(dir)
    } catch {
        return []
    }
    const out = await Promise.all(names
        .filter(n => SHOT_EXT.includes(path.extname(n).toLowerCase()))
        .map(async n => {
            const p = path.join(dir, n)
            try {
                const st = await fs.stat(p)
                return st.isFile() ? { path: p, time: st.mtimeMs } : null
            } catch {
                return null
            }
        }))
    const shots = out.filter(Boolean).sort((a, b) => b.time - a.time)
    listCache.set(dir, { time: dirTime, shots })
    return shots
}

// Width of a PNG from its header, so backdrops are never scaled up.
function pngWidth(buf){
    return buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 ? buf.readUInt32BE(16) : 0
}

function backdropWidth(){
    const w = Math.round(screen.width * (window.devicePixelRatio || 1))
    return Math.max(1280, Math.min(2560, w))
}

async function encode(src, dest, width){
    const buf = await fs.readFile(src)
    const natural = pngWidth(buf)
    const w = natural > 0 ? Math.min(width, natural) : width
    // Decoded and scaled off the main thread.
    const bmp = await createImageBitmap(new Blob([buf]), { resizeWidth: w, resizeQuality: 'high' })
    try {
        const canvas = new OffscreenCanvas(bmp.width, bmp.height)
        canvas.getContext('2d').drawImage(bmp, 0, 0)
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 })
        await fs.ensureDir(path.dirname(dest))
        const tmp = dest + '.tmp'
        await fs.writeFile(tmp, Buffer.from(await blob.arrayBuffer()))
        await fs.move(tmp, dest, { overwrite: true })
    } finally {
        bmp.close()
    }
}

function pump(){
    while(running < MAX_JOBS && queue.length > 0){
        const job = queue.shift()
        running++
        job().finally(() => {
            running--
            pump()
        })
    }
}

/**
 * A cached JPEG copy of a screenshot, made on first use.
 *
 * @param {string} src The screenshot.
 * @param {number} width Target width in pixels.
 * @param {boolean} urgent Jump the queue (the wallpaper is waiting on it).
 * @returns {Promise.<string | null>} A file URL, or null if it can't be read.
 */
async function copyOf(src, width, urgent){
    let st
    try {
        st = await fs.stat(src)
    } catch {
        return null
    }
    const key = crypto.createHash('sha1').update(`${src}|${st.mtimeMs}|${width}`).digest('hex').slice(0, 20)
    if(ready.has(key)) return ready.get(key)
    if(pending.has(key)){
        return pending.get(key)
    }
    const dest = path.join(cacheDirectory(), key + '.jpg')
    const job = new Promise((resolve) => {
        const run = async () => {
            try {
                if(!await fs.pathExists(dest)){
                    await encode(src, dest, width)
                }
                const url = pathToFileURL(dest).href
                ready.set(key, url)
                resolve(url)
            } catch(err) {
                console.warn('Unable to prepare screenshot', src, err)
                resolve(null)
            } finally {
                pending.delete(key)
            }
        }
        urgent ? queue.unshift(run) : queue.push(run)
        pump()
    })
    pending.set(key, job)
    return job
}

exports.directory = directory
exports.list = list

/**
 * A small copy for picker tiles.
 */
exports.thumb = function(src){
    return copyOf(src, THUMB_WIDTH, false)
}

/**
 * A mid-sized copy for the preview in Settings.
 */
exports.preview = function(src){
    return copyOf(src, PREVIEW_WIDTH, false)
}

/**
 * A screen-sized copy for the wallpaper.
 *
 * @param {string} src The screenshot.
 * @param {boolean} urgent Whether the wallpaper is waiting on it right now.
 */
exports.backdrop = function(src, urgent = true){
    return copyOf(src, backdropWidth(), urgent)
}

/**
 * Prepare backdrops for every favourite in the background, so the first
 * switch to each server is already instant.
 *
 * @param {Object.<string, Array.<string>>} favourites Paths per server id.
 */
exports.warm = function(favourites){
    for(const paths of Object.values(favourites || {})){
        for(const p of paths){
            exports.backdrop(p, false)
        }
    }
}

/**
 * Whether a path still points at a screenshot on disk.
 */
exports.exists = function(p){
    return typeof p === 'string' && fs.existsSync(p)
}
