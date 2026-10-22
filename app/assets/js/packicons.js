/**
 * Icons for modpacks that have no logo of their own, taken from Minecraft
 * itself: item textures from a client jar the launcher already downloaded,
 * or, when there is none yet, from the latest release fetched from Mojang
 * (saved where a launch would put it, so it is not downloaded twice).
 * A pack gets a random icon the first time it needs one, kept in the
 * appearance settings (packs[id].icon) and changed from the Modpacks tab,
 * where a picture of the user's own can be used instead.
 */
const AdmZip = require('adm-zip')
const crypto = require('crypto')
const fs     = require('fs-extra')
const got    = require('got')
const path   = require('path')
const { pathToFileURL } = require('url')
const { getVersionJarPath } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const TEXTURES = 'assets/minecraft/textures/'

// Texture per icon.
const ICONS = [
    { name: 'pickaxe', file: 'item/diamond_pickaxe.png' },
    { name: 'sword', file: 'item/diamond_sword.png' },
    { name: 'diamond', file: 'item/diamond.png' },
    { name: 'emerald', file: 'item/emerald.png' },
    { name: 'endereye', file: 'item/ender_eye.png' },
    { name: 'goldenapple', file: 'item/golden_apple.png' },
    { name: 'totem', file: 'item/totem_of_undying.png' },
    { name: 'blazepowder', file: 'item/blaze_powder.png' },
    { name: 'hoe', file: 'item/diamond_hoe.png' },
    { name: 'goldencarrot', file: 'item/golden_carrot.png' }
]

// Backdrop in Meridian's blues (--meridian-navy into --meridian-ground), dark
// enough for every icon to stand out.
const BACKDROP = 'linear-gradient(160deg, #004477 0%, #021a30 100%)'

// Wait before trying again after a failed load, e.g. while offline.
const RETRY_MS = 5 * 60 * 1000

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

let files = null
let loading = null
let failedAt = 0

function cacheDir(){
    return path.join(ConfigManager.getLauncherDirectory(), 'packicons')
}

// The user's own pictures, one per pack: <id>-<time>.<ext>, the time so a
// replaced picture never shows from the cache.
function customDir(){
    return path.join(cacheDir(), 'custom')
}

function customPrefix(id){
    return String(id).replace(/[^\w.-]/g, '_') + '-'
}

function cached(icon){
    return path.join(cacheDir(), icon.name + '.png')
}

/**
 * A downloaded client jar with every texture, newest first. Loader versions
 * (forge-, neoforge-...) have no textures and are skipped by the check.
 */
async function findClientJar(){
    const root = path.join(ConfigManager.getCommonDirectory(), 'versions')
    const ids = await fs.readdir(root).catch(() => [])
    const jars = []
    for(const id of ids){
        const jar = getVersionJarPath(ConfigManager.getCommonDirectory(), id)
        const st = await fs.stat(jar).catch(() => null)
        if(st != null) jars.push({ jar, mtime: st.mtimeMs })
    }
    jars.sort((a, b) => b.mtime - a.mtime)
    for(const { jar } of jars){
        try {
            const zip = new AdmZip(jar)
            if(hasIcons(zip)){
                return zip
            }
        } catch {
            // Not a readable jar.
        }
    }
    return null
}

function hasIcons(zip){
    return ICONS.every(i => zip.getEntry(TEXTURES + i.file) != null)
}

/**
 * Download a client jar into the versions folder, checked against Mojang's
 * hash: the pack's own version, which its first launch then reuses, or the
 * latest release if that one is too old for these textures.
 *
 * @param {string} preferred A Minecraft version, if known.
 */
async function downloadClientJar(preferred){
    const http = got.extend({ timeout: { request: 30000 }, retry: { limit: 2 } })
    const manifest = await http.get(MANIFEST).json()
    for(const id of [...new Set([preferred, manifest.latest.release].filter(Boolean))]){
        const entry = manifest.versions.find(v => v.id === id)
        if(entry == null){
            continue
        }
        const zip = await downloadVersion(http, entry)
        if(hasIcons(zip)){
            return zip
        }
    }
    throw new Error('No client jar has the icon textures.')
}

/**
 * Save one version's client jar where a launch would put it.
 */
async function downloadVersion(http, entry){
    const client = (await http.get(entry.url).json()).downloads.client
    const data = await got.get(client.url, { timeout: { connect: 15000, socket: 60000 }, retry: { limit: 2 } }).buffer()
    if(crypto.createHash('sha1').update(data).digest('hex') !== client.sha1){
        throw new Error(`Hash mismatch for the ${entry.id} client.`)
    }
    const jar = getVersionJarPath(ConfigManager.getCommonDirectory(), entry.id)
    await fs.ensureDir(path.dirname(jar))
    await fs.writeFile(jar, data)
    return new AdmZip(jar)
}

/**
 * Get the icons ready: from the cache, else from a client jar. Safe to call
 * more than once; resolves to whether they are available. Only called once a
 * tile needs an icon, so a launcher with no such packs downloads nothing.
 *
 * @param {string} minecraft The Minecraft version of the pack asking, used if
 * a client has to be downloaded.
 */
exports.load = function(minecraft){
    if(loading == null && Date.now() - failedAt < RETRY_MS){
        return Promise.resolve(false)
    }
    if(loading == null){
        loading = (async () => {
            try {
                if(!(await Promise.all(ICONS.map(i => fs.pathExists(cached(i))))).every(Boolean)){
                    const zip = await findClientJar() || await downloadClientJar(minecraft)
                    await fs.ensureDir(cacheDir())
                    for(const icon of ICONS){
                        await fs.writeFile(cached(icon), zip.getEntry(TEXTURES + icon.file).getData())
                    }
                }
                files = new Map(ICONS.map(i => [i.name, pathToFileURL(cached(i)).href]))
                return true
            } catch(err) {
                console.warn('Modpack icons are unavailable.', err)
                // Try again later, e.g. once online.
                failedAt = Date.now()
                loading = null
                return false
            }
        })()
    }
    return loading
}

/**
 * The icon chosen for a pack, picking and saving a random one the first time.
 *
 * @param {string} id The pack's server id.
 * @returns {{icon: string} | {custom: string}} An icon name, or the file name
 * of the user's own picture.
 */
function choiceFor(id){
    const packs = ConfigManager.getAppearance().packs
    const saved = packs[id] != null ? packs[id].icon : null
    const valid = saved == null ? false
        : saved.custom ? fs.existsSync(path.join(customDir(), saved.custom))
            : ICONS.some(i => i.name === saved.icon)
    if(valid){
        return saved
    }
    const choice = { icon: ICONS[Math.floor(Math.random() * ICONS.length)].name }
    exports.setChoice(id, choice)
    return choice
}

/**
 * Keep a pack's icon. Its earlier pictures, if any, are deleted.
 *
 * @param {string} id The pack's server id.
 * @param {{icon: string} | {custom: string}} choice An icon name, or a picture
 * saved with saveCustom.
 */
exports.setChoice = function(id, choice){
    const packs = ConfigManager.getAppearance().packs
    packs[id] = Object.assign({}, packs[id], { icon: choice.custom ? { custom: choice.custom } : { icon: choice.icon } })
    ConfigManager.setAppearance({ packs })
    ConfigManager.save()
    const prefix = customPrefix(id)
    let saved = []
    try {
        saved = fs.readdirSync(customDir())
    } catch {
        // No pictures yet.
    }
    for(const file of saved){
        if(file.startsWith(prefix) && file !== choice.custom){
            fs.remove(path.join(customDir(), file)).catch(() => {})
        }
    }
}

/**
 * Save the user's own picture for a pack, to pass to setChoice.
 *
 * @param {string} id The pack's server id.
 * @param {Buffer} data The picture.
 * @param {string} ext Its extension, e.g. '.png'.
 * @returns {Promise<string>} The saved file's name.
 */
exports.saveCustom = async function(id, data, ext){
    const name = customPrefix(id) + Date.now() + ext.toLowerCase()
    await fs.ensureDir(customDir())
    await fs.writeFile(path.join(customDir(), name), data)
    return name
}

/**
 * @param {string} id The pack's server id.
 * @returns {{icon: string} | {custom: string}} Its current icon.
 */
exports.choiceFor = choiceFor

/**
 * @returns {string[]} Every icon name, in display order.
 */
exports.iconNames = () => ICONS.map(i => i.name)

/**
 * An icon as CSS background values. A Minecraft icon is null until load() is
 * done; the user's own picture is ready at once and fills the tile (`full`).
 *
 * @param {{icon: string} | {custom: string, url?: string}} choice An icon name,
 * or a saved picture's file name (or any picture's url).
 * @returns {{image: string, size: string, position: string, background: string, full: boolean} | null}
 */
exports.render = function(choice){
    if(choice.custom || choice.url){
        const url = choice.url || pathToFileURL(path.join(customDir(), choice.custom)).href
        return { image: `url("${url}")`, size: 'cover', position: 'center', background: BACKDROP, full: true }
    }
    if(files == null){
        return null
    }
    const icon = ICONS.find(i => i.name === choice.icon) || ICONS[0]
    return {
        image: `url("${files.get(icon.name)}")`,
        size: '100% 100%',
        position: '0% 0%',
        background: BACKDROP,
        full: false
    }
}

/**
 * @param {string} id The pack's server id.
 * @returns {{image: string, size: string, position: string, background: string, full: boolean} | null}
 * Its icon as CSS background values, or null until load() is done.
 */
exports.iconFor = function(id){
    return exports.render(choiceFor(String(id)))
}
