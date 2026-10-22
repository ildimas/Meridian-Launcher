/**
 * Installs modpacks the player adds from the Modpacks tab: Modrinth (.mrpack),
 * CurseForge (.zip) and Prism / MultiMC (.zip) exports, packs found through
 * the Modrinth and CurseForge search, and plain Minecraft versions.
 *
 * A pack becomes a distribution server (see localpacks.js) whose modules are
 * only its mod loader; mods, configs and other overrides are written straight
 * into the pack's instance folder, where the game picks them up like drop-ins.
 *
 * Supported loaders are Vanilla, Fabric, Quilt, Forge and NeoForge. Forge and
 * NeoForge go through their installer's steps in forgeinstaller.js.
 */
const AdmZip       = require('adm-zip')
const crypto       = require('crypto')
const fs           = require('fs-extra')
const got          = require('got')
const os           = require('os')
const path         = require('path')
const semver       = require('semver')
const { pipeline } = require('stream/promises')
const { MavenUtil } = require('helios-core/common')
const { Type }     = require('helios-distribution-types')
const { app }      = require('@electron/remote')

const { downloadFile } = require('helios-core/dl')
const { discoverBestJvmInstallation, javaExecFromRoot, latestOpenJDK, extractJdk } = require('helios-core/java')
const { JdkDistribution } = require('helios-distribution-types')

const ConfigManager  = require('./configmanager')
const ForgeInstaller = require('./forgeinstaller')
const LocalPacks     = require('./localpacks')

const MODRINTH = 'https://api.modrinth.com/v2'
const CURSEFORGE = 'https://api.curseforge.com/v1'
const CF_GAME_MINECRAFT = 432
const CF_CLASS_MODPACK = 4471
// CurseForge class ids of the content that doesn't go into mods/.
const CF_CLASS_FOLDERS = { 12: 'resourcepacks', 6552: 'shaderpacks' }
// CurseForge modLoader ids in latestFilesIndexes.
const CF_LOADERS = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }

const LOADERS = {
    fabric: {
        name: 'Fabric',
        meta: 'https://meta.fabricmc.net/v2',
        artifact: 'net.fabricmc:fabric-loader'
    },
    quilt: {
        name: 'Quilt',
        meta: 'https://meta.quiltmc.org/v3',
        artifact: 'org.quiltmc:quilt-loader'
    }
}
// Loaders this launcher can't install; every loader packs use is covered now.
const UNSUPPORTED_LOADERS = {}

/**
 * @param {string} loader A loader id (fabric, quilt, forge, neoforge).
 * @returns {boolean} Whether packs on it can be installed.
 */
function isKnownLoader(loader){
    return LOADERS[loader] != null || ForgeInstaller.isForgeLike(loader)
}

function loaderName(loader){
    return LOADERS[loader] != null ? LOADERS[loader].name : (ForgeInstaller.NAMES[loader] || loader)
}

const DOWNLOAD_THREADS = 6

/**
 * A failure to show the player. `key` names a string under
 * settings.modpacks.errors in the language files.
 */
class ModpackError extends Error {
    constructor(key, params = {}){
        super(key)
        this.key = key
        this.params = params
    }
}
exports.ModpackError = ModpackError

/* HTTP */

function userAgent(){
    // Modrinth asks clients to identify themselves.
    return `${app.getName()}/${app.getVersion()} (github.com/dscalzi/HeliosLauncher)`
}

function http(){
    return got.extend({
        headers: { 'user-agent': userAgent() },
        timeout: { request: 30000 },
        retry: { limit: 2 }
    })
}

/**
 * For file downloads. A whole-request timeout cuts off any big mod that
 * takes longer than it, so only a stalled connection times out.
 */
function httpDownload(){
    return got.extend({
        headers: { 'user-agent': userAgent() },
        timeout: { lookup: 15000, connect: 15000, secureConnect: 15000, response: 30000, socket: 60000 }
    })
}

// Tries per URL. got does not retry streams on its own.
const DOWNLOAD_ATTEMPTS = 3

function curseForgeKey(){
    return ConfigManager.getCurseForgeApiKey() || process.env.CURSEFORGE_API_KEY || ''
}

/**
 * @returns {boolean} Whether CurseForge can be used (an API key is set).
 */
exports.hasCurseForge = function(){
    return curseForgeKey() !== ''
}

function curseForge(){
    const key = curseForgeKey()
    if(!key){
        throw new ModpackError('curseForgeKey')
    }
    return http().extend({ prefixUrl: CURSEFORGE, headers: { 'x-api-key': key } })
}

/**
 * Download a file, trying each URL in turn, and check its hash.
 *
 * @param {Array.<string>} urls Where the file can be downloaded from.
 * @param {string} dest Where to write it.
 * @param {{sha1?: string, sha512?: string, md5?: string}} hashes Expected hashes.
 */
async function download(urls, dest, hashes = {}){
    await fs.ensureDir(path.dirname(dest))
    const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`
    const algo = ['sha512', 'sha1', 'md5'].find(a => hashes[a])
    let lastErr = null
    for(const url of urls){
        for(let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++){
            try {
                const hash = algo != null ? crypto.createHash(algo) : null
                const stream = httpDownload().stream(url)
                if(hash != null){
                    stream.on('data', chunk => hash.update(chunk))
                }
                await pipeline(stream, fs.createWriteStream(tmp))
                if(hash != null && hash.digest('hex') !== String(hashes[algo]).toLowerCase()){
                    throw new Error(`Hash mismatch for ${url}`)
                }
                await fs.move(tmp, dest, { overwrite: true })
                return
            } catch(err) {
                lastErr = err
                await fs.remove(tmp).catch(() => {})
                // Missing or refused: another try won't help.
                const status = err.response != null ? err.response.statusCode : null
                if(status != null && status >= 400 && status < 500){
                    break
                }
            }
        }
    }
    throw lastErr || new Error(`No download for ${dest}`)
}

/**
 * A short, technical reason a download failed, to show next to the file.
 */
function failureReason(err){
    if(err != null && err.response != null && err.response.statusCode != null){
        return `HTTP ${err.response.statusCode}`
    }
    if(err != null && err.code){
        return err.code
    }
    return err != null && err.message ? err.message : String(err)
}

/**
 * Run download jobs a few at a time.
 *
 * @param {Array.<function(): Promise>} jobs The downloads.
 * @param {function(number, number)} onProgress Called with done and total.
 */
async function runAll(jobs, onProgress){
    let next = 0
    let done = 0
    onProgress(0, jobs.length)
    const worker = async () => {
        while(next < jobs.length){
            const job = jobs[next++]
            await job()
            onProgress(++done, jobs.length)
        }
    }
    await Promise.all(Array.from({ length: Math.min(DOWNLOAD_THREADS, jobs.length) }, worker))
}

/* Paths */

function instanceDir(id){
    return path.join(ConfigManager.getInstanceDirectory(), id)
}

/**
 * Resolve a path from a pack inside its instance folder, refusing any that
 * would escape it (absolute paths, `..`).
 */
function safeJoin(root, rel){
    root = path.resolve(root)
    const out = path.resolve(root, rel)
    if(out !== root && !out.startsWith(root + path.sep)){
        throw new ModpackError('badPath', { path: rel })
    }
    return out
}

/**
 * Write every zip entry under a folder into the instance folder.
 *
 * @param {AdmZip} zip The pack.
 * @param {string} prefix The folder inside the zip, with a trailing slash.
 * @param {string} dest The instance folder.
 */
async function extractFolder(zip, prefix, dest){
    for(const entry of zip.getEntries()){
        if(entry.isDirectory || !entry.entryName.startsWith(prefix)){
            continue
        }
        const rel = entry.entryName.substring(prefix.length)
        if(!rel){
            continue
        }
        const out = safeJoin(dest, rel)
        await fs.ensureDir(path.dirname(out))
        await fs.writeFile(out, entry.getData())
    }
}

/**
 * A stable, readable server id that isn't taken yet.
 */
function newServerId(name){
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40) || 'pack'
    const taken = new Set(LocalPacks.read(ConfigManager.getLauncherDirectory()).map(s => s.id))
    let id
    do {
        id = `local-${slug}-${crypto.randomBytes(3).toString('hex')}`
    } while(taken.has(id) || fs.existsSync(instanceDir(id)))
    return id
}

/* Versions */

/**
 * Minecraft releases, newest first.
 *
 * @param {boolean} snapshots Include snapshots.
 * @returns {Promise.<Array.<string>>}
 */
exports.minecraftVersions = async function(snapshots = false){
    const res = await http().get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json').json()
    return res.versions.filter(v => v.type === 'release' || (snapshots && v.type === 'snapshot')).map(v => v.id)
}

/**
 * Loader versions for a Minecraft version, newest first.
 *
 * @param {string} loader fabric, quilt, forge or neoforge.
 * @param {string} mc The Minecraft version.
 * @returns {Promise.<Array.<{version: string, stable: boolean}>>}
 */
exports.loaderVersions = async function(loader, mc){
    if(ForgeInstaller.isForgeLike(loader)){
        return await ForgeInstaller.versions(http(), loader, mc)
    }
    const def = LOADERS[loader]
    let list
    try {
        list = await http().get(`${def.meta}/versions/loader/${encodeURIComponent(mc)}`).json()
    } catch(err) {
        if(err.response != null && (err.response.statusCode === 400 || err.response.statusCode === 404)){
            return []
        }
        throw err
    }
    // Quilt has no stable flag; its betas carry it in the version. Its list
    // isn't in order either.
    return list.map(e => ({
        version: e.loader.version,
        stable: e.loader.stable != null ? e.loader.stable : !/beta|pre|rc/i.test(e.loader.version)
    })).sort((a, b) => semver.valid(a.version) && semver.valid(b.version) ? semver.rcompare(a.version, b.version) : 0)
}

/* Mod loader modules */

/**
 * Download a loader's libraries and describe them as distribution modules.
 * The files are fetched here so their MD5 and size are known; helios-core
 * then finds them valid on launch.
 *
 * @param {string} loader fabric or quilt.
 * @param {string} mc The Minecraft version.
 * @param {string} version The loader version.
 * @param {function(number, number)} onProgress Called with done and total.
 * @returns {Promise.<Array.<Object>>} The server's modules.
 */
async function loaderModules(loader, mc, version, onProgress){
    const def = LOADERS[loader]
    const profileUrl = `${def.meta}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/profile/json`
    let body
    try {
        body = await http().get(profileUrl).buffer()
    } catch {
        throw new ModpackError('loaderUnavailable', { loader: def.name, version, minecraft: mc })
    }
    const profile = JSON.parse(body.toString('utf-8'))

    const commonDir = ConfigManager.getCommonDirectory()
    const manifestPath = path.join(commonDir, 'versions', profile.id, `${profile.id}.json`)
    await fs.ensureDir(path.dirname(manifestPath))
    await fs.writeFile(manifestPath, body)

    const libs = profile.libraries.map(lib => {
        const rel = MavenUtil.mavenIdentifierAsPath(lib.name)
        const base = (lib.url || 'https://repo1.maven.org/maven2/').replace(/\/?$/, '/')
        return { lib, url: base + rel, file: path.join(commonDir, 'libraries', path.normalize(rel)) }
    })
    await runAll(libs.map(l => async () => {
        if(!await fs.pathExists(l.file)){
            await download([l.url], l.file, { sha1: l.lib.sha1, md5: l.lib.md5 })
        }
    }), onProgress)

    const artifact = async (file, url) => {
        const buf = await fs.readFile(file)
        return { size: buf.length, MD5: crypto.createHash('md5').update(buf).digest('hex'), url }
    }
    const loaderLib = libs.find(l => l.lib.name.startsWith(def.artifact + ':'))
    if(loaderLib == null){
        throw new ModpackError('loaderUnavailable', { loader: def.name, version, minecraft: mc })
    }
    const subModules = [{
        id: profile.id,
        name: `${def.name} version manifest`,
        type: Type.VersionManifest,
        artifact: await artifact(manifestPath, profileUrl)
    }]
    for(const l of libs){
        if(l !== loaderLib){
            subModules.push({ id: l.lib.name, name: l.lib.name, type: Type.Library, artifact: await artifact(l.file, l.url) })
        }
    }
    return [{
        id: loaderLib.lib.name,
        name: `${def.name} Loader`,
        // helios-core launches Quilt the same way as Fabric.
        type: Type.Fabric,
        artifact: await artifact(loaderLib.file, loaderLib.url),
        subModules
    }]
}

/**
 * Check the loader is one this launcher can install.
 */
function requireSupportedLoader(loader){
    if(UNSUPPORTED_LOADERS[loader] != null){
        throw new ModpackError('unsupportedLoader', { loader: UNSUPPORTED_LOADERS[loader] })
    }
    if(loader !== 'vanilla' && !isKnownLoader(loader)){
        throw new ModpackError('unsupportedLoader', { loader })
    }
}

/**
 * The Java version Mojang declares for a Minecraft version, so the launcher
 * picks (or installs) a matching runtime. Null if it can't be found.
 */
async function javaOptions(mc){
    try {
        const manifest = await http().get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json').json()
        const entry = manifest.versions.find(v => v.id === mc)
        if(entry == null){
            return null
        }
        const version = await http().get(entry.url).json()
        const major = version.javaVersion != null ? version.javaVersion.majorVersion : null
        return major != null ? { supported: `>=${major}.x`, suggestedMajor: major } : null
    } catch {
        return null
    }
}

/**
 * A Java executable for a Minecraft version, for the Forge installer's
 * processors: an installed one if it fits, otherwise the one the launcher
 * would install for the game anyway.
 */
async function javaFor(mc){
    const opts = await javaOptions(mc)
    const major = opts != null ? opts.suggestedMajor : 17
    const dataDir = ConfigManager.getDataDirectory()
    const found = await discoverBestJvmInstallation(dataDir, `>=${major}.x`)
    if(found != null){
        return javaExecFromRoot(found.path)
    }
    const asset = await latestOpenJDK(major, dataDir, process.platform === 'darwin' ? JdkDistribution.CORRETTO : JdkDistribution.TEMURIN)
    if(asset == null){
        throw new ModpackError('javaUnavailable', { major })
    }
    await downloadFile(asset.url, asset.path)
    return await extractJdk(asset.path)
}

/**
 * Install Forge or NeoForge and describe it as distribution modules.
 */
async function forgeModules(pack, progress){
    try {
        const res = await ForgeInstaller.install({ loader: pack.loader, minecraft: pack.minecraft, version: pack.loaderVersion }, {
            http: http(),
            download,
            runAll,
            java: () => javaFor(pack.minecraft),
            commonDir: ConfigManager.getCommonDirectory(),
            onProgress: (done, total) => progress({ stage: 'loader', done, total })
        })
        pack.loaderVersion = res.version
        return res.modules
    } catch(err) {
        if(err instanceof ModpackError){
            throw err
        }
        console.error(`Unable to install ${loaderName(pack.loader)} ${pack.loaderVersion}.`, err)
        const params = { loader: loaderName(pack.loader), version: pack.loaderVersion || '', minecraft: pack.minecraft }
        // No installer for that version; anything else is a real failure to report.
        if(err.response != null && err.response.statusCode === 404 && String(err.response.url).endsWith('-installer.jar')){
            throw new ModpackError('loaderUnavailable', params)
        }
        throw new ModpackError('loaderFailed', { ...params, message: err.message || String(err) })
    }
}

/**
 * The memory a pack asks for, as distribution javaOptions.ram. Capped at what
 * the launcher lets the game have on this machine, so the pack still starts.
 *
 * @param {number} mb Megabytes the pack recommends, if it says.
 */
function packRam(mb){
    const ram = Number.parseInt(mb)
    if(!(ram > 0)){
        return null
    }
    return { recommended: Math.min(ram, ConfigManager.getAbsoluteMaxRAM() * 1024) }
}

/**
 * Create the server for a pack and store it.
 *
 * @param {Object} pack id, name, description, icon, version, minecraft, loader, loaderVersion, source, ram (MB).
 * @param {function(Object)} progress Progress callback.
 */
async function savePack(pack, progress){
    let modules = []
    if(ForgeInstaller.isForgeLike(pack.loader)){
        modules = await forgeModules(pack, progress)
    } else if(pack.loader !== 'vanilla'){
        modules = await loaderModules(pack.loader, pack.minecraft, pack.loaderVersion, (done, total) => {
            progress({ stage: 'loader', done, total })
        })
    }
    const java = await javaOptions(pack.minecraft)
    const ram = packRam(pack.ram)
    const server = {
        id: pack.id,
        name: pack.name,
        description: pack.description || '',
        icon: pack.icon || '',
        version: pack.version || '1.0.0',
        // Local packs aren't tied to a server; nothing is pinged or joined.
        address: '',
        minecraftVersion: pack.minecraft,
        mainServer: false,
        autoconnect: false,
        ...(java != null || ram != null ? { javaOptions: { ...java, ...(ram != null ? { ram } : {}) } } : {}),
        modules,
        local: {
            source: pack.source,
            loader: pack.loader,
            loaderVersion: pack.loaderVersion || null,
            installed: new Date().toISOString()
        }
    }
    const dir = ConfigManager.getLauncherDirectory()
    const servers = LocalPacks.read(dir).filter(s => s.id !== server.id)
    servers.push(server)
    LocalPacks.write(dir, servers)
    return server
}

/**
 * Run an install, removing the half-written instance folder if it fails.
 */
async function withInstance(id, fn){
    try {
        return await fn(instanceDir(id))
    } catch(err) {
        await fs.remove(instanceDir(id)).catch(() => {})
        throw err
    }
}

/* Plain versions */

/**
 * Install a Minecraft version, optionally with Fabric or Quilt.
 *
 * @param {{name: string, minecraft: string, loader: string, loaderVersion?: string}} opts The version.
 * @param {function(Object)} progress Progress callback.
 * @returns {Promise.<Object>} The new server.
 */
exports.installVersion = async function(opts, progress = () => {}){
    requireSupportedLoader(opts.loader)
    let loaderVersion = opts.loaderVersion
    if(opts.loader !== 'vanilla' && !loaderVersion){
        const versions = await exports.loaderVersions(opts.loader, opts.minecraft)
        const pick = versions.find(v => v.stable) || versions[0]
        if(pick == null){
            throw new ModpackError('loaderUnavailable', { loader: loaderName(opts.loader), version: '', minecraft: opts.minecraft })
        }
        loaderVersion = pick.version
    }
    const name = opts.name || (opts.loader === 'vanilla' ? `Minecraft ${opts.minecraft}` : `${loaderName(opts.loader)} ${opts.minecraft}`)
    const id = newServerId(name)
    return await withInstance(id, async (dir) => {
        await fs.ensureDir(dir)
        return await savePack({ id, name, minecraft: opts.minecraft, loader: opts.loader, loaderVersion, source: 'version' }, progress)
    })
}

/* Modrinth */

/**
 * Install a Modrinth pack (.mrpack).
 *
 * @param {string} file The .mrpack on disk.
 * @param {function(Object)} progress Progress callback.
 * @param {Object} extra icon, and anything else to keep on the pack.
 */
async function installMrpack(file, progress, extra = {}){
    const zip = new AdmZip(file)
    const entry = zip.getEntry('modrinth.index.json')
    if(entry == null){
        throw new ModpackError('unknownFormat')
    }
    const index = JSON.parse(entry.getData().toString('utf-8'))
    const deps = index.dependencies || {}
    const minecraft = deps.minecraft
    if(!minecraft){
        throw new ModpackError('unknownFormat')
    }
    const loader = deps['fabric-loader'] ? 'fabric'
        : deps['quilt-loader'] ? 'quilt'
            : deps.forge ? 'forge'
                : deps.neoforge ? 'neoforge'
                    : 'vanilla'
    requireSupportedLoader(loader)
    const loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.forge || deps.neoforge || null

    const id = newServerId(index.name)
    return await withInstance(id, async (dir) => {
        await fs.ensureDir(dir)
        // Optional client files are on by default, as in the Modrinth app.
        const files = (index.files || []).filter(f => f.env == null || f.env.client !== 'unsupported')
        await runAll(files.map(f => async () => {
            const dest = safeJoin(dir, f.path)
            await download(f.downloads || [], dest, f.hashes || {})
        }), (done, total) => progress({ stage: 'files', done, total }))

        progress({ stage: 'overrides' })
        await extractFolder(zip, 'overrides/', dir)
        await extractFolder(zip, 'client-overrides/', dir)

        return await savePack({
            id,
            name: index.name,
            description: index.summary,
            icon: extra.icon,
            version: index.versionId,
            minecraft,
            loader,
            loaderVersion,
            source: 'modrinth'
        }, progress)
    })
}

/**
 * Search Modrinth modpacks. With no query, the most downloaded come first.
 *
 * @param {string} query The search text.
 * @param {number} offset How many results to skip.
 * @returns {Promise.<{hits: Array.<Object>, total: number}>}
 */
exports.searchModrinth = async function(query, offset = 0){
    const res = await http().get(`${MODRINTH}/search`, {
        searchParams: {
            query,
            facets: JSON.stringify([['project_type:modpack']]),
            index: query ? 'relevance' : 'downloads',
            limit: 20,
            offset
        }
    }).json()
    return {
        total: res.total_hits,
        hits: res.hits.map(h => ({
            source: 'modrinth',
            id: h.project_id,
            title: h.title,
            author: h.author,
            description: h.description,
            icon: h.icon_url || '',
            downloads: h.downloads,
            loaders: (h.categories || []).filter(c => isKnownLoader(c) || UNSUPPORTED_LOADERS[c] != null),
            minecraft: h.versions && h.versions.length > 0 ? h.versions[h.versions.length - 1] : null,
            url: `https://modrinth.com/modpack/${h.slug}`
        }))
    }
}

/**
 * Install the newest version of a Modrinth modpack, preferring a Fabric build
 * when the pack is published for several loaders.
 *
 * @param {Object} hit A result from searchModrinth.
 * @param {function(Object)} progress Progress callback.
 */
exports.installModrinth = async function(hit, progress = () => {}){
    progress({ stage: 'fetch' })
    const versions = await http().get(`${MODRINTH}/project/${encodeURIComponent(hit.id)}/version`).json()
    let version = versions.find(v => v.loaders.some(isKnownLoader))
        || versions.find(v => v.loaders.length === 0 || v.loaders.includes('minecraft'))
    // Packs built for several loaders publish one version each: take Fabric's
    // build of the same release when there is one.
    if(version != null && !version.loaders.includes('fabric')){
        version = versions.find(v => v.loaders.includes('fabric') && v.version_number === version.version_number) || version
    }
    if(version == null){
        const other = versions.length > 0 ? versions[0].loaders.find(l => UNSUPPORTED_LOADERS[l] != null) : null
        throw new ModpackError('unsupportedLoader', { loader: other != null ? UNSUPPORTED_LOADERS[other] : '?' })
    }
    const file = version.files.find(f => f.primary) || version.files[0]
    const tmp = path.join(os.tmpdir(), `modpack-${crypto.randomBytes(6).toString('hex')}.mrpack`)
    try {
        await download([file.url], tmp, file.hashes || {})
        return await installMrpack(tmp, progress, { icon: hit.icon })
    } finally {
        await fs.remove(tmp).catch(() => {})
    }
}

/* CurseForge */

/**
 * Where CurseForge serves a file when the API leaves downloadUrl out (the
 * author turned off third-party downloads). Usually still reachable.
 */
function curseForgeCdn(file){
    return `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}`
}

/**
 * Install a CurseForge pack (.zip with manifest.json).
 *
 * @param {AdmZip} zip The pack.
 * @param {Object} manifest Its manifest.json.
 * @param {function(Object)} progress Progress callback.
 * @param {Object} extra icon, and anything else to keep on the pack.
 */
async function installCurseForgeZip(zip, manifest, progress, extra = {}){
    const mc = manifest.minecraft || {}
    const primary = (mc.modLoaders || []).find(l => l.primary) || (mc.modLoaders || [])[0]
    let loader = 'vanilla'
    let loaderVersion = null
    if(primary != null){
        const [name, ...rest] = String(primary.id).split('-')
        loader = name.toLowerCase()
        loaderVersion = rest.join('-')
    }
    requireSupportedLoader(loader)

    const refs = (manifest.files || []).filter(f => f.required !== false)
    let files = []
    let mods = []
    // Only mods fetched from CurseForge need the API key; a pack with
    // everything in its overrides installs without one.
    if(refs.length > 0){
        const api = curseForge()
        progress({ stage: 'fetch' })
        files = (await api.post('mods/files', { json: { fileIds: refs.map(f => f.fileID) } }).json()).data
        mods = (await api.post('mods', { json: { modIds: refs.map(f => f.projectID) } }).json()).data
    }
    const modOf = new Map(mods.map(m => [m.id, m]))
    // Files CurseForge no longer has (taken down by the author).
    const found = new Set(files.map(f => f.id))
    const gone = refs.filter(r => !found.has(r.fileID)).map(r => {
        const mod = modOf.get(r.projectID)
        const site = mod != null && mod.links != null ? mod.links.websiteUrl : null
        return { name: mod != null ? mod.name : `${r.projectID}/${r.fileID}`, url: site, removed: true }
    })

    const id = newServerId(manifest.name)
    return await withInstance(id, async (dir) => {
        await fs.ensureDir(dir)
        const missing = [...gone]
        // Files whose authors keep them out of other launchers' packs.
        const restricted = []
        await runAll(files.map(f => async () => {
            const mod = modOf.get(f.modId)
            const site = mod != null && mod.links != null ? mod.links.websiteUrl : null
            const page = site ? `${site}/files/${f.id}` : null
            const folder = CF_CLASS_FOLDERS[mod != null ? mod.classId : null] || 'mods'
            const dest = safeJoin(dir, path.join(folder, f.fileName))
            const sha1 = (f.hashes || []).find(h => h.algo === 1)
            const md5 = (f.hashes || []).find(h => h.algo === 2)
            const urls = [f.downloadUrl, curseForgeCdn(f)].filter(Boolean)
            const blocked = !f.downloadUrl || (mod != null && mod.allowModDistribution === false)
            try {
                await download(urls, dest, { sha1: sha1 && sha1.value, md5: md5 && md5.value })
                if(blocked){
                    restricted.push({ name: f.displayName || f.fileName, url: page })
                }
            } catch(err) {
                console.warn(`Unable to download ${f.fileName}.`, err)
                // Enough to fetch it by hand and find it again (see importDownloaded).
                missing.push({
                    name: f.displayName || f.fileName,
                    fileName: f.fileName,
                    folder,
                    size: f.fileLength,
                    sha1: sha1 ? sha1.value : null,
                    url: page,
                    // CurseForge's own download link: the browser gets the file
                    // even when the launcher can't (blocked mods, a refused CDN).
                    direct: `https://www.curseforge.com/api/v1/mods/${f.modId}/files/${f.id}/download`,
                    blocked,
                    reason: failureReason(err)
                })
            }
        }), (done, total) => progress({ stage: 'files', done, total }))

        progress({ stage: 'overrides' })
        await extractFolder(zip, `${manifest.overrides || 'overrides'}/`, dir)

        const server = await savePack({
            id,
            name: manifest.name,
            description: manifest.author ? `${manifest.name} by ${manifest.author}` : '',
            icon: extra.icon,
            version: manifest.version,
            minecraft: mc.version,
            loader,
            loaderVersion,
            source: 'curseforge',
            ram: mc.recommendedRam
        }, progress)
        return Object.assign(server, missing.length > 0 ? { missing } : {}, restricted.length > 0 ? { restricted } : {})
    })
}

/**
 * Search CurseForge modpacks. With no query, the most popular come first.
 *
 * @param {string} query The search text.
 * @param {number} offset How many results to skip.
 * @returns {Promise.<{hits: Array.<Object>, total: number}>}
 */
exports.searchCurseForge = async function(query, offset = 0){
    const res = await curseForge().get('mods/search', {
        searchParams: {
            gameId: CF_GAME_MINECRAFT,
            classId: CF_CLASS_MODPACK,
            searchFilter: query,
            // 2 = popularity, 6 = total downloads.
            sortField: query ? 2 : 6,
            sortOrder: 'desc',
            pageSize: 20,
            index: offset
        }
    }).json()
    return {
        total: res.pagination.totalCount,
        hits: res.data.map(m => {
            const indexes = m.latestFilesIndexes || []
            return {
                source: 'curseforge',
                id: m.id,
                title: m.name,
                author: (m.authors || []).map(a => a.name).join(', '),
                description: m.summary,
                icon: m.logo ? m.logo.thumbnailUrl : '',
                downloads: m.downloadCount,
                loaders: [...new Set(indexes.map(i => CF_LOADERS[i.modLoader]).filter(Boolean))],
                minecraft: indexes.length > 0 ? indexes[0].gameVersion : null,
                url: m.links ? m.links.websiteUrl : ''
            }
        })
    }
}

/**
 * Install the newest release of a CurseForge modpack.
 *
 * @param {Object} hit A result from searchCurseForge.
 * @param {function(Object)} progress Progress callback.
 */
exports.installCurseForge = async function(hit, progress = () => {}){
    progress({ stage: 'fetch' })
    const api = curseForge()
    const files = (await api.get(`mods/${hit.id}/files`, { searchParams: { pageSize: 50 } }).json()).data
        .filter(f => !f.isServerPack)
        .sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
    const loaderOf = (f) => (f.gameVersions || []).map(v => v.toLowerCase()).find(v => isKnownLoader(v) || UNSUPPORTED_LOADERS[v] != null)
    const supported = files.filter(f => isKnownLoader(loaderOf(f)))
    const file = supported.find(f => f.releaseType === 1) || supported[0]
    if(file == null){
        const other = files.length > 0 ? loaderOf(files[0]) : null
        throw new ModpackError('unsupportedLoader', { loader: other != null ? (UNSUPPORTED_LOADERS[other] || other) : '?' })
    }
    const tmp = path.join(os.tmpdir(), `modpack-${crypto.randomBytes(6).toString('hex')}.zip`)
    try {
        await download([file.downloadUrl, curseForgeCdn(file)].filter(Boolean), tmp)
        const zip = new AdmZip(tmp)
        const manifest = zip.getEntry('manifest.json')
        if(manifest == null){
            throw new ModpackError('unknownFormat')
        }
        return await installCurseForgeZip(zip, JSON.parse(manifest.getData().toString('utf-8')), progress, { icon: hit.icon })
    } finally {
        await fs.remove(tmp).catch(() => {})
    }
}

/**
 * A file in the Downloads folder that is the missing one: under its own name
 * (or a browser's "name (1).jar"), or any file of its size and hash.
 */
async function findDownloaded(downloads, names, file){
    const ext = path.extname(file.fileName)
    const base = file.fileName.substring(0, file.fileName.length - ext.length)
    const byName = names.filter(n => n === file.fileName || (n.startsWith(base + ' (') && n.endsWith(')' + ext)))
    const bySize = []
    if(file.size != null){
        for(const n of names){
            if(!byName.includes(n) && path.extname(n).toLowerCase() === ext.toLowerCase()){
                const st = await fs.stat(path.join(downloads, n)).catch(() => null)
                if(st != null && st.isFile() && st.size === file.size) bySize.push(n)
            }
        }
    }
    for(const n of [...byName, ...bySize]){
        const p = path.join(downloads, n)
        if(file.sha1 == null){
            if(byName.includes(n)) return p
            continue
        }
        const sum = crypto.createHash('sha1').update(await fs.readFile(p)).digest('hex')
        if(sum === String(file.sha1).toLowerCase()) return p
    }
    return null
}

/**
 * Copy files the player downloaded by hand into the pack: CurseForge doesn't
 * hand some mods to other launchers, and the CDN can fail too.
 *
 * @param {string} id The pack's server id.
 * @param {Array.<Object>} missing The install's missing files.
 * @returns {Promise.<Array.<Object>>} The ones still not found.
 */
exports.importDownloaded = async function(id, missing){
    const downloads = app.getPath('downloads')
    const names = await fs.readdir(downloads).catch(() => [])
    const left = []
    for(const file of missing){
        // Nothing to match a removed file against.
        const src = file.fileName ? await findDownloaded(downloads, names, file) : null
        if(src == null){
            left.push(file)
            continue
        }
        const dest = safeJoin(instanceDir(id), path.join(file.folder, file.fileName))
        await fs.ensureDir(path.dirname(dest))
        await fs.copy(src, dest, { overwrite: true })
    }
    return left
}

/* Prism / MultiMC */

// mmc-pack.json component uids of the loaders.
const PRISM_LOADERS = {
    'net.fabricmc.fabric-loader': 'fabric',
    'org.quiltmc.quilt-loader': 'quilt',
    'net.minecraftforge': 'forge',
    'net.neoforged': 'neoforge'
}

/**
 * Install a Prism Launcher / MultiMC instance export.
 *
 * @param {AdmZip} zip The export.
 * @param {string} root The folder in the zip holding mmc-pack.json, with a trailing slash or empty.
 * @param {function(Object)} progress Progress callback.
 */
async function installPrism(zip, root, progress){
    const pack = JSON.parse(zip.getEntry(root + 'mmc-pack.json').getData().toString('utf-8'))
    const components = pack.components || []
    const mc = components.find(c => c.uid === 'net.minecraft')
    if(mc == null){
        throw new ModpackError('unknownFormat')
    }
    let loader = 'vanilla'
    let loaderVersion = null
    for(const c of components){
        if(PRISM_LOADERS[c.uid] != null){
            loader = PRISM_LOADERS[c.uid]
            loaderVersion = c.version
        }
    }
    requireSupportedLoader(loader)

    let name = root ? path.basename(root) : 'Prism instance'
    let ram = null
    const cfg = zip.getEntry(root + 'instance.cfg')
    if(cfg != null){
        const text = cfg.getData().toString('utf-8')
        const m = text.match(/^name=(.+)$/m)
        if(m != null) name = m[1].trim()
        // Memory only counts when the instance overrides the global setting.
        const max = text.match(/^MaxMemAlloc=(\d+)/m)
        if(/^OverrideMemory=true/m.test(text) && max != null) ram = max[1]
    }
    const game = ['.minecraft/', 'minecraft/'].map(d => root + d).find(d => zip.getEntries().some(e => e.entryName.startsWith(d)))

    const id = newServerId(name)
    return await withInstance(id, async (dir) => {
        await fs.ensureDir(dir)
        if(game != null){
            progress({ stage: 'overrides' })
            await extractFolder(zip, game, dir)
        }
        return await savePack({ id, name, minecraft: mc.version, loader, loaderVersion, source: 'prism', ram }, progress)
    })
}

/* Files */

/**
 * Install a pack file: a Modrinth .mrpack, a CurseForge .zip or a Prism /
 * MultiMC .zip, told apart by what they contain.
 *
 * @param {string} file The file on disk.
 * @param {function(Object)} progress Progress callback.
 * @returns {Promise.<Object>} The new server.
 */
exports.installFile = async function(file, progress = () => {}){
    let zip
    try {
        zip = new AdmZip(file)
    } catch {
        throw new ModpackError('unknownFormat')
    }
    if(zip.getEntry('modrinth.index.json') != null){
        return await installMrpack(file, progress)
    }
    const manifest = zip.getEntry('manifest.json')
    if(manifest != null){
        const data = JSON.parse(manifest.getData().toString('utf-8'))
        if(data.manifestType === 'minecraftModpack'){
            return await installCurseForgeZip(zip, data, progress)
        }
    }
    // Prism exports put the instance at the root or in one folder.
    const mmc = zip.getEntries()
        .map(e => e.entryName)
        .filter(n => n === 'mmc-pack.json' || n.endsWith('/mmc-pack.json'))
        .sort((a, b) => a.length - b.length)[0]
    if(mmc != null){
        return await installPrism(zip, mmc.substring(0, mmc.length - 'mmc-pack.json'.length), progress)
    }
    throw new ModpackError('unknownFormat')
}

/* Installed packs */

/**
 * @returns {Array.<Object>} The installed local packs, newest first.
 */
exports.installed = function(){
    return LocalPacks.read(ConfigManager.getLauncherDirectory())
        .sort((a, b) => String(b.local.installed).localeCompare(String(a.local.installed)))
}

/**
 * @param {string} id A local pack's server id.
 * @returns {string} Its instance folder.
 */
exports.instanceDir = instanceDir

/**
 * Forget a local pack. Its instance folder is left to the caller, which moves
 * it to the trash.
 *
 * @param {string} id The server id.
 */
exports.remove = function(id){
    const dir = ConfigManager.getLauncherDirectory()
    LocalPacks.write(dir, LocalPacks.read(dir).filter(s => s.id !== id))
}

exports.LOADER_NAMES = Object.assign({ vanilla: 'Vanilla' }, ...Object.entries(LOADERS).map(([k, v]) => ({ [k]: v.name })), ForgeInstaller.NAMES, UNSUPPORTED_LOADERS)
exports.isSupportedLoader = (loader) => loader === 'vanilla' || isKnownLoader(loader)
