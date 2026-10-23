/**
 * Theme engine.
 *
 * Owns the wallpaper behind every view. Each modpack has one set of pictures:
 *   - its pack images: what ships in images/modpacks/<server id>/, the
 *     wallpapers its distribution.json entry lists (packwallpapers.js) and
 *     pictures the player added. A pack with none of these gets a few
 *     pictures from the bundled Photon Shaders gallery (images/wallpapers/),
 *     always the same ones for that pack.
 *   - the player's screenshots of that modpack (F2 in game).
 * Every picture is in rotation unless the player unticked it (Settings >
 * Appearance). They take turns in a shuffled order, and pictures with a
 * known author are credited on the landing screen. Colours stay Meridian
 * whatever is shown.
 */
/* global document, window, Image */
const fs = require('fs-extra')
const path = require('path')
const { pathToFileURL } = require('url')

const ConfigManager = require('./configmanager')
const PackWallpapers = require('./packwallpapers')
const Screenshots = require('./screenshots')
const GALLERY = require('../images/wallpapers/wallpapers.json')

const FADE_MS = 900
// Turning the dial fast only paints the server it stops on.
const SERVER_SETTLE_MS = 140
// Gallery pictures a pack without its own art gets.
const GALLERY_SAMPLE = 5
const INTERVALS = [15, 30, 60, 300]
const PHOTO_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']
// Paths are relative to app/, where app.ejs lives.
const GALLERY_DIR = 'assets/images/wallpapers'
const GALLERY_FILES = path.join(__dirname, '..', 'images', 'wallpapers')
// Screenshots shipped for each modpack, one folder per server id.
const MODPACK_DIR = path.join(__dirname, '..', 'images', 'modpacks')

let root = null
let serverId = null
let serverTimer = null
let cycleTimer = null
let currentKey = null
let refreshToken = 0
let lastCount = 0
// Settings is open: show a blurred copy of the wallpaper.
let blurred = false
// Order and position per picture pool.
const rotations = new Map()
// Pictures per modpack folder, read once.
const modpackCache = new Map()
// Files that couldn't be read this session.
const badFiles = new Set()

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
    return pathToFileURL(p).href
}

function getPhotosDirectory(){
    return path.join(ConfigManager.getLauncherDirectory(), 'wallpapers')
}

function galleryCredit(w){
    return { author: w.author, source: GALLERY.shader, link: GALLERY.gallery, detail: w.resourcePack }
}

function galleryItems(){
    return GALLERY.wallpapers.map(w => ({
        key: `gallery|${w.id}`,
        kind: 'gallery',
        url: `${GALLERY_DIR}/${w.id}.webp`,
        file: path.join(GALLERY_FILES, `${w.id}.webp`),
        credit: galleryCredit(w)
    }))
}

/**
 * The screenshots shipped for a modpack. An optional credits.json in the
 * folder names authors: { "file.png": "Author" }, or "*" for all of them.
 */
function modpackShots(id){
    if(modpackCache.has(id)) return modpackCache.get(id)
    const dir = path.join(MODPACK_DIR, id)
    let list = []
    try {
        let credits = {}
        try {
            credits = fs.readJsonSync(path.join(dir, 'credits.json'))
        } catch {
            // Credits are optional.
        }
        list = fs.readdirSync(dir)
            .filter(isPhotoPath)
            .sort()
            .map(name => {
                const author = credits[name] || credits['*']
                return { key: `pack|${id}|${name}`, kind: 'pack', file: path.join(dir, name), credit: author ? { author } : null }
            })
    } catch {
        // No folder: this modpack uses the gallery.
    }
    modpackCache.set(id, list)
    return list
}

/**
 * The wallpapers a modpack's distribution.json entry lists, those already
 * downloaded. The rest are fetched, and the wallpaper repaints as they land.
 */
function remoteShots(id){
    // Required here: the distribution manager loads after the theme engine.
    const raw = require('./distromanager').DistroAPI.rawDistribution
    const servers = raw != null && Array.isArray(raw.servers) ? raw.servers : []
    const server = servers.find(s => s.id === id)
    return PackWallpapers.cached(server, servers, () => refresh()).map(w => ({
        key: `remote|${id}|${w.md5}`,
        kind: 'pack',
        file: w.file,
        url: photoUrl(w.file),
        credit: w.author ? { author: w.author } : null
    }))
}

function packSettings(appearance, id){
    return appearance.packs[id] || {}
}

/**
 * The gallery pictures for a pack without art of its own: a few picked by
 * its id, so each pack keeps the same ones and packs differ from each other.
 */
function gallerySample(id){
    const items = galleryItems()
    let seed = 0
    for(const c of id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
    // xorshift never leaves zero.
    seed = seed || 1
    const out = []
    while(out.length < Math.min(GALLERY_SAMPLE, items.length)){
        // xorshift: a small seeded generator.
        seed ^= seed << 13; seed >>>= 0
        seed ^= seed >>> 17
        seed ^= seed << 5; seed >>>= 0
        const item = items[seed % items.length]
        if(!out.includes(item)) out.push(item)
    }
    return out
}

/**
 * A modpack's pack images: what ships with it, what its distribution.json
 * entry lists and what the player added, or a few gallery pictures when it
 * has none of these.
 *
 * @returns {{borrowed: boolean, items: Array.<Object>}}
 */
function packArt(id){
    const added = (packSettings(ConfigManager.getAppearance(), id).added || [])
        .filter(p => fs.existsSync(p))
        .map(p => ({ key: `photo|${p}`, kind: 'added', file: p }))
    const own = modpackShots(id).concat(remoteShots(id), added)
    if(own.length > 0){
        return { borrowed: false, items: own }
    }
    return { borrowed: true, items: gallerySample(id) }
}

/**
 * The player's screenshots of a modpack, newest first.
 */
async function packShots(id){
    return (await Screenshots.list(id)).map(s => ({ key: `shot|${s.path}`, kind: 'shot', file: s.path, time: s.time }))
}

/**
 * What a modpack puts in rotation: every picture it has, the ones unticked,
 * and the pictures actually cycled.
 *
 * @param {string} id The server id.
 * @returns {Promise.<{art: Object, shots: Array.<Object>, hidden: Set.<string>, list: {id: string, items: Array.<Object>}}>}
 */
async function packRotation(id){
    const hidden = new Set(packSettings(ConfigManager.getAppearance(), id).hidden || [])
    const usable = it => !badFiles.has(it.file)
    const art = packArt(id)
    const shots = await packShots(id)
    let items = art.items.concat(shots).filter(it => usable(it) && !hidden.has(it.key))
    // Everything unticked: show the pack images anyway rather than nothing.
    if(items.length === 0){
        items = art.items.filter(usable)
    }
    return { art, shots, hidden, list: { id: `pack|${id}`, items } }
}

/**
 * The pictures to cycle through right now.
 */
async function playlist(){
    if(serverId == null){
        return { id: 'gallery', items: galleryItems().filter(it => !badFiles.has(it.file)) }
    }
    return (await packRotation(serverId)).list
}

function shuffle(list){
    const out = list.slice()
    for(let i = out.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

/**
 * A pool's current picture, optionally moving on to the next one.
 */
function pick(list, advance){
    const keys = list.items.map(it => it.key)
    const known = new Set(keys)
    let rot = rotations.get(list.id)
    // New pool, or its pictures changed: start a fresh shuffle.
    if(rot == null || rot.order.length !== keys.length || rot.order.some(k => !known.has(k))){
        rot = { order: shuffle(keys), i: 0 }
        rotations.set(list.id, rot)
    } else if(advance){
        rot.i++
        if(rot.i >= rot.order.length){
            const last = rot.order[rot.order.length - 1]
            rot.order = shuffle(keys)
            // Never show the same picture twice in a row across rounds.
            if(rot.order.length > 1 && rot.order[0] === last){
                rot.order.push(rot.order.shift())
            }
            rot.i = 0
        }
    }
    return list.items.find(it => it.key === rot.order[rot.i])
}

/**
 * Load and decode an image off the main thread before it is shown.
 */
async function decoded(url){
    const img = new Image()
    img.className = 'wpImg'
    img.alt = ''
    img.decoding = 'async'
    img.src = url
    try {
        await img.decode()
    } catch {
        // Shown anyway; a broken image just leaves the layer dark.
    }
    return img
}

/**
 * Credit the author of the picture on screen, or hide the credit.
 */
function showCredit(credit){
    const el = document.getElementById('wallpaperCredit')
    if(el == null) return
    el.hidden = credit == null
    if(credit == null) return
    el.querySelector('.wallpaperCreditAuthor').textContent = credit.author
    el.toggleAttribute('linked', credit.link != null)
    el.setAttribute('data-link', credit.link || '')
    // Where the picture is from stays out of the way, in the tooltip.
    el.title = [credit.source, credit.detail ? `Resource pack: ${credit.detail}` : null].filter(Boolean).join('\n')
}

// The blurred copy is drawn this many times smaller than the window.
const BLUR_SCALE = 8

/**
 * Draw the wallpaper on screen, blurred, into a small canvas stretched over
 * it, or drop that copy when settings closes.
 */
function paintBlur(){
    if(root == null) return
    const old = root.querySelector('.wpBlur')
    const layers = root.getElementsByClassName('wpLayer')
    const img = layers.length > 0 ? layers[layers.length - 1].querySelector('.wpImg') : null
    if(!blurred || img == null || img.naturalWidth === 0){
        if(old != null){
            old.classList.remove('wpShown')
            setTimeout(() => old.remove(), 320)
        }
        return
    }
    const canvas = document.createElement('canvas')
    canvas.className = 'wpBlur'
    canvas.width = Math.max(64, Math.round(window.innerWidth / BLUR_SCALE))
    canvas.height = Math.max(36, Math.round(window.innerHeight / BLUR_SCALE))
    const ctx = canvas.getContext('2d')
    // Like the old 24px backdrop blur, at the canvas' scale.
    ctx.filter = `blur(${24 / BLUR_SCALE}px) saturate(140%)`
    // Cover the canvas, a little oversized so the blur has no soft edges.
    const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight) * 1.06
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
    root.appendChild(canvas)
    void canvas.offsetWidth
    canvas.classList.add('wpShown')
    if(old != null){
        setTimeout(() => old.remove(), 320)
    }
}

function scheduleCycle(count){
    lastCount = count
    clearTimeout(cycleTimer)
    // Nothing to cycle, or nobody is looking (another window has focus).
    if(count < 2 || !document.hasFocus()) return
    const seconds = ConfigManager.getAppearance().interval
    cycleTimer = setTimeout(() => refresh(true), (INTERVALS.includes(seconds) ? seconds : 30) * 1000)
}

/**
 * Re-resolve the wallpaper and cross-fade to it if it changed.
 *
 * @param {boolean} advance Move on to the playlist's next picture.
 */
async function refresh(advance = false){
    if(root == null) return
    const token = ++refreshToken
    const list = await playlist()
    // A newer refresh started while the screenshots were listed.
    if(token !== refreshToken) return
    const item = pick(list, advance)
    const motion = ConfigManager.getAppearance().motion !== false
    scheduleCycle(list.items.length)
    if(item == null) return
    const key = `${item.key}|${motion}`
    if(key === currentKey) return
    currentKey = key

    let url = item.url
    if(url == null){
        // Screenshots are big PNGs; show a cached copy sized for the screen.
        url = await Screenshots.backdrop(item.file)
        if(url == null){
            badFiles.add(item.file)
            currentKey = null
            return refresh()
        }
    }
    const layer = document.createElement('div')
    layer.className = 'wpLayer'
    layer.toggleAttribute('still', !motion)
    layer.appendChild(await decoded(url))
    // Something newer was asked for while this one loaded.
    if(key !== currentKey) return
    const old = Array.from(root.getElementsByClassName('wpLayer'))
    // Only the layer fading out needs to stay; drop anything older at once.
    old.slice(0, -1).forEach(el => el.remove())
    root.appendChild(layer)
    // Let the browser lay the new layer out at opacity 0 before fading in.
    void layer.offsetWidth
    layer.classList.add('wpShown')
    setTimeout(() => old.forEach(el => el.remove()), FADE_MS + 60)
    if(blurred) paintBlur()
    showCredit(item.credit)
}

exports.GALLERY = GALLERY
exports.MODPACK_DIR = MODPACK_DIR
exports.photoUrl = photoUrl
exports.isPhotoPath = isPhotoPath
exports.packArt = packArt
exports.galleryItems = galleryItems
exports.packShots = packShots
exports.packRotation = packRotation
exports.refresh = () => refresh()

/**
 * Show the wallpaper blurred and still, for settings.
 */
exports.setBlurred = function(on){
    if(on === blurred) return
    blurred = on
    paintBlur()
}

/**
 * Mount the engine on the wallpaper element.
 *
 * @param {HTMLElement} el The element the wallpaper layers live in.
 */
exports.init = function(el){
    root = el
    // Without GPU compositing every frame of the drift is redrawn on the CPU,
    // blurs on top included, so the pictures hold still (launcher.css).
    const gpu = String(require('@electron/remote').app.getGPUFeatureStatus().gpu_compositing)
    document.documentElement.toggleAttribute('noGpu', !gpu.startsWith('enabled'))
    refresh()
    // While the game or another app has focus, stop the drift and the
    // cycling instead of spending GPU and disk on them.
    window.addEventListener('blur', () => {
        root.classList.add('wpPaused')
        clearTimeout(cycleTimer)
    })
    window.addEventListener('focus', () => {
        root.classList.remove('wpPaused')
        scheduleCycle(lastCount)
    })
    document.getElementById('wallpaperCredit')?.addEventListener('click', e => {
        const link = e.currentTarget.getAttribute('data-link')
        if(link) require('electron').shell.openExternal(link)
    })
}

/**
 * Show the wallpaper for the selected server.
 *
 * @param {Object | null} rawServer The raw server from distribution.json.
 */
exports.setServer = function(rawServer){
    const id = rawServer != null ? rawServer.id : null
    const changed = id !== serverId
    serverId = id
    clearTimeout(serverTimer)
    // Every switch brings a new picture, like a console's game backdrops.
    serverTimer = setTimeout(() => refresh(changed), SERVER_SETTLE_MS)
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
 * Delete a user photo from disk.
 */
exports.removePhoto = async function(p){
    if(path.dirname(p) === getPhotosDirectory()){
        await fs.remove(p).catch(() => {})
    }
}
