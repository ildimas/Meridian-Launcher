/**
 * Icon cache.
 *
 * Server icons are downloaded once through Node (so they follow the launcher
 * proxy and survive slow hosts) and kept on disk. Mod icons are read out of
 * the installed mod jars: fabric.mod.json / quilt.mod.json `icon`, mods.toml
 * `logoFile`, mcmod.info `logoFile`, then pack.png. A module may also carry
 * its own `icon` URL in distribution.json, which wins. Resource packs and
 * shaderpacks (zips or folders) use their pack.png or logo.
 *
 * Every lookup resolves to a file:// URL the renderer can show, or null.
 */
const AdmZip            = require('adm-zip')
const crypto            = require('crypto')
const fs                = require('fs-extra')
const got               = require('got')
const path              = require('path')
const { pathToFileURL } = require('url')

const ConfigManager     = require('./configmanager')

// A download that receives nothing for this long fails; a slow trickle is fine.
const REQUEST_TIMEOUT = { lookup: 15000, connect: 15000, secureConnect: 15000, socket: 30000 }

// Resolved URLs, so repaints don't touch the disk or the network again.
const known = new Map()
const pending = new Map()

function cacheDir(kind){
    return path.join(ConfigManager.getLauncherDirectory(), 'cache', 'icons', kind)
}

function sha1(str){
    return crypto.createHash('sha1').update(str).digest('hex')
}

/**
 * The image type of a buffer from its magic bytes, or null if it isn't one.
 */
function imageExt(buf){
    if(buf == null || buf.length < 12) return null
    if(buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png'
    if(buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg'
    if(buf.toString('ascii', 0, 3) === 'GIF') return 'gif'
    if(buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
    return null
}

function fileUrl(p, version){
    return pathToFileURL(p).href + (version ? `?v=${version}` : '')
}

async function findCached(dir, key){
    const files = await fs.readdir(dir).catch(() => [])
    const hit = files.find(f => f.startsWith(key + '.'))
    return hit != null ? path.join(dir, hit) : null
}

async function writeIcon(dir, key, buf){
    const ext = imageExt(buf)
    if(ext == null) return null
    await fs.ensureDir(dir)
    const dest = path.join(dir, `${key}.${ext}`)
    const tmp = `${dest}.${process.pid}.tmp`
    await fs.writeFile(tmp, buf)
    await fs.move(tmp, dest, { overwrite: true })
    return dest
}

async function download(url){
    const res = await got(url, { responseType: 'buffer', timeout: REQUEST_TIMEOUT, retry: 1 })
    return res.body
}

/**
 * Re-download a cached remote icon once per session and swap it in if it changed.
 */
async function revalidate(url, cached){
    try {
        const buf = await download(url)
        const old = await fs.readFile(cached).catch(() => null)
        if(old != null && old.equals(buf)) return
        const dest = await writeIcon(cacheDir('remote'), sha1(url), buf)
        if(dest != null){
            if(dest !== cached) await fs.remove(cached).catch(() => {})
            known.set(url, fileUrl(dest, Date.now()))
        }
    } catch {
        // Keep the cached copy.
    }
}

/**
 * Resolve a remote (or local) icon URL to something the renderer can show.
 *
 * @param {string} url The icon URL from distribution.json.
 * @returns {Promise.<string | null>}
 */
function remote(url){
    if(!url) return Promise.resolve(null)
    if(!/^https?:/i.test(url)) return Promise.resolve(url)
    if(known.has(url)) return Promise.resolve(known.get(url))
    if(pending.has(url)) return pending.get(url)
    const job = (async () => {
        const dir = cacheDir('remote')
        const key = sha1(url)
        const cached = await findCached(dir, key)
        if(cached != null){
            known.set(url, fileUrl(cached))
            revalidate(url, cached)
            return known.get(url)
        }
        try {
            const dest = await writeIcon(dir, key, await download(url))
            const out = dest != null ? fileUrl(dest) : null
            known.set(url, out)
            return out
        } catch {
            // Try again on the next repaint rather than remembering the failure.
            return null
        }
    })().finally(() => pending.delete(url))
    pending.set(url, job)
    return job
}

/* Mod icons. */

function readJson(text){
    try {
        return JSON.parse(text)
    } catch {
        // Some mods ship JSON with raw newlines inside strings.
        try {
            return JSON.parse(text.replace(/[\r\n\t]+/g, ' '))
        } catch {
            return null
        }
    }
}

/**
 * Pick the icon path from a fabric/quilt `icon` field: a path, or a map of
 * sizes to paths (closest to 64 wins).
 */
function pickSized(icon){
    if(typeof icon === 'string') return icon
    if(icon == null || typeof icon !== 'object') return null
    const sizes = Object.keys(icon).filter(k => typeof icon[k] === 'string').sort((a, b) => Math.abs(a - 64) - Math.abs(b - 64))
    return sizes.length > 0 ? icon[sizes[0]] : null
}

/**
 * Candidate icon paths inside a mod jar, best first.
 *
 * @param {function(string): Promise.<Buffer|null>} read Reads an entry of the jar.
 */
async function iconCandidates(read){
    const text = async (name) => {
        const buf = await read(name)
        return buf != null ? buf.toString('utf8') : null
    }
    const out = []
    const fabric = readJson(await text('fabric.mod.json') || 'null')
    if(fabric != null) out.push(pickSized(fabric.icon))
    const quilt = readJson(await text('quilt.mod.json') || 'null')
    if(quilt != null && quilt.quilt_loader != null && quilt.quilt_loader.metadata != null) out.push(pickSized(quilt.quilt_loader.metadata.icon))
    for(const toml of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']){
        const t = await text(toml)
        const m = t != null ? t.match(/^\s*logoFile\s*=\s*["']([^"']+)["']/m) : null
        if(m != null) out.push(m[1])
    }
    const info = await text('mcmod.info')
    const m = info != null ? info.match(/"logoFile"\s*:\s*"([^"]+)"/) : null
    if(m != null) out.push(m[1])
    out.push('pack.png')
    return out.filter(Boolean).map(p => p.replace(/^\.?\/+/, ''))
}

/**
 * Find the icon image through a jar entry reader.
 */
async function findModIcon(read){
    for(const name of await iconCandidates(read)){
        const buf = await read(name)
        if(imageExt(buf) != null) return buf
    }
    return null
}

function extractModIcon(jar){
    const zip = new AdmZip(jar)
    return findModIcon(async (name) => {
        const e = zip.getEntry(name)
        return e != null ? e.getData() : null
    })
}

/* Reading icons from jars that aren't downloaded yet. */

// The zip's central directory sits at the end; this covers it for mod jars.
const ZIP_TAIL = 64 * 1024 + 22
// Never pull a whole jar just for its icon.
const MAX_ENTRY = 2 * 1024 * 1024

async function fetchRange(url, start, end){
    const res = await got(url, {
        headers: { Range: `bytes=${start}-${end}` },
        responseType: 'buffer',
        timeout: REQUEST_TIMEOUT,
        retry: 1
    })
    if(res.statusCode !== 206){
        // The host ignored the range; don't treat the whole file as a slice.
        throw new Error(`Range requests are not supported by ${new URL(url).host}`)
    }
    return res.body
}

/**
 * Open a zip's central directory through a byte range reader and return a
 * reader for individual entries, so only a few kilobytes are read.
 *
 * @param {number} size The zip size.
 * @param {function(number, number): Promise.<Buffer>} range Reads bytes start..end inclusive.
 */
async function zipEntryReader(size, range){
    const zlib = require('zlib')
    const tailStart = Math.max(0, size - ZIP_TAIL)
    const tail = await range(tailStart, size - 1)

    // End of central directory record.
    let eocd = -1
    for(let i = tail.length - 22; i >= 0; i--){
        if(tail.readUInt32LE(i) === 0x06054b50){
            eocd = i
            break
        }
    }
    if(eocd < 0) throw new Error('No zip directory found.')
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = cdOffset >= tailStart
        ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
        : await range(cdOffset, cdOffset + cdSize - 1)

    const entries = new Map()
    for(let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;){
        const nameLen = cd.readUInt16LE(p + 28)
        const extraLen = cd.readUInt16LE(p + 30)
        const commentLen = cd.readUInt16LE(p + 32)
        entries.set(cd.toString('utf8', p + 46, p + 46 + nameLen), {
            method: cd.readUInt16LE(p + 10),
            compSize: cd.readUInt32LE(p + 20),
            offset: cd.readUInt32LE(p + 42)
        })
        p += 46 + nameLen + extraLen + commentLen
    }

    const read = async (name) => {
        const e = entries.get(name)
        if(e == null || e.compSize > MAX_ENTRY) return null
        // Local header (30 bytes + name + extra), then the data.
        const head = await range(e.offset, Math.min(size - 1, e.offset + 30 + 1024 + e.compSize))
        if(head.readUInt32LE(0) !== 0x04034b50) return null
        const start = 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
        const data = head.subarray(start, start + e.compSize)
        if(e.method === 0) return data
        if(e.method === 8) return zlib.inflateRawSync(data)
        return null
    }
    read.names = () => entries.keys()
    return read
}

/**
 * Entry reader for a remote jar, over HTTP range requests.
 *
 * @param {string} url The jar URL.
 * @param {number} size The jar size from distribution.json.
 */
function remoteJarReader(url, size){
    return zipEntryReader(size, (start, end) => fetchRange(url, start, end))
}

/**
 * Entry reader for a zip on disk that never loads the whole file, since
 * resource packs can be hundreds of megabytes.
 */
function localZipReader(file, size){
    return zipEntryReader(size, async (start, end) => {
        const fd = await fs.open(file, 'r')
        try {
            const buf = Buffer.alloc(end - start + 1)
            const { bytesRead } = await fs.read(fd, buf, 0, buf.length, start)
            return buf.subarray(0, bytesRead)
        } finally {
            await fs.close(fd)
        }
    })
}

/**
 * Entry reader for an unpacked pack folder.
 */
function dirReader(dir){
    const read = (name) => fs.readFile(path.join(dir, name)).catch(() => null)
    read.names = () => []
    return read
}

/* Resource pack and shaderpack icons. */

const PACK_ICONS = ['pack.png', 'logo.png', 'icon.png', 'shaders/logo.png', 'shaders/pack.png']

/**
 * Find a pack's icon. Zips that wrap everything in one top folder are
 * looked into as well.
 */
async function findPackIcon(read){
    const roots = ['']
    const top = new Set()
    for(const name of read.names()){
        const i = name.indexOf('/')
        top.add(i < 0 ? null : name.slice(0, i + 1))
    }
    if(top.size === 1 && !top.has(null)) roots.push([...top][0])
    for(const root of roots){
        for(const name of PACK_ICONS){
            const buf = await read(root + name)
            if(imageExt(buf) != null) return buf
        }
    }
    return null
}

// Jars are unzipped one at a time, yielding between them, so the UI stays live.
let modQueue = Promise.resolve()

/**
 * Icon for a mod whose jar isn't downloaded yet, read from the jar on the
 * distribution host with range requests and cached like a local one.
 *
 * @param {Object} mdl The HeliosModule.
 * @returns {Promise.<string | null>}
 */
async function remoteModIcon(mdl){
    const artifact = mdl.rawModule.artifact
    if(artifact == null || !artifact.url || !artifact.size) return null
    const dir = cacheDir('mods')
    const key = sha1(`remote|${artifact.url}|${artifact.size}|${artifact.MD5 || ''}`)
    const cached = await findCached(dir, key)
    if(cached != null) return cached.endsWith('.none') ? null : fileUrl(cached)
    let buf
    try {
        buf = await findModIcon(await remoteJarReader(artifact.url, artifact.size))
    } catch {
        // Host unreachable or no range support: try again next time.
        return null
    }
    const dest = buf != null ? await writeIcon(dir, key, buf) : null
    if(dest == null){
        await fs.ensureDir(dir)
        await fs.writeFile(path.join(dir, `${key}.none`), '')
    }
    return dest != null ? fileUrl(dest) : null
}

/**
 * Icon from a jar, zip or folder on disk, cached by path, size and mtime.
 *
 * @param {string} file The path on disk.
 * @param {string} kind Cache folder.
 * @param {function(string, fs.Stats): Promise.<Buffer|null>} extract Reads the icon.
 * @param {function(): Promise.<string|null>} missing Called when the file isn't there.
 * @returns {Promise.<string | null>}
 */
function local(file, kind, extract, missing = () => Promise.resolve(null)){
    const id = 'jar:' + file
    if(known.has(id)) return Promise.resolve(known.get(id))
    if(pending.has(id)) return pending.get(id)
    const job = (async () => {
        const stat = await fs.stat(file).catch(() => null)
        if(stat == null) return missing()
        const dir = cacheDir(kind)
        const key = sha1(`${file}|${stat.size}|${stat.mtimeMs}`)
        const cached = await findCached(dir, key)
        if(cached != null){
            const out = cached.endsWith('.none') ? null : fileUrl(cached)
            known.set(id, out)
            return out
        }
        const run = modQueue.then(async () => {
            await new Promise(r => setTimeout(r, 0))
            let buf = null
            try {
                buf = await extract(file, stat)
            } catch {
                buf = null
            }
            const dest = buf != null ? await writeIcon(dir, key, buf) : null
            if(dest == null){
                // Remember files without an icon so they aren't reopened.
                await fs.ensureDir(dir)
                await fs.writeFile(path.join(dir, `${key}.none`), '')
            }
            return dest != null ? fileUrl(dest) : null
        })
        modQueue = run.catch(() => null)
        const out = await run
        known.set(id, out)
        return out
    })().catch(() => null).finally(() => pending.delete(id))
    pending.set(id, job)
    return job
}

/**
 * Resolve the icon for a mod module.
 *
 * @param {Object} mdl The HeliosModule.
 * @returns {Promise.<string | null>}
 */
function mod(mdl){
    if(mdl.rawModule.icon) return remote(mdl.rawModule.icon)
    let jar
    try {
        jar = mdl.getPath()
    } catch {
        return Promise.resolve(null)
    }
    // Not downloaded yet: read the icon straight from the server's copy.
    return local(jar, 'mods', extractModIcon, () => remoteModIcon(mdl))
}

/**
 * Resolve the icon for a mod jar on disk, such as a drop-in mod.
 *
 * @param {string} jar The jar path.
 * @returns {Promise.<string | null>}
 */
function jar(file){
    return local(file, 'mods', extractModIcon)
}

/**
 * Resolve the icon for a resource pack or shaderpack, a zip or a folder.
 *
 * @param {string} file The pack path.
 * @returns {Promise.<string | null>}
 */
function pack(file){
    return local(file, 'packs', async (p, stat) => findPackIcon(stat.isDirectory() ? dirReader(p) : await localZipReader(p, stat.size)))
}

/**
 * The resolved URL for a remote icon or mod module, if it's already known.
 * Files on disk (drop-in mods, packs) are looked up with peekFile.
 *
 * @param {string | Object} src An icon URL or a HeliosModule.
 * @returns {string | null | undefined} undefined when not resolved yet.
 */
function peek(src){
    if(typeof src === 'string') return /^https?:/i.test(src) ? known.get(src) : src
    if(src.rawModule.icon) return peek(src.rawModule.icon)
    try {
        return known.get('jar:' + src.getPath())
    } catch {
        return null
    }
}

/**
 * The resolved URL for a file passed to jar() or pack(), if it's already known.
 *
 * @param {string} file The path on disk.
 * @returns {string | null | undefined} undefined when not resolved yet.
 */
function peekFile(file){
    return known.get('jar:' + file)
}

exports.remote = remote
exports.mod = mod
exports.jar = jar
exports.pack = pack
exports.peek = peek
exports.peekFile = peekFile
