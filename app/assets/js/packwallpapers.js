/**
 * Modpack wallpapers from distribution.json.
 *
 * A pack may list pictures of its own (Meridian Studio, Wallpapers tab):
 * `wallpapers: [{ url, MD5, size, author }]`. They are downloaded through
 * Node (so they follow the launcher proxy) into the launcher's cache, named
 * by their MD5 and checked against it, so a picture is never shown half
 * written or out of date. A pack whose pictures haven't arrived yet keeps
 * what it showed before.
 */
const crypto = require('crypto')
const fs     = require('fs-extra')
const got    = require('got')
const path   = require('path')

const ConfigManager = require('./configmanager')

// A download that receives nothing for this long fails; a slow trickle is fine.
const REQUEST_TIMEOUT = { lookup: 15000, connect: 15000, secureConnect: 15000, socket: 30000 }
const TYPES = ['.webp', '.jpg', '.jpeg', '.png']
// Pictures are up to 4K; a couple at a time is plenty.
const MAX_JOBS = 2

const queue = []
const queued = new Set()
// Pictures that failed this session; tried again on the next start.
const failed = new Set()
let running = 0
let pruned = false

function cacheDirectory(){
    return path.join(ConfigManager.getLauncherDirectory(), 'cache', 'wallpapers')
}

/**
 * The well-formed entries of a raw server's `wallpapers`.
 */
function entries(rawServer){
    const list = rawServer != null && Array.isArray(rawServer.wallpapers) ? rawServer.wallpapers : []
    return list.filter(w => w != null && /^https?:\/\//i.test(w.url) && /^[a-f0-9]{32}$/i.test(w.MD5))
}

function fileFor(w){
    let ext = '.webp'
    try {
        const e = path.extname(new URL(w.url).pathname).toLowerCase()
        if(TYPES.includes(e)) ext = e
    } catch {
        // Keep .webp.
    }
    return path.join(cacheDirectory(), w.MD5.toLowerCase() + ext)
}

async function fetchOne(w){
    const res = await got(w.url, { responseType: 'buffer', timeout: REQUEST_TIMEOUT, retry: { limit: 2 } })
    const md5 = crypto.createHash('md5').update(res.body).digest('hex')
    if(md5 !== w.MD5.toLowerCase()){
        throw new Error(`MD5 mismatch: expected ${w.MD5}, got ${md5}`)
    }
    const dest = fileFor(w)
    await fs.ensureDir(path.dirname(dest))
    const tmp = `${dest}.${process.pid}.tmp`
    await fs.writeFile(tmp, res.body)
    await fs.move(tmp, dest, { overwrite: true })
}

function pump(){
    while(running < MAX_JOBS && queue.length > 0){
        const { w, onReady } = queue.shift()
        const key = w.MD5.toLowerCase()
        running++
        fetchOne(w).then(() => {
            if(onReady) onReady()
        }, err => {
            failed.add(key)
            console.warn('Unable to download pack wallpaper', w.url, err.message)
        }).finally(() => {
            queued.delete(key)
            running--
            pump()
        })
    }
}

/**
 * Drop cached pictures no pack lists any more. Once per session, before
 * anything is downloaded.
 */
function prune(rawServers){
    if(pruned) return
    pruned = true
    const keep = new Set()
    for(const s of rawServers || []){
        for(const w of entries(s)) keep.add(path.basename(fileFor(w)))
    }
    fs.readdir(cacheDirectory()).then(files => Promise.all(files
        .filter(f => !keep.has(f) && !queued.has(f.split('.')[0]))
        .map(f => fs.remove(path.join(cacheDirectory(), f)).catch(() => {}))
    )).catch(() => {
        // No cache yet.
    })
}

/**
 * A pack's pictures that are on disk, in its order. The others start
 * downloading, and `onReady` runs each time one of them lands.
 *
 * @param {Object | null} rawServer The raw server from distribution.json.
 * @param {Array.<Object>} rawServers Every raw server, to tidy the cache.
 * @param {function(): void} onReady Called when a missing picture arrives.
 * @returns {Array.<{file: string, author: string | null, md5: string}>}
 */
exports.cached = function(rawServer, rawServers, onReady){
    prune(rawServers)
    const out = []
    for(const w of entries(rawServer)){
        const key = w.MD5.toLowerCase()
        const file = fileFor(w)
        if(fs.existsSync(file)){
            out.push({ file, author: typeof w.author === 'string' && w.author ? w.author : null, md5: key })
        } else if(!failed.has(key) && !queued.has(key)){
            queued.add(key)
            queue.push({ w, onReady })
        }
    }
    pump()
    return out
}
