/**
 * Copies of a pack's worlds (saves/), made before a server pack updates and
 * whenever the player asks, so a mod that changed or went away can't take a
 * world with it for good.
 *
 * A backup is a folder under DATA_DIR/backups/<pack id>/, named by when it
 * was made, holding saves/<world>/ and backup.json:
 *   { created, reason: 'update' | 'manual', from, to, worlds, size }
 * It is written as <name>.partial and renamed when complete, so a backup cut
 * short never shows up as one. Files are cloned where the file system can
 * (btrfs, APFS, XFS), which costs no space until the world changes.
 *
 * Restoring never deletes: a world with the same name is renamed aside
 * first (<world>-before-restore-<time>).
 */
const fs = require('fs-extra')
const path = require('path')

const META = 'backup.json'
const PARTIAL = '.partial'
/** Update backups kept per pack; the player's own are kept until removed. */
exports.KEEP_UPDATE_BACKUPS = 5
/** Free space left over after a backup, in bytes. */
const SPARE_SPACE = 512 * 1024 * 1024

class NoSpaceError extends Error {
    constructor(needed, available){
        super(`Not enough free space for a backup: ${needed} bytes needed, ${available} available`)
        this.name = 'NoSpaceError'
        this.needed = needed
        this.available = available
    }
}
exports.NoSpaceError = NoSpaceError

/**
 * Where a pack's backups go.
 *
 * @param {string} dataDir The launcher's data directory.
 * @param {string} packId The server id.
 * @returns {string}
 */
exports.backupsDir = function(dataDir, packId){
    return path.join(dataDir, 'backups', packId)
}

/**
 * The worlds in a pack: folders in saves/ with a level.dat.
 *
 * @param {string} packDir The pack folder.
 * @returns {Promise.<Array.<string>>} World folder names.
 */
exports.worlds = async function(packDir){
    const saves = path.join(packDir, 'saves')
    let entries
    try {
        entries = await fs.readdir(saves, { withFileTypes: true })
    } catch {
        return []
    }
    const found = []
    for(const entry of entries){
        if(entry.isDirectory() && await fs.pathExists(path.join(saves, entry.name, 'level.dat'))){
            found.push(entry.name)
        }
    }
    return found.sort((a, b) => a.localeCompare(b))
}

/**
 * Every file under some folders, with sizes.
 *
 * @param {string} base The folder paths are relative to.
 * @param {Array.<string>} dirs Folders under base.
 * @returns {Promise.<Array.<{ rel: string, size: number }>>}
 */
async function filesUnder(base, dirs){
    const files = []
    const walk = async rel => {
        for(const entry of await fs.readdir(path.join(base, rel), { withFileTypes: true })){
            const child = path.join(rel, entry.name)
            if(entry.isDirectory()){
                await walk(child)
            } else if(entry.isFile() && entry.name !== 'session.lock'){
                files.push({ rel: child, size: (await fs.stat(path.join(base, child))).size })
            }
        }
    }
    for(const dir of dirs){
        await walk(dir)
    }
    return files
}

/**
 * Copy files with progress, cloning where the file system can.
 */
async function copyFiles(fromBase, toBase, files, onProgress){
    const total = files.reduce((sum, f) => sum + f.size, 0)
    let done = 0
    let lastPercent = -1
    for(const file of files){
        const target = path.join(toBase, file.rel)
        await fs.ensureDir(path.dirname(target))
        await fs.copyFile(path.join(fromBase, file.rel), target, fs.constants.COPYFILE_FICLONE)
        done += file.size
        const percent = total > 0 ? Math.floor(done / total * 100) : 100
        if(percent !== lastPercent){
            lastPercent = percent
            onProgress?.(percent)
        }
    }
    return total
}

/**
 * Free bytes on the disk a folder is on (or would be on).
 */
async function freeSpace(dir){
    let probe = dir
    while(!await fs.pathExists(probe)){
        const parent = path.dirname(probe)
        if(parent === probe) return Infinity
        probe = parent
    }
    try {
        const stats = await fs.statfs(probe)
        return stats.bavail * stats.bsize
    } catch {
        return Infinity
    }
}

function stamp(date){
    const p = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
}

/**
 * Copy a pack's worlds into a new backup.
 *
 * @param {Object} options
 * @param {string} options.packDir The pack folder.
 * @param {string} options.backupsDir The pack's backups folder.
 * @param {'update' | 'manual'} options.reason Why it is made.
 * @param {string} [options.from] The pack version being left (update).
 * @param {string} [options.to] The pack version coming (update).
 * @param {Function} [options.onProgress] Called with 0 to 100.
 * @param {Date} [options.now] The time to name it by.
 * @returns {Promise.<Object | null>} The backup, or null when there are no worlds.
 * @throws {NoSpaceError} When the disk can't hold it.
 */
exports.create = async function({ packDir, backupsDir, reason, from = null, to = null, onProgress, now = new Date() }){
    const worlds = await exports.worlds(packDir)
    if(worlds.length === 0){
        return null
    }
    const saves = path.join(packDir, 'saves')
    const files = await filesUnder(saves, worlds)
    const size = files.reduce((sum, f) => sum + f.size, 0)
    const available = await freeSpace(backupsDir)
    if(size + SPARE_SPACE > available){
        throw new NoSpaceError(size + SPARE_SPACE, available)
    }
    let name = stamp(now)
    for(let i = 2; await fs.pathExists(path.join(backupsDir, name)); i++){
        name = `${stamp(now)}_${i}`
    }
    const partial = path.join(backupsDir, name + PARTIAL)
    await fs.remove(partial)
    try {
        await copyFiles(saves, path.join(partial, 'saves'), files, onProgress)
        const meta = { created: now.toISOString(), reason, from, to, worlds, size }
        await fs.writeJson(path.join(partial, META), meta, { spaces: 2 })
        await fs.rename(partial, path.join(backupsDir, name))
        return { id: name, ...meta }
    } catch(err) {
        await fs.remove(partial).catch(() => {})
        throw err
    }
}

/**
 * A pack's backups, newest first.
 *
 * @param {string} backupsDir The pack's backups folder.
 * @returns {Promise.<Array.<Object>>} Each backup.json with its id.
 */
exports.list = async function(backupsDir){
    let names
    try {
        names = await fs.readdir(backupsDir)
    } catch {
        return []
    }
    const backups = []
    for(const name of names){
        if(name.endsWith(PARTIAL)) continue
        try {
            const meta = await fs.readJson(path.join(backupsDir, name, META))
            if(Array.isArray(meta.worlds) && typeof meta.created === 'string'){
                backups.push({ id: name, ...meta })
            }
        } catch {
            // Not a backup.
        }
    }
    return backups.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id))
}

/**
 * Whether the move between two pack versions is already backed up (a failed
 * download tried again mustn't copy the worlds twice).
 */
exports.hasUpdateBackup = async function(backupsDir, from, to){
    return (await exports.list(backupsDir)).some(b => b.reason === 'update' && b.from === from && b.to === to)
}

/**
 * Keep the newest update backups, drop older ones and leftovers of backups
 * cut short. The player's own backups stay.
 *
 * @param {string} backupsDir The pack's backups folder.
 * @param {number} [keep] Update backups to keep.
 * @returns {Promise.<Array.<string>>} The ids removed.
 */
exports.prune = async function(backupsDir, keep = exports.KEEP_UPDATE_BACKUPS){
    const removed = []
    const updates = (await exports.list(backupsDir)).filter(b => b.reason === 'update')
    for(const backup of updates.slice(keep)){
        await fs.remove(path.join(backupsDir, backup.id))
        removed.push(backup.id)
    }
    try {
        for(const name of await fs.readdir(backupsDir)){
            if(name.endsWith(PARTIAL)) await fs.remove(path.join(backupsDir, name))
        }
    } catch {
        // No backups folder.
    }
    return removed
}

/**
 * Delete a backup.
 */
exports.remove = async function(backupsDir, id){
    if(id !== path.basename(id) || id.endsWith(PARTIAL)) throw new Error(`Not a backup: ${id}`)
    await fs.remove(path.join(backupsDir, id))
}

/**
 * Put a backup's worlds back. A world of the same name in the pack is
 * renamed aside first, never deleted.
 *
 * @param {Object} options
 * @param {string} options.backupsDir The pack's backups folder.
 * @param {string} options.id The backup.
 * @param {string} options.packDir The pack folder.
 * @param {Function} [options.onProgress] Called with 0 to 100.
 * @param {Date} [options.now] The time to name set-aside worlds by.
 * @returns {Promise.<{ restored: Array.<string>, setAside: Array.<string> }>}
 */
exports.restore = async function({ backupsDir, id, packDir, onProgress, now = new Date() }){
    if(id !== path.basename(id)) throw new Error(`Not a backup: ${id}`)
    const backup = path.join(backupsDir, id)
    const meta = await fs.readJson(path.join(backup, META))
    const fromSaves = path.join(backup, 'saves')
    const saves = path.join(packDir, 'saves')
    const worlds = meta.worlds.filter(w => w === path.basename(w) && fs.existsSync(path.join(fromSaves, w)))
    const files = await filesUnder(fromSaves, worlds)
    const size = files.reduce((sum, f) => sum + f.size, 0)
    const available = await freeSpace(saves)
    if(size + SPARE_SPACE > available){
        throw new NoSpaceError(size + SPARE_SPACE, available)
    }
    const setAside = []
    for(const world of worlds){
        const current = path.join(saves, world)
        if(await fs.pathExists(current)){
            let aside = `${world}-before-restore-${stamp(now)}`
            for(let i = 2; await fs.pathExists(path.join(saves, aside)); i++){
                aside = `${world}-before-restore-${stamp(now)}_${i}`
            }
            await fs.rename(current, path.join(saves, aside))
            setAside.push(aside)
        }
    }
    await copyFiles(fromSaves, saves, files, onProgress)
    return { restored: worlds, setAside }
}
