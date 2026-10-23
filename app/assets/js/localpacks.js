/**
 * Modpacks the player added themselves: imported from CurseForge, Modrinth or
 * Prism, or a plain Minecraft version. They are stored as distribution servers
 * in localpacks.json in the launcher directory and merged into the
 * distribution, so the rest of the launcher treats them like any other pack.
 *
 * Loaded in the renderer and, through localpackschild.js, in helios-core's
 * download process, which reads the distribution on its own. No Electron here.
 */
const fs   = require('fs')
const path = require('path')
const { Type } = require('helios-distribution-types')

const FILE = 'localpacks.json'

// Module types that make a server modded; without one it's vanilla.
const LOADER_TYPES = [Type.ForgeHosted, Type.Forge, Type.Fabric]

function storePath(launcherDir){
    return path.join(launcherDir, FILE)
}

/**
 * The Java versions a Minecraft version runs on, as a distribution
 * javaOptions.supported range. Versions that want Java 8 get exactly 8:
 * launchwrapper and Forge before 1.17 break on Java 9+.
 *
 * @param {number} major The Java major version Mojang declares.
 * @returns {string} The supported range.
 */
exports.javaRange = function(major){
    return major <= 8 ? '8.x' : `>=${major}.x`
}

/**
 * Packs stored before Java 8 was pinned allowed any newer Java.
 */
function migrateJavaOptions(server){
    const java = server.javaOptions
    if(java != null && java.suggestedMajor != null && java.supported === `>=${java.suggestedMajor}.x`){
        java.supported = exports.javaRange(java.suggestedMajor)
    }
    return server
}

/**
 * @param {string} launcherDir The launcher directory.
 * @returns {Array.<Object>} The stored servers, in distribution format.
 */
exports.read = function(launcherDir){
    try {
        const data = JSON.parse(fs.readFileSync(storePath(launcherDir), 'utf-8'))
        return Array.isArray(data.servers) ? data.servers.map(migrateJavaOptions) : []
    } catch {
        return []
    }
}

/**
 * Replace the stored servers.
 *
 * @param {string} launcherDir The launcher directory.
 * @param {Array.<Object>} servers The servers, in distribution format.
 */
exports.write = function(launcherDir, servers){
    const file = storePath(launcherDir)
    const tmp = file + '.tmp'
    fs.mkdirSync(launcherDir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ servers }, null, 4), 'utf-8')
    fs.renameSync(tmp, file)
}

/**
 * @param {Object} rawServer A distribution server.
 * @returns {boolean} Whether the player added it, rather than the distribution.
 */
exports.isLocal = function(rawServer){
    return rawServer != null && rawServer.local != null
}

/**
 * Whether a server runs without a mod loader.
 *
 * @param {Object} server A HeliosServer.
 */
exports.isVanilla = function(server){
    return !server.modules.some(m => LOADER_TYPES.includes(m.rawModule.type))
}

/**
 * Add the stored servers to a raw distribution. Safe to call more than once.
 *
 * @param {Object | null} distro The raw distribution, or null if none loaded.
 * @param {string} launcherDir The launcher directory.
 * @returns {Object | null} The distribution with the local servers.
 */
exports.mergeInto = function(distro, launcherDir){
    const local = exports.read(launcherDir)
    if(distro == null){
        // Offline with no cached distribution: the local packs still work.
        return local.length > 0 ? { version: '1.0.0', servers: local } : null
    }
    distro.servers = (distro.servers || []).filter(s => !exports.isLocal(s)).concat(local)
    return distro
}

/**
 * Make every DistributionAPI include the local servers in what it loads.
 *
 * @param {Function} DistributionAPI helios-core's DistributionAPI class.
 */
exports.patchDistributionAPI = function(DistributionAPI){
    const proto = DistributionAPI.prototype
    if(proto.localPacksPatched){
        return
    }
    proto.localPacksPatched = true
    for(const name of ['pullLocal', '_loadDistributionNullable']){
        const original = proto[name]
        proto[name] = async function(...args){
            return exports.mergeInto(await original.apply(this, args), this.launcherDirectory)
        }
    }
}

/**
 * Let vanilla servers through the mod loader step: helios-core requires a
 * loader, and resolves to null here when the server has none.
 *
 * Forge before 1.13 is read from the version.json inside its jar, and the
 * version parsed from its maven id, which fails for 1.6.4 and older. Local
 * packs store the manifest alongside, so it's read from there.
 *
 * @param {Function} DistributionIndexProcessor helios-core's processor class.
 */
exports.patchIndexProcessor = function(DistributionIndexProcessor){
    const proto = DistributionIndexProcessor.prototype
    if(proto.localPacksPatched){
        return
    }
    proto.localPacksPatched = true
    const original = proto.loadModLoaderVersionJson
    proto.loadModLoaderVersionJson = async function(...args){
        const server = this.distribution.getServerById(this.serverId)
        if(server != null && exports.isVanilla(server)){
            return null
        }
        if(server != null && exports.isLocal(server.rawServer)){
            const loader = server.modules.find(m => m.rawModule.type === Type.ForgeHosted)
            if(loader != null && loader.subModules.some(m => m.rawModule.type === Type.VersionManifest)){
                return this.loadVersionManifest(loader)
            }
        }
        return original.apply(this, args)
    }
}
