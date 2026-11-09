/**
 * How much disk space a pack takes: its instance folder, plus the files of
 * its own that live in the common folder, such as a server pack's mods.
 */
const fs = require('fs/promises')
const path = require('path')

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

/**
 * Add up a file or a folder. Links aren't followed, they may point out of the
 * folder or back into it. What can't be read counts as nothing: the result is
 * an estimate and the game may be changing these files.
 *
 * @param {string} target The path.
 * @returns {Promise.<number>} The size in bytes.
 */
async function pathSize(target){
    try {
        const stats = await fs.lstat(target)
        if(!stats.isDirectory()){
            return stats.size
        }
        const names = await fs.readdir(target)
        const sizes = await Promise.all(names.map(name => pathSize(path.join(target, name))))
        return sizes.reduce((sum, size) => sum + size, 0)
    } catch {
        return 0
    }
}

/**
 * @param {string} instanceDir The pack's instance folder.
 * @param {Array.<string>} files The pack's files, which may be inside that folder or out of it.
 * @returns {Promise.<number>} The size in bytes.
 */
exports.packSize = async function(instanceDir, files){
    const inside = instanceDir + path.sep
    const outside = new Set(files.filter(file => !file.startsWith(inside)))
    const sizes = await Promise.all([instanceDir, ...outside].map(pathSize))
    return sizes.reduce((sum, size) => sum + size, 0)
}

/**
 * @param {number} bytes The size.
 * @param {string} locale The locale to write it in.
 * @returns {string} E.g. "5,4 ГБ" or "46 MB".
 */
exports.formatSize = function(bytes, locale){
    let unit = 0
    let value = bytes
    while(value >= 1024 && unit < SIZE_UNITS.length - 1){
        value /= 1024
        unit++
    }
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: SIZE_UNITS[unit],
        maximumFractionDigits: SIZE_UNITS[unit] === 'gigabyte' || SIZE_UNITS[unit] === 'terabyte' ? 1 : 0
    }).format(value)
}
