/**
 * Installs Forge and NeoForge for player-added modpacks (see modpackmanager.js)
 * without the installer's own UI: the installer jar is read and its steps are
 * replayed here, the way launchers such as Prism and ATLauncher do it.
 *
 *  - Installers since Forge 1.12.2 (and every NeoForge one) carry an
 *    install_profile.json with a separate version.json. Their libraries are
 *    downloaded, then the processors run to patch the Minecraft client.
 *  - Older Forge installers (up to 1.12.2) embed the version in the profile
 *    and ship the universal jar; nothing needs patching.
 *
 * The result is described the way Nebula describes Forge in a distribution: a
 * ForgeHosted module with the version manifest and every library as
 * submodules, so helios-core and ProcessBuilder launch it like a server pack.
 */
const AdmZip        = require('adm-zip')
const child_process = require('child_process')
const crypto        = require('crypto')
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')
const { MavenUtil } = require('helios-core/common')
const { Type }      = require('helios-distribution-types')

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const LIBRARY_MIRRORS = [
    'https://libraries.minecraft.net/',
    'https://maven.minecraftforge.net/',
    'https://maven.neoforged.net/releases/',
    'https://repo1.maven.org/maven2/'
]

const KINDS = {
    forge: {
        name: 'Forge',
        metadata: 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
        promotions: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
        installer: (mc, v) => `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`
    },
    neoforge: {
        name: 'NeoForge',
        metadata: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
        // NeoForge for 1.20.1 was still published as net.neoforged:forge.
        legacyMetadata: 'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml',
        installer: (mc, v) => v.startsWith(`${mc}-`)
            ? `https://maven.neoforged.net/releases/net/neoforged/forge/${v}/forge-${v}-installer.jar`
            : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`
    }
}

exports.isForgeLike = (loader) => KINDS[loader] != null
exports.NAMES = { forge: KINDS.forge.name, neoforge: KINDS.neoforge.name }

function metadataVersions(xml){
    return [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
}

/**
 * Newest first by numeric parts: maven metadata isn't reliably in order.
 */
function byVersionDesc(a, b){
    const pa = a.split(/[.\-+]/)
    const pb = b.split(/[.\-+]/)
    for(let i = 0; i < Math.max(pa.length, pb.length); i++){
        const x = pa[i] ?? ''
        const y = pb[i] ?? ''
        const nx = Number(x)
        const ny = Number(y)
        const diff = !isNaN(nx) && !isNaN(ny) && x !== '' && y !== '' ? ny - nx : y.localeCompare(x)
        if(diff !== 0) return diff
    }
    return 0
}

/**
 * The NeoForge version prefix for a Minecraft version: 1.21.1 is 21.1.x and
 * 1.21 is 21.0.x. Year-based versions keep all three parts: 26.1 is
 * 26.1.0.x, 26.1.2 is 26.1.2.x.
 */
function neoforgePrefix(mc){
    if(mc.startsWith('1.')){
        const parts = mc.substring(2).split('.')
        return `${parts[0]}.${parts[1] || '0'}.`
    }
    const parts = mc.split('.')
    return `${parts[0]}.${parts[1] || '0'}.${parts[2] || '0'}.`
}

/**
 * Loader versions for a Minecraft version, newest first.
 *
 * @param {Object} http A got instance.
 * @param {string} loader forge or neoforge.
 * @param {string} mc The Minecraft version.
 * @returns {Promise.<Array.<{version: string, stable: boolean}>>}
 */
exports.versions = async function(http, loader, mc){
    if(loader === 'forge'){
        const [xml, promos] = await Promise.all([
            http.get(KINDS.forge.metadata).text(),
            http.get(KINDS.forge.promotions).json().catch(() => ({ promos: {} }))
        ])
        const recommended = promos.promos != null ? promos.promos[`${mc}-recommended`] : null
        const latest = promos.promos != null ? promos.promos[`${mc}-latest`] : null
        // Metadata lists 1.20.1-47.2.0; the version alone is what packs refer to.
        const list = metadataVersions(xml).filter(v => v.startsWith(`${mc}-`)).map(v => v.substring(mc.length + 1)).sort(byVersionDesc)
        return list.map(v => ({ version: v, stable: recommended != null ? v === recommended : v === latest }))
    }
    if(loader === 'neoforge'){
        const prefix = neoforgePrefix(mc)
        let list = metadataVersions(await http.get(KINDS.neoforge.metadata).text()).filter(v => v.startsWith(prefix))
        if(list.length === 0){
            const legacy = await http.get(KINDS.neoforge.legacyMetadata).text().catch(() => '')
            list = metadataVersions(legacy).filter(v => v.startsWith(`${mc}-`))
        }
        return list.sort(byVersionDesc).map(v => ({ version: v, stable: !/beta|alpha|rc/i.test(v) }))
    }
    return []
}

/**
 * The installer's version string from what a pack declares. Packs write
 * Forge as 47.2.0 or 1.20.1-47.2.0, and NeoForge for 1.20.1 as 47.1.106.
 */
function normalizeVersion(loader, mc, version){
    const v = String(version).replace(/^(forge|neoforge)-/i, '')
    if(loader === 'forge'){
        return v.startsWith(`${mc}-`) ? v.substring(mc.length + 1) : v
    }
    if(mc === '1.20.1' && !v.startsWith(`${mc}-`)){
        return `${mc}-${v}`
    }
    return v
}

/* Libraries */

/**
 * Where a library lives, from its version.json / install_profile entry.
 */
function libraryInfo(lib, libDir){
    const artifact = lib.downloads != null ? lib.downloads.artifact : null
    const rel = artifact != null && artifact.path ? artifact.path : MavenUtil.mavenIdentifierAsPath(lib.name)
    return {
        name: lib.name,
        rel,
        file: path.join(libDir, path.normalize(rel)),
        url: artifact != null ? artifact.url : (lib.url ? lib.url.replace(/\/?$/, '/') + rel : ''),
        sha1: artifact != null ? artifact.sha1 : null,
        // Old installers mark libraries only the server needs.
        optional: lib.clientreq === false
    }
}

/**
 * Make sure a library is on disk: taken from the installer when it ships it
 * (no url), downloaded otherwise.
 */
async function fetchLibrary(lib, installer, download){
    if(await fs.pathExists(lib.file)){
        return
    }
    const embedded = installer.getEntry(`maven/${lib.rel}`)
    if(embedded != null){
        await fs.ensureDir(path.dirname(lib.file))
        await fs.writeFile(lib.file, embedded.getData())
        return
    }
    // Old installers point at hosts that moved, so the mirrors are tried too.
    const urls = [...new Set([lib.url, ...LIBRARY_MIRRORS.map(m => m + lib.rel)].filter(Boolean))]
    try {
        await download(urls, lib.file, lib.sha1 ? { sha1: lib.sha1 } : {})
    } catch(err) {
        if(!lib.optional){
            throw err
        }
    }
}

/**
 * The vanilla client jar and json, which the processors patch. helios-core
 * finds them valid later and doesn't fetch them again.
 */
async function ensureVanilla(http, download, commonDir, mc){
    const dir = path.join(commonDir, 'versions', mc)
    const jsonFile = path.join(dir, `${mc}.json`)
    const jarFile = path.join(dir, `${mc}.jar`)
    if(!await fs.pathExists(jsonFile)){
        const manifest = await http.get(MOJANG_MANIFEST).json()
        const entry = manifest.versions.find(v => v.id === mc)
        if(entry == null){
            throw new Error(`Unknown Minecraft version ${mc}`)
        }
        await download([entry.url], jsonFile, { sha1: entry.sha1 })
    }
    if(!await fs.pathExists(jarFile)){
        const client = (await fs.readJson(jsonFile)).downloads.client
        await download([client.url], jarFile, { sha1: client.sha1 })
    }
    return jarFile
}

/* Processors */

function mainClassOf(jar){
    const entry = new AdmZip(jar).getEntry('META-INF/MANIFEST.MF')
    const m = entry != null ? entry.getData().toString('utf-8').match(/^Main-Class:\s*(.+)$/m) : null
    if(m == null){
        throw new Error(`No Main-Class in ${path.basename(jar)}`)
    }
    return m[1].trim()
}

function sha1Of(file){
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
}

function runJava(java, args, cwd){
    return new Promise((resolve, reject) => {
        const child = child_process.spawn(java, args, { cwd })
        let tail = ''
        const keep = (d) => {
            tail = (tail + d.toString()).slice(-4000)
        }
        child.stdout.on('data', keep)
        child.stderr.on('data', keep)
        child.on('error', reject)
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`Processor exited with ${code}: ${tail.trim().split('\n').slice(-5).join(' | ')}`)))
    })
}

/**
 * Replay the installer's processors for the client side.
 */
async function runProcessors(profile, ctx, onProgress){
    const processors = (profile.processors || []).filter(p => p.sides == null || p.sides.includes('client'))
    if(processors.length === 0){
        return
    }
    const java = await ctx.java()
    const libPath = (ref) => path.join(ctx.libDir, path.normalize(MavenUtil.mavenIdentifierAsPath(ref)))
    const resolve = (value) => {
        if(/^\[.+\]$/.test(value)) return libPath(value.slice(1, -1))
        return value.replace(/\{(\w+)\}/g, (all, key) => ctx.data[key] != null ? ctx.data[key] : all)
    }

    let done = 0
    for(const p of processors){
        onProgress(done, processors.length)
        const outputs = Object.entries(p.outputs || {}).map(([file, sha]) => [resolve(file), resolve(sha).replace(/^'|'$/g, '')])
        const upToDate = outputs.length > 0 && outputs.every(([file, sha]) => fs.existsSync(file) && sha1Of(file) === sha)
        if(!upToDate){
            const jar = libPath(p.jar)
            const cp = [jar, ...(p.classpath || []).map(libPath)].join(path.delimiter)
            await runJava(java, ['-cp', cp, mainClassOf(jar), ...(p.args || []).map(resolve)], ctx.tmp)
        }
        done++
    }
    onProgress(done, processors.length)
}

/* Modules */

async function artifactOf(file, url){
    const buf = await fs.readFile(file)
    return { size: buf.length, MD5: crypto.createHash('md5').update(buf).digest('hex'), url: url || '' }
}

/**
 * Describe the installed loader as distribution modules.
 *
 * @param {Object} versionJson The loader's version.json.
 * @param {Array.<Object>} libs Libraries on the classpath (libraryInfo).
 * @param {Array.<Object>} extra Files the loader finds on its own (processor outputs).
 * @param {string} commonDir The launcher's common directory.
 * @param {string} name The loader's display name.
 * @param {RegExp} mainLib The library that stands for the loader.
 */
async function buildModules(versionJson, libs, extra, commonDir, name, mainLib){
    const manifestPath = path.join(commonDir, 'versions', versionJson.id, `${versionJson.id}.json`)
    await fs.ensureDir(path.dirname(manifestPath))
    await fs.writeJson(manifestPath, versionJson, { spaces: 2 })

    const main = libs.find(l => mainLib.test(l.name)) || libs[0]
    const subModules = [{
        id: versionJson.id,
        name: `${name} version manifest`,
        type: Type.VersionManifest,
        artifact: await artifactOf(manifestPath, '')
    }]
    for(const l of libs){
        if(l !== main){
            subModules.push({ id: l.name, name: l.name, type: Type.Library, artifact: { ...await artifactOf(l.file, l.url), path: l.rel } })
        }
    }
    for(const l of extra){
        // Only needs to be on disk, e.g. the patched client.
        subModules.push({ id: l.name, name: l.name, type: Type.Library, classpath: false, artifact: { ...await artifactOf(l.file, l.url), path: l.rel } })
    }
    return [{
        id: main.name,
        name: `${name} Loader`,
        type: Type.ForgeHosted,
        artifact: { ...await artifactOf(main.file, main.url), path: main.rel },
        subModules
    }]
}

/**
 * Install Forge or NeoForge for a Minecraft version.
 *
 * @param {Object} opts loader (forge, neoforge), minecraft, version.
 * @param {Object} tools http (got instance), download(urls, dest, hashes), runAll(jobs, onProgress),
 *                       java() resolving to a Java executable, commonDir, onProgress(done, total).
 * @returns {Promise.<{modules: Array.<Object>, version: string}>}
 */
exports.install = async function(opts, tools){
    const kind = KINDS[opts.loader]
    const mc = opts.minecraft
    const version = normalizeVersion(opts.loader, mc, opts.version)
    const libDir = path.join(tools.commonDir, 'libraries')
    const tmp = path.join(os.tmpdir(), `meridian-${opts.loader}-${crypto.randomBytes(4).toString('hex')}`)
    await fs.ensureDir(tmp)
    try {
        const installerPath = path.join(tmp, 'installer.jar')
        await tools.download([kind.installer(mc, version)], installerPath)
        const installer = new AdmZip(installerPath)
        const profileEntry = installer.getEntry('install_profile.json')
        if(profileEntry == null){
            throw new Error('The installer has no install_profile.json')
        }
        const profile = JSON.parse(profileEntry.getData().toString('utf-8'))
        const mainLib = /^net\.(minecraftforge|neoforged):(forge|neoforge):/

        // Old installers: the version is in the profile, the universal jar inside.
        if(profile.versionInfo != null){
            const versionJson = profile.versionInfo
            const universal = libraryInfo({ name: profile.install.path }, libDir)
            await fs.ensureDir(path.dirname(universal.file))
            await fs.writeFile(universal.file, installer.getEntry(profile.install.filePath).getData())
            const libs = versionJson.libraries
                .filter(l => l.name !== profile.install.path)
                .map(l => libraryInfo(l, libDir))
            await tools.runAll(libs.map(l => () => fetchLibrary(l, installer, tools.download)), tools.onProgress)
            const present = []
            for(const l of libs){
                if(await fs.pathExists(l.file)) present.push(l)
            }
            return { version, modules: await buildModules(versionJson, [universal, ...present], [], tools.commonDir, kind.name, mainLib) }
        }

        const versionJson = JSON.parse(installer.getEntry(profile.json.replace(/^\//, '')).getData().toString('utf-8'))
        const libs = (versionJson.libraries || []).map(l => libraryInfo(l, libDir))
        const tools_ = (profile.libraries || []).map(l => libraryInfo(l, libDir))
        const all = [...new Map([...libs, ...tools_].map(l => [l.rel, l])).values()]
        await tools.runAll(all.map(l => () => fetchLibrary(l, installer, tools.download)), (done, total) => tools.onProgress(done, total))

        // Everything the processors read or write, as the installer resolves it.
        const data = {
            SIDE: 'client',
            MINECRAFT_JAR: await ensureVanilla(tools.http, tools.download, tools.commonDir, mc),
            MINECRAFT_VERSION: mc,
            ROOT: tools.commonDir,
            INSTALLER: installerPath,
            LIBRARY_DIR: libDir
        }
        const outputs = []
        for(const [key, value] of Object.entries(profile.data || {})){
            const v = value.client
            if(v == null) continue
            if(/^\[.+\]$/.test(v)){
                const ref = v.slice(1, -1)
                data[key] = path.join(libDir, path.normalize(MavenUtil.mavenIdentifierAsPath(ref)))
                outputs.push({ name: ref, rel: MavenUtil.mavenIdentifierAsPath(ref), file: data[key], url: '' })
            } else if(/^'.*'$/.test(v)){
                data[key] = v.slice(1, -1)
            } else if(v.startsWith('/')){
                const file = path.join(tmp, 'data', path.normalize(v))
                await fs.ensureDir(path.dirname(file))
                await fs.writeFile(file, installer.getEntry(v.substring(1)).getData())
                data[key] = file
            } else {
                data[key] = v
            }
        }

        await runProcessors(profile, { java: tools.java, libDir, data, tmp }, tools.onProgress)

        // Processor outputs the game reads at launch, like the patched client.
        const onClasspath = new Set(libs.map(l => l.rel))
        const extra = []
        for(const o of outputs){
            if(!onClasspath.has(o.rel) && await fs.pathExists(o.file)){
                extra.push(o)
            }
        }
        return { version, modules: await buildModules(versionJson, libs, extra, tools.commonDir, kind.name, mainLib) }
    } finally {
        await fs.remove(tmp).catch(() => {})
    }
}
