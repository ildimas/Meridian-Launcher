/** Runtime dependencies which Forge-like loaders discover outside the classpath. */
const fs = require('fs-extra')
const path = require('path')
const got = require('got')
const { Type } = require('helios-distribution-types')

function flatten(modules){
    return modules.flatMap(m => [m, ...flatten(m.subModules || [])])
}

function universal(version){
    const id = `net.neoforged:neoforge:${version}:universal`
    const artifactPath = `net/neoforged/neoforge/${version}/neoforge-${version}-universal.jar`
    return {
        id, name: `NeoForge ${version} Universal`, type: Type.Library, classpath: false,
        meridianRuntimeDependency: true,
        artifact: { path: artifactPath, url: `https://maven.neoforged.net/releases/${artifactPath}`, size: 0 }
    }
}

exports.complete = function(server){
    for(const loader of server.modules || []){
        if(![Type.ForgeHosted, Type.Forge].includes(loader.type)) continue
        const modules = flatten([loader])
        // NeoForge for Minecraft 1.20.1 still uses Forge's artifact/layout.
        if(modules.some(m => /^net\.neoforged:forge:/.test(m.id))) continue
        const versions = new Set()
        for(const module of modules){
            const coordinate = /^net\.neoforged:neoforge:([\w.+-]+)(?::[^:]+)?$/.exec(module.id)
            const manifest = module.type === Type.VersionManifest && /^neoforge-([\w.+-]+)$/.exec(module.id)
            const version = (coordinate || manifest)?.[1]
            if(version && Number(version.split('.')[0]) >= 20) versions.add(version)
        }
        // A universal may be declared elsewhere in the server, including as
        // the main loader jar. Preserve its publisher URL, path and checksum.
        const existing = new Set(flatten(server.modules).map(m => m.id))
        for(const version of versions){
            const dependency = universal(version)
            if(!existing.has(dependency.id)){
                loader.subModules ??= []
                loader.subModules.push(dependency)
                existing.add(dependency.id)
            }
        }
    }
    return server
}

/** Resolve real checksums and sizes before Helios validates or downloads.
 * Cache immutable Maven metadata so subsequent launches also work offline.
 */
exports.prepare = async function(modules, commonDir, http = got){
    for(const module of modules){
        await exports.prepare(module.subModules || [], commonDir, http)
        const raw = module.rawModule
        if(raw.meridianRuntimeDependency !== true) continue
        const match = /^net\.neoforged:neoforge:([\w.+-]+):universal$/.exec(raw.id)
        if(!match) continue
        const expected = universal(match[1]).artifact
        const cache = path.join(commonDir, 'loader-metadata', expected.path + '.json')
        let metadata = await fs.readJson(cache).catch(() => null)
        const valid = value => value?.url === expected.url && /^[a-f0-9]{32}$/i.test(value.MD5) && Number.isSafeInteger(value.size) && value.size > 0
        if(!valid(metadata)){
            const options = { timeout: { request: 15000 }, retry: { limit: 1 } }
            const [checksum, response] = await Promise.all([
                http.get(expected.url + '.md5', options).text(),
                http.head(expected.url, options)
            ])
            metadata = { url: expected.url, MD5: checksum.trim().toLowerCase(), size: Number(response.headers['content-length']) }
            if(!valid(metadata)) throw new Error(`Invalid runtime library metadata: ${raw.id}`)
            await fs.outputJson(cache, metadata)
        }
        Object.assign(raw.artifact, metadata)
    }
}

// Installer profiles mix build tools with runtime dependencies. Keep the
// universal jars for both Forge and NeoForge even if version.json omits them.
exports.isProfileRuntimeLibrary = function(name){
    return /^net\.(minecraftforge|neoforged):(forge|neoforge):[^:]+:universal$/.test(name)
}
