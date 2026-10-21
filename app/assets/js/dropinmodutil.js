const fs        = require('fs-extra')
const path      = require('path')
const { ipcRenderer, shell, webUtils } = require('electron')
const { SHELL_OPCODE } = require('./ipcconstants')

// Group #1: File Name (without .disabled, if any)
// Group #2: File Extension (jar, zip, or litemod)
// Group #3: If it is disabled (if string 'disabled' is present)
const MOD_REGEX = /^(.+(jar|zip|litemod))(?:\.(disabled))?$/
const DISABLED_EXT = '.disabled'

const SHADER_REGEX = /^(.+)\.zip$/
const SHADER_OPTION = /shaderPack=(.+)/
const SHADER_DIR = 'shaderpacks'
const SHADER_CONFIG = 'optionsshaders.txt'

const RESOURCEPACK_DIR = 'resourcepacks'
const GAME_OPTIONS = 'options.txt'
const RESOURCEPACK_OPTION = /^resourcePacks:(.*)$/m

/**
 * Validate that the given directory exists. If not, it is
 * created.
 * 
 * @param {string} modsDir The path to the mods directory.
 */
exports.validateDir = function(dir) {
    fs.ensureDirSync(dir)
}

/**
 * The path of a dropped file. Electron 32 removed File.path.
 *
 * @param {File} f The dropped file.
 */
function droppedPath(f){
    return webUtils != null && webUtils.getPathForFile != null ? webUtils.getPathForFile(f) : f.path
}

/**
 * Scan for drop-in mods in both the mods folder and version
 * safe mods folder.
 * 
 * @param {string} modsDir The path to the mods directory.
 * @param {string} version The minecraft version of the server configuration.
 * 
 * @returns {{fullName: string, name: string, ext: string, disabled: boolean}[]}
 * An array of objects storing metadata about each discovered mod.
 */
exports.scanForDropinMods = function(modsDir, version) {
    const modsDiscovered = []
    if(fs.existsSync(modsDir)){
        let modCandidates = fs.readdirSync(modsDir)
        let verCandidates = []
        const versionDir = path.join(modsDir, version)
        if(fs.existsSync(versionDir)){
            verCandidates = fs.readdirSync(versionDir)
        }
        for(let file of modCandidates){
            const match = MOD_REGEX.exec(file)
            if(match != null){
                modsDiscovered.push({
                    fullName: match[0],
                    name: match[1],
                    ext: match[2],
                    disabled: match[3] != null
                })
            }
        }
        for(let file of verCandidates){
            const match = MOD_REGEX.exec(file)
            if(match != null){
                modsDiscovered.push({
                    fullName: path.join(version, match[0]),
                    name: match[1],
                    ext: match[2],
                    disabled: match[3] != null
                })
            }
        }
    }
    return modsDiscovered
}

/**
 * Add dropin mods.
 * 
 * @param {FileList} files The files to add.
 * @param {string} modsDir The path to the mods directory.
 */
exports.addDropinMods = function(files, modsdir) {

    exports.validateDir(modsdir)

    for(let f of files) {
        if(MOD_REGEX.exec(f.name) != null) {
            fs.moveSync(droppedPath(f), path.join(modsdir, f.name))
        }
    }

}

/**
 * Delete a drop-in mod from the file system.
 * 
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to delete.
 * 
 * @returns {Promise.<boolean>} True if the mod was deleted, otherwise false.
 */
exports.deleteDropinMod = async function(modsDir, fullName){

    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, path.join(modsDir, fullName))

    if(!res.result) {
        shell.beep()
        console.error('Error deleting drop-in mod.', res.error)
        return false
    }

    return true
}

/**
 * Toggle a discovered mod on or off. This is achieved by either 
 * adding or disabling the .disabled extension to the local file.
 * 
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @param {boolean} enable Whether to toggle on or off the mod.
 * 
 * @returns {Promise.<void>} A promise which resolves when the mod has
 * been toggled. If an IO error occurs the promise will be rejected.
 */
exports.toggleDropinMod = function(modsDir, fullName, enable){
    return new Promise((resolve, reject) => {
        const oldPath = path.join(modsDir, fullName)
        const newPath = path.join(modsDir, enable ? fullName.substring(0, fullName.indexOf(DISABLED_EXT)) : fullName + DISABLED_EXT)

        fs.rename(oldPath, newPath, (err) => {
            if(err){
                reject(err)
            } else {
                resolve()
            }
        })
    })
}

/**
 * Check if a drop-in mod is enabled.
 * 
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @returns {boolean} True if the mod is enabled, otherwise false.
 */
exports.isDropinModEnabled = function(fullName){
    return !fullName.endsWith(DISABLED_EXT)
}

/**
 * Scan for shaderpacks inside the shaderpacks folder.
 * 
 * @param {string} instanceDir The path to the server instance directory.
 * 
 * @returns {{fullName: string, name: string}[]}
 * An array of objects storing metadata about each discovered shaderpack.
 */
exports.scanForShaderpacks = function(instanceDir){
    const shaderDir = path.join(instanceDir, SHADER_DIR)
    const packsDiscovered = [{
        fullName: 'OFF',
        name: 'Off (Default)'
    }]
    if(fs.existsSync(shaderDir)){
        let modCandidates = fs.readdirSync(shaderDir)
        for(let file of modCandidates){
            const match = SHADER_REGEX.exec(file)
            if(match != null){
                packsDiscovered.push({
                    fullName: match[0],
                    name: match[1],
                    dir: false
                })
            } else if(isDirectory(path.join(shaderDir, file))){
                // Iris and OptiFine also load unpacked shaderpacks.
                packsDiscovered.push({
                    fullName: file,
                    name: file,
                    dir: true
                })
            }
        }
    }
    return packsDiscovered
}

/**
 * Read the optionsshaders.txt file to locate the current
 * enabled pack. If the file does not exist, OFF is returned.
 * 
 * @param {string} instanceDir The path to the server instance directory.
 * 
 * @returns {string} The file name of the enabled shaderpack.
 */
exports.getEnabledShaderpack = function(instanceDir){
    exports.validateDir(instanceDir)

    const optionsShaders = path.join(instanceDir, SHADER_CONFIG)
    if(fs.existsSync(optionsShaders)){
        const buf = fs.readFileSync(optionsShaders, {encoding: 'utf-8'})
        const match = SHADER_OPTION.exec(buf)
        if(match != null){
            return match[1]
        } else {
            console.warn('WARNING: Shaderpack regex failed.')
        }
    }
    return 'OFF'
}

/**
 * Set the enabled shaderpack.
 * 
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} pack the file name of the shaderpack.
 */
exports.setEnabledShaderpack = function(instanceDir, pack){
    exports.validateDir(instanceDir)

    const optionsShaders = path.join(instanceDir, SHADER_CONFIG)
    let buf
    if(fs.existsSync(optionsShaders)){
        buf = fs.readFileSync(optionsShaders, {encoding: 'utf-8'})
        buf = buf.replace(SHADER_OPTION, `shaderPack=${pack}`)
    } else {
        buf = `shaderPack=${pack}`
    }
    fs.writeFileSync(optionsShaders, buf, {encoding: 'utf-8'})
}

/**
 * Add shaderpacks.
 * 
 * @param {FileList} files The files to add.
 * @param {string} instanceDir The path to the server instance directory.
 */
exports.addShaderpacks = function(files, instanceDir) {

    const p = path.join(instanceDir, SHADER_DIR)

    exports.validateDir(p)

    for(let f of files) {
        if(SHADER_REGEX.exec(f.name) != null) {
            fs.moveSync(droppedPath(f), path.join(p, f.name))
        }
    }

}

function isDirectory(p){
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

/**
 * Scan for resource packs inside the resourcepacks folder: zips, and
 * folders with a pack.mcmeta.
 *
 * @param {string} instanceDir The path to the server instance directory.
 *
 * @returns {{fullName: string, name: string, dir: boolean}[]}
 * An array of objects storing metadata about each discovered resource pack.
 */
exports.scanForResourcepacks = function(instanceDir){
    const packDir = path.join(instanceDir, RESOURCEPACK_DIR)
    const packsDiscovered = []
    if(fs.existsSync(packDir)){
        for(let file of fs.readdirSync(packDir)){
            const full = path.join(packDir, file)
            if(isDirectory(full)){
                if(fs.existsSync(path.join(full, 'pack.mcmeta'))){
                    packsDiscovered.push({ fullName: file, name: file, dir: true })
                }
            } else if(/\.zip$/i.test(file)){
                packsDiscovered.push({ fullName: file, name: file.replace(/\.zip$/i, ''), dir: false })
            }
        }
    }
    return packsDiscovered.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read the resourcePacks list from the game's options.txt.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @returns {string[] | null} The raw entries, or null when there is no list.
 */
function readResourcepackOption(instanceDir){
    const options = path.join(instanceDir, GAME_OPTIONS)
    if(!fs.existsSync(options)){
        return null
    }
    const match = RESOURCEPACK_OPTION.exec(fs.readFileSync(options, {encoding: 'utf-8'}))
    if(match == null){
        return null
    }
    try {
        const list = JSON.parse(match[1])
        return Array.isArray(list) ? list.filter(e => typeof e === 'string') : null
    } catch {
        return null
    }
}

/**
 * Whether options.txt names a pack. Since 1.13 the entries carry a file/ prefix.
 */
function isPackEntry(entry, fullName){
    return entry === 'file/' + fullName || entry === fullName
}

/**
 * The resource packs the game has enabled.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {{fullName: string}[]} packs The packs from scanForResourcepacks.
 * @returns {string[]} The fullName of each enabled pack.
 */
exports.getEnabledResourcepacks = function(instanceDir, packs){
    const list = readResourcepackOption(instanceDir) || []
    return packs.filter(p => list.some(e => isPackEntry(e, p.fullName))).map(p => p.fullName)
}

/**
 * Enable or disable resource packs in options.txt. Packs that stay enabled
 * keep their order, newly enabled ones go on top, and built-in entries such
 * as vanilla are left alone.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {{fullName: string}[]} packs The packs from scanForResourcepacks.
 * @param {string[]} enabled The fullName of each pack that should be enabled.
 * @param {string} mcVersion The server's Minecraft version.
 */
exports.setEnabledResourcepacks = function(instanceDir, packs, enabled, mcVersion){
    const current = readResourcepackOption(instanceDir)
    const list = current != null ? current : ['vanilla']
    const minor = /^1\.(\d+)/.exec(mcVersion)
    const prefix = minor == null || Number(minor[1]) >= 13 ? 'file/' : ''

    const next = list.filter(e => {
        const pack = packs.find(p => isPackEntry(e, p.fullName))
        return pack == null || enabled.includes(pack.fullName)
    })
    for(const fullName of enabled){
        if(!next.some(e => isPackEntry(e, fullName))){
            next.push(prefix + fullName)
        }
    }
    if(current != null && JSON.stringify(current) === JSON.stringify(next)){
        return
    }

    exports.validateDir(instanceDir)
    const options = path.join(instanceDir, GAME_OPTIONS)
    const line = `resourcePacks:${JSON.stringify(next)}`
    let buf = fs.existsSync(options) ? fs.readFileSync(options, {encoding: 'utf-8'}) : ''
    if(RESOURCEPACK_OPTION.test(buf)){
        buf = buf.replace(RESOURCEPACK_OPTION, line)
    } else {
        buf += (buf.length > 0 && !buf.endsWith('\n') ? '\n' : '') + line + '\n'
    }
    fs.writeFileSync(options, buf, {encoding: 'utf-8'})
}

/**
 * Add resource packs.
 *
 * @param {FileList} files The files to add.
 * @param {string} instanceDir The path to the server instance directory.
 */
exports.addResourcepacks = function(files, instanceDir) {

    const p = path.join(instanceDir, RESOURCEPACK_DIR)

    exports.validateDir(p)

    for(let f of files) {
        if(/\.zip$/i.test(f.name)) {
            fs.moveSync(droppedPath(f), path.join(p, f.name))
        }
    }

}

/**
 * Set the game's language in options.txt, leaving every other option alone.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} code Minecraft's language code, e.g. ru_ru.
 */
exports.setGameLanguage = function(instanceDir, code){
    exports.validateDir(instanceDir)
    const options = path.join(instanceDir, GAME_OPTIONS)
    const line = `lang:${code}`
    let buf = fs.existsSync(options) ? fs.readFileSync(options, {encoding: 'utf-8'}) : ''
    const match = buf.match(/^lang:.*$/m)
    if(match != null){
        if(match[0] === line){
            return
        }
        buf = buf.replace(/^lang:.*$/m, line)
    } else {
        buf += (buf.length > 0 && !buf.endsWith('\n') ? '\n' : '') + line + '\n'
    }
    fs.writeFileSync(options, buf, {encoding: 'utf-8'})
}
