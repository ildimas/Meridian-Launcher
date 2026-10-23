/**
 * Works out what a hand-made modpack is: a .minecraft folder someone zipped,
 * a MultiMC 4 instance, a TLauncher-style folder with versions/ and so on.
 * Nothing describes them, so the Minecraft version and the mod loader are
 * read from what the folder holds, most reliable first:
 *
 *  1. versions/<id>/<id>.json, which launchers since 1.6 write: the loader's
 *     libraries name it and its version exactly.
 *  2. bin/minecraft.jar, the patched client of packs before 1.6. FML's and
 *     Forge's version files are inside it.
 *  3. The logs the game and FML left behind.
 *  4. The mods: their metadata and file names.
 *
 * No Electron here, so it runs on its own for testing.
 */
const AdmZip = require('adm-zip')
const fs     = require('fs-extra')
const path   = require('path')

// Folders worth looking into for the game folder, and how much each says
// "this is a Minecraft game folder".
const ROOT_MARKERS = [
    ['mods', 3], ['coremods', 3], ['config', 2], ['versions', 2], ['saves', 1],
    ['resourcepacks', 1], ['texturepacks', 1], ['shaderpacks', 1], ['options.txt', 1], ['bin/minecraft.jar', 2]
]
// Never searched for the game folder: big and never contain it.
const NO_DESCEND = new Set(['mods', 'coremods', 'config', 'saves', 'assets', 'resources', 'libraries', 'versions',
    'natives', 'logs', 'crash-reports', 'screenshots', 'resourcepacks', 'texturepacks', 'shaderpacks', 'world'])

/**
 * Find the game folder: the folder under `dir` that looks most like one.
 *
 * @param {string} dir The unpacked pack.
 * @returns {Promise.<string | null>} Its path, or null if nothing looks like a game folder.
 */
exports.findRoot = async function(dir){
    let best = null
    const visit = async (d, depth) => {
        let score = 0
        for(const [name, weight] of ROOT_MARKERS){
            if(await fs.pathExists(path.join(d, name))) score += weight
        }
        // Ties go to the shallower folder, which holds the rest.
        if(score >= 2 && (best == null || score > best.score)){
            best = { dir: d, score }
        }
        if(depth >= 6) return
        let entries
        try {
            entries = await fs.readdir(d, { withFileTypes: true })
        } catch {
            return
        }
        for(const e of entries){
            if(e.isDirectory() && !NO_DESCEND.has(e.name.toLowerCase())){
                await visit(path.join(d, e.name), depth + 1)
            }
        }
    }
    await visit(dir, 0)
    return best != null ? best.dir : null
}

/* Version comparison, enough for 1.x.y and year-based versions. */

function versionParts(v){
    return String(v).split(/[.-]/).map(p => Number.parseInt(p)).map(n => Number.isNaN(n) ? 0 : n)
}

function compareVersions(a, b){
    const pa = versionParts(a)
    const pb = versionParts(b)
    for(let i = 0; i < Math.max(pa.length, pb.length); i++){
        const diff = (pa[i] || 0) - (pb[i] || 0)
        if(diff !== 0) return diff
    }
    return 0
}
exports.compareVersions = compareVersions

/* 1. versions/ */

/**
 * A loader from a version json's libraries.
 */
function loaderOfLibraries(libraries, mc){
    for(const lib of libraries || []){
        const [group, artifact, version] = String(lib.name || '').split(':')
        if(version == null) continue
        if(group === 'net.minecraftforge' && (artifact === 'forge' || artifact === 'minecraftforge')){
            return { loader: 'forge', loaderVersion: mc && version.startsWith(`${mc}-`) ? version.substring(mc.length + 1) : version }
        }
        if(group === 'net.neoforged' && artifact === 'neoforge'){
            return { loader: 'neoforge', loaderVersion: version }
        }
        if(group === 'net.neoforged' && artifact === 'forge'){
            // NeoForge for 1.20.1 kept Forge's artifact.
            return { loader: 'neoforge', loaderVersion: version }
        }
        if(group === 'net.fabricmc' && artifact === 'fabric-loader'){
            return { loader: 'fabric', loaderVersion: version }
        }
        if(group === 'org.quiltmc' && artifact === 'quilt-loader'){
            return { loader: 'quilt', loaderVersion: version }
        }
    }
    return null
}

async function fromVersions(root){
    const dir = path.join(root, 'versions')
    let ids
    try {
        ids = await fs.readdir(dir)
    } catch {
        return null
    }
    // The launcher's last pick wins when there are several.
    let last = null
    try {
        const launcher = await fs.readJson(path.join(root, 'launcher_profiles.json'))
        const profile = (launcher.profiles || {})[launcher.selectedProfile]
        last = profile != null ? profile.lastVersionId : null
    } catch {
        // No profiles; any version will do.
    }
    const found = []
    for(const id of ids){
        let json
        try {
            json = await fs.readJson(path.join(dir, id, `${id}.json`))
        } catch {
            continue
        }
        const mc = json.inheritsFrom || (typeof json.jar === 'string' ? json.jar : null)
        const loader = loaderOfLibraries(json.libraries, mc)
        if(loader != null && mc != null){
            found.push({ id, minecraft: mc, ...loader })
        } else if(loader == null && json.inheritsFrom == null && /^\d/.test(json.id || '')){
            found.push({ id, minecraft: json.id, loader: 'vanilla', loaderVersion: null })
        }
    }
    if(found.length === 0){
        return null
    }
    // A loader beats plain Minecraft; the last played beats the rest.
    found.sort((a, b) => (b.id === last) - (a.id === last) || (b.loader !== 'vanilla') - (a.loader !== 'vanilla'))
    const { minecraft, loader, loaderVersion } = found[0]
    return { minecraft, loader, loaderVersion, by: 'versions' }
}

/* 2. bin/minecraft.jar */

function properties(zip, name){
    const entry = zip.getEntry(name)
    if(entry == null){
        return null
    }
    const props = {}
    for(const line of entry.getData().toString('utf-8').split(/\r?\n/)){
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
        if(m != null) props[m[1].trim()] = m[2].trim()
    }
    return props
}

async function fromClientJar(root){
    const jar = path.join(root, 'bin', 'minecraft.jar')
    if(!await fs.pathExists(jar)){
        return null
    }
    let zip
    try {
        zip = new AdmZip(jar)
    } catch {
        return null
    }
    const fml = properties(zip, 'fmlversion.properties')
    const forge = properties(zip, 'forgeversion.properties')
    const result = { clientJar: jar, by: 'jar' }
    if(fml != null && fml['fmlbuild.mcversion']){
        result.minecraft = fml['fmlbuild.mcversion']
    }
    if(forge != null && forge['forge.major.number'] != null){
        result.loader = 'forge'
        result.loaderVersion = ['major', 'minor', 'revision', 'build'].map(k => forge[`forge.${k}.number`]).join('.')
    }
    return result
}

/* 3. Logs */

const LOG_FILES = /^(ForgeModLoader-client-\d+\.log(\.\d+)?|fml-client-latest\.log|output-client\.log|latest\.log|debug\.log)$/i
const LOG_PATTERNS = [
    // FML: "Forge Mod Loader version 4.7.35.556 for Minecraft 1.4.7 loading"
    { re: /Forge Mod Loader version \S+ for Minecraft (\S+) loading/, minecraft: 1 },
    { re: /MinecraftForge v(\d[\w.-]*) Initialized/, loader: 'forge', loaderVersion: 1 },
    { re: /Loading Minecraft (\S+) with Fabric Loader (\S+)/, minecraft: 1, loader: 'fabric', loaderVersion: 2 },
    { re: /Loading Minecraft (\S+) with Quilt Loader (\S+)/, minecraft: 1, loader: 'quilt', loaderVersion: 2 },
    // ModLauncher prints its arguments.
    { re: /--fml\.neoForgeVersion, ([\w.-]+)/, loader: 'neoforge', loaderVersion: 1 },
    { re: /--fml\.forgeVersion, ([\w.-]+)/, loader: 'forge', loaderVersion: 1 },
    { re: /--fml\.mcVersion, ([\w.-]+)/, minecraft: 1 },
    { re: /Minecraft Version: (\d[\w.-]*)/, minecraft: 1 }
]

async function fromLogs(root){
    const files = []
    for(const dir of [root, path.join(root, 'logs')]){
        let names
        try {
            names = await fs.readdir(dir)
        } catch {
            continue
        }
        for(const name of names){
            if(LOG_FILES.test(name)){
                const file = path.join(dir, name)
                files.push({ file, mtime: (await fs.stat(file)).mtimeMs })
            }
        }
    }
    // The newest log describes what the pack last ran as.
    files.sort((a, b) => b.mtime - a.mtime)
    const result = {}
    for(const { file } of files){
        // The interesting lines come first; old logs can be huge.
        const text = (await fs.readFile(file)).subarray(0, 512 * 1024).toString('utf-8')
        for(const p of LOG_PATTERNS){
            const m = text.match(p.re)
            if(m == null) continue
            if(p.minecraft != null && result.minecraft == null) result.minecraft = m[p.minecraft]
            if(p.loader != null && result.loader == null){
                result.loader = p.loader
                result.loaderVersion = m[p.loaderVersion]
            }
        }
        if(result.minecraft != null && result.loader != null) break
    }
    return result.minecraft != null || result.loader != null ? { ...result, by: 'logs' } : null
}

/* 4. Mods */

// "1.4.7" in "[1.4.7]ReiMinimap", "backpack-1.6.8-1.4.7", "mc1.4.7".
const NAME_VERSION = /(?:^|[^\d.])(1\.\d{1,2}(?:\.\d{1,2})?)(?![\d.])/g

function lowerBound(range){
    // "[1.20.1,1.21)", ">=1.20", "~1.20.1", "1.20.x"
    const m = String(range).match(/(\d+\.\d+(?:\.\d+)?)/)
    return m != null ? m[1] : null
}

async function fromMods(root){
    const votes = {}
    const vote = (v, weight) => {
        if(v != null && /^\d+\.\d+(\.\d+)?$/.test(v)) votes[v] = (votes[v] || 0) + weight
    }
    const loaders = {}
    const files = []
    for(const dir of ['mods', 'coremods']){
        try {
            for(const name of await fs.readdir(path.join(root, dir))){
                if(/\.(jar|zip|litemod)$/i.test(name)) files.push(path.join(root, dir, name))
            }
        } catch {
            // No such folder.
        }
    }
    for(const file of files){
        for(const m of path.basename(file).matchAll(NAME_VERSION)) vote(m[1], 1)
        let zip
        try {
            zip = new AdmZip(file)
        } catch {
            continue
        }
        const read = (name) => {
            const e = zip.getEntry(name)
            return e != null ? e.getData().toString('utf-8') : null
        }
        const mcmod = read('mcmod.info')
        if(mcmod != null){
            loaders.forge = (loaders.forge || 0) + 1
            for(const m of mcmod.matchAll(/"mcversion"\s*:\s*"([^"]+)"/g)) vote(m[1], 2)
        }
        const fabric = read('fabric.mod.json')
        if(fabric != null){
            loaders.fabric = (loaders.fabric || 0) + 1
            try {
                const dep = (JSON.parse(fabric).depends || {}).minecraft
                vote(lowerBound(Array.isArray(dep) ? dep[0] : dep), 2)
            } catch {
                // Comments or trailing commas; the loader still counts.
            }
        }
        if(read('quilt.mod.json') != null) loaders.quilt = (loaders.quilt || 0) + 1
        const neo = read('META-INF/neoforge.mods.toml')
        const toml = neo || read('META-INF/mods.toml')
        if(toml != null){
            const loader = neo != null ? 'neoforge' : 'forge'
            loaders[loader] = (loaders[loader] || 0) + 1
            const m = toml.match(/modId\s*=\s*"minecraft"[\s\S]*?versionRange\s*=\s*"([^"]+)"/)
            if(m != null) vote(lowerBound(m[1]), 2)
        }
    }
    const result = { by: 'mods' }
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1] || compareVersions(b[0], a[0]))[0]
    if(top != null) result.minecraft = top[0]
    const loader = Object.entries(loaders).sort((a, b) => b[1] - a[1])[0]
    if(loader != null) result.loader = loader[0]
    return result.minecraft != null || result.loader != null ? result : null
}

/* Together */

/**
 * The pack's name, when the folder says it.
 */
async function nameOf(root){
    // MultiMC 4 and Prism keep instance.cfg next to the game folder.
    for(const cfg of [path.join(path.dirname(root), 'instance.cfg'), path.join(root, 'instance.cfg')]){
        try {
            const m = (await fs.readFile(cfg, 'utf-8')).match(/^name=(.+)$/m)
            if(m != null) return m[1].trim()
        } catch {
            // Not there.
        }
    }
    return null
}

/**
 * Work out a hand-made pack's Minecraft version and mod loader.
 *
 * @param {string} root The game folder (findRoot).
 * @returns {Promise.<{minecraft: string | null, loader: string | null, loaderVersion: string | null, clientJar: string | null, name: string | null}>}
 */
exports.detect = async function(root){
    const found = []
    for(const source of [fromVersions, fromClientJar, fromLogs, fromMods]){
        // Opening every mod is slow; only done when the rest didn't tell.
        if(source === fromMods && found.some(f => f.minecraft != null) && found.some(f => f.loader != null)){
            break
        }
        const r = await source(root)
        if(r != null) found.push(r)
    }
    const first = (key) => {
        const r = found.find(f => f[key] != null)
        return r != null ? r[key] : null
    }
    const minecraft = first('minecraft')
    const loader = first('loader')
    // The version comes from the source that named the loader, or one that agrees.
    const withVersion = found.find(f => f.loader === loader && f.loaderVersion != null)
    // Before 1.6 the game runs from bin/minecraft.jar, with every jar mod in it.
    const jar = first('clientJar')
    return {
        minecraft,
        loader,
        loaderVersion: withVersion != null ? withVersion.loaderVersion : null,
        clientJar: jar != null && minecraft != null && compareVersions(minecraft, '1.6') < 0 ? jar : null,
        name: await nameOf(root)
    }
}
