/**
 * Which of a server pack's files the launcher keeps in step with the pack.
 *
 * Every file a pack ships is checked against its hash before each launch and
 * downloaded again when it differs. That is right for mods and most configs,
 * but it also reset the player's own settings on every launch: graphics and
 * keys (options.txt), shaders, client-side mod settings. Those are seed
 * files: the pack's copy is put in place only when the file isn't there yet,
 * after that the file is the player's.
 *
 * The server list (servers.dat) is merged instead: the pack's servers are
 * always in it, and the ones the player added stay (see serverlist.js).
 *
 * A distribution module can decide for itself with `meridianSeed`: true makes
 * any file a seed file, false keeps a file the rules below would match in
 * step with the pack.
 */
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')

/** The pack's copy of servers.dat, next to the player's. */
exports.PACK_SERVER_LIST = '.meridian-servers.dat'

/**
 * Settings files at the top of the pack folder: options.txt and its
 * companions (optionsof.txt for OptiFine, optionsshaders.txt, optionsCLP.txt,
 * smart_moving_options.txt...).
 */
const ROOT_OPTIONS = /^[^/]*options[^/]*\.txt$/i

/** Player settings of rendering and shader mods, in config/. */
const CONFIG_SETTINGS = new Set([
    'config/sodium-options.json',
    'config/embeddium-options.json',
    'config/iris.properties',
    'config/oculus.properties'
])

/**
 * A mod's client-side config in config/: modid-client.toml,
 * Mekanism/client.toml, NCR-Client.json and the like. Only the client reads
 * them, so they hold what the player sees and presses, not game rules.
 */
const CLIENT_CONFIG = /^config\/(?:.*\/)?(?:[^/]*[-_.])?client\.(?:toml|json5?|cfg|properties|txt|ya?ml)$/i

/**
 * Whether a pack file is a seed file, by where it goes.
 *
 * @param {string} relativePath The file's path in the pack folder.
 * @returns {boolean}
 */
exports.isSeedPath = function(relativePath){
    const file = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '')
    return ROOT_OPTIONS.test(file) || CONFIG_SETTINGS.has(file.toLowerCase()) || CLIENT_CONFIG.test(file)
}

/**
 * What the launcher does with a pack module's file.
 *
 * @param {Object} module A helios-core HeliosModule.
 * @returns {'sync' | 'seed' | 'serverList'}
 */
exports.handling = function(module){
    const raw = module.rawModule
    const file = raw?.type === 'File' ? raw.artifact?.path : null
    if(file == null){
        return 'sync'
    }
    if(raw.meridianSeed === true){
        return 'seed'
    }
    if(raw.meridianSeed === false){
        return 'sync'
    }
    if(file.replace(/\\/g, '/').replace(/^\.\//, '') === 'servers.dat'){
        return 'serverList'
    }
    return exports.isSeedPath(file) ? 'seed' : 'sync'
}

/**
 * Where the pack's copy of a servers.dat goes.
 *
 * @param {string} serverListPath The player's servers.dat.
 * @returns {string}
 */
exports.packServerListPath = function(serverListPath){
    return path.join(path.dirname(serverListPath), exports.PACK_SERVER_LIST)
}

/**
 * Whether a file on disk has the given MD5.
 *
 * @param {string} file The file.
 * @param {string} md5 The expected hash.
 * @returns {Promise.<boolean>}
 */
async function hasMd5(file, md5){
    if(md5 == null){
        return fs.pathExists(file)
    }
    try {
        const data = await fs.readFile(file)
        return crypto.createHash('md5').update(data).digest('hex') === String(md5).toLowerCase()
    } catch {
        return false
    }
}

/**
 * Validate a pack's modules the Meridian way, around helios-core's own
 * validateModules: seed files on disk are left alone, servers.dat is checked
 * (and downloaded) as the pack's copy next to the player's.
 *
 * @param {Array.<Object>} modules HeliosModules to validate.
 * @param {Array.<Object>} accumulator helios-core's list of files to download.
 * @param {Function} validate helios-core's validateModules(modules, accumulator), bound.
 */
exports.validateModules = async function(modules, accumulator, validate){
    const synced = []
    for(const module of modules){
        const handling = exports.handling(module)
        if(handling === 'sync'){
            synced.push(module)
            continue
        }
        const raw = module.rawModule
        if(handling === 'seed'){
            if(!await fs.pathExists(module.getPath())){
                synced.push(module)
                continue
            }
        } else {
            const packCopy = exports.packServerListPath(module.getPath())
            if(!await hasMd5(packCopy, raw.artifact.MD5)){
                accumulator.push({
                    id: raw.id,
                    hash: raw.artifact.MD5,
                    algo: 'md5',
                    size: raw.artifact.size,
                    url: raw.artifact.url,
                    path: packCopy
                })
            }
        }
        if(module.hasSubModules()){
            await exports.validateModules(module.subModules, accumulator, validate)
        }
    }
    if(synced.length > 0){
        await validate(synced, accumulator)
    }
}

/**
 * Find a pack's servers.dat module.
 *
 * @param {Array.<Object>} modules A server's HeliosModules.
 * @returns {Object | null}
 */
exports.findServerList = function(modules){
    for(const module of modules || []){
        if(exports.handling(module) === 'serverList'){
            return module
        }
        const sub = module.hasSubModules() ? exports.findServerList(module.subModules) : null
        if(sub != null){
            return sub
        }
    }
    return null
}
