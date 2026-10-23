/**
 * Remove mod jars a pack no longer has from its game folder.
 *
 * helios-core only adds and repairs files, it never deletes. A jar a pack
 * version put into mods/ (as a plain file) stays there after the next version
 * drops it or moves it to the pack's mods, and Forge then loads it a second
 * time: coremods crash (AppleCore: "no replacements made"), mods clash.
 *
 * Only mods/ and coremods/ are cleaned: leftover configs are harmless, and
 * the player's own settings must never go.
 */
const fs     = require('fs-extra')
const path   = require('path')
const crypto = require('crypto')

// What the launcher put into mods/ and coremods/ last time, per instance.
const MANIFEST = '.meridian-mods.json'
const MOD_DIRS = ['mods', 'coremods']

function walk(modules, fn){
    for(const m of modules){
        fn(m)
        if(m.subModules.length > 0){
            walk(m.subModules, fn)
        }
    }
}

function md5(file){
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5')
        fs.createReadStream(file).on('error', reject).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex')))
    })
}

function underModDirs(rel){
    return MOD_DIRS.some(d => rel.startsWith(d + '/'))
}

/**
 * Clean a pack's game folder before launch.
 *
 * - Jars the launcher delivered into mods/ or coremods/ last time and this
 *   version doesn't have: deleted.
 * - Jars in mods/ and mods/<version>/ identical to one of the pack's mods
 *   (loaded from the mod store): deleted, they would load twice. This also
 *   cleans up after versions from before the manifest.
 *
 * @param {Object} server The HeliosServer being launched.
 * @param {string} gameDir The instance folder.
 * @param {Object} logger Where to report what was removed.
 * @returns {Promise.<number>} How many files were removed.
 */
exports.clean = async function(server, gameDir, logger){
    const delivered = new Set()
    const packMods = new Set()
    walk(server.modules, m => {
        const raw = m.rawModule
        if(raw.type === 'File'){
            const rel = path.relative(gameDir, m.getPath()).split(path.sep).join('/')
            if(underModDirs(rel)){
                delivered.add(rel)
            }
        } else if(['ForgeMod', 'LiteMod', 'FabricMod'].includes(raw.type) && raw.artifact.MD5){
            packMods.add(raw.artifact.MD5.toLowerCase())
        }
    })

    const remove = new Set()
    const manifestFile = path.join(gameDir, MANIFEST)
    const previous = await fs.readJson(manifestFile).catch(() => [])
    for(const rel of Array.isArray(previous) ? previous : []){
        if(typeof rel === 'string' && underModDirs(rel) && !delivered.has(rel)){
            remove.add(rel)
        }
    }

    const version = server.rawServer.minecraftVersion
    for(const dir of ['mods', `mods/${version}`]){
        const entries = await fs.readdir(path.join(gameDir, dir), { withFileTypes: true }).catch(() => [])
        for(const e of entries){
            const rel = `${dir}/${e.name}`
            if(!e.isFile() || !/\.jar$/i.test(e.name) || delivered.has(rel) || remove.has(rel)){
                continue
            }
            if(packMods.has(await md5(path.join(gameDir, rel)).catch(() => null))){
                remove.add(rel)
            }
        }
    }

    let removed = 0
    for(const rel of remove){
        const file = path.join(gameDir, ...rel.split('/'))
        if(await fs.pathExists(file)){
            await fs.remove(file)
            logger.info(`Removed ${rel}: no longer part of the pack.`)
            removed++
        }
    }
    await fs.writeJson(manifestFile, [...delivered].sort())
    return removed
}
