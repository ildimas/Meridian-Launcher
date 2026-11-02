/**
 * Pack view: everything about one pack, the selected one. Its mods, resource
 * packs and shaderpacks, and the settings it sets itself instead of taking
 * the shared ones from Settings → Game.
 *
 * Loaded before settings.js, so only call into it from handlers.
 */
const os            = require('os')
const DropinModUtil = require('./assets/js/dropinmodutil')

/**
 * Mods, resource packs and shaderpacks of the selected pack.
 */

const settingsModsContainer = document.getElementById('settingsModsContainer')

// Icon lookups for tiles in the HTML being built, keyed by their data-icon.
const settingsIconJobs = new Map()
let settingsIconSeq = 0

/**
 * Markup for an icon tile: the name's first letter until the icon is known.
 * Call paintSettingsIcons once the markup is in the page.
 *
 * @param {string} name The display name.
 * @param {function(): (string|null|undefined)} peek The already resolved icon, if any.
 * @param {function(): Promise.<string|null>} load Resolves the icon.
 */
function settingsIconTile(name, peek, load){
    const key = String(++settingsIconSeq)
    settingsIconJobs.set(key, { peek, load })
    const letter = (String(name).match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()
    return `<span class="modIcon settingsModIcon" data-icon="${key}" style="--shade: ${Math.round(38 + modShade(String(name)) * 30)}%">${letter}</span>`
}

/**
 * Put the icons on the tiles inside an element.
 */
function paintSettingsIcons(root){
    for(const tile of root.querySelectorAll('.settingsModIcon[data-icon]')){
        const key = tile.getAttribute('data-icon')
        const job = settingsIconJobs.get(key)
        settingsIconJobs.delete(key)
        tile.removeAttribute('data-icon')
        if(job == null) continue
        const show = (url) => {
            if(url == null || !tile.isConnected) return
            const img = document.createElement('img')
            img.alt = ''
            img.onload = () => {
                tile.setAttribute('hasIcon', '')
                // Pixel-art icons stay crisp when scaled up.
                tile.toggleAttribute('pixelated', img.naturalWidth < 30)
            }
            img.onerror = () => img.remove()
            img.src = url
            tile.appendChild(img)
        }
        const cached = job.peek()
        if(cached !== undefined) show(cached)
        else job.load().then(show)
    }
}

/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI(){
    const serv = ConfigManager.getSelectedServer()

    const distro = await DistroAPI.getDistribution()
    const servConf = ConfigManager.getModConfiguration(serv)

    const modStr = parseModulesForUI(distro.getServerById(serv).modules, false, servConf.mods)

    document.getElementById('settingsReqModsContent').innerHTML = modStr.reqMods
    document.getElementById('settingsOptModsContent').innerHTML = modStr.optMods
    paintSettingsIcons(document.getElementById('settingsReqModsContent'))
    paintSettingsIcons(document.getElementById('settingsOptModsContent'))
}

/**
 * Recursively build the mod UI elements.
 * 
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf){

    let reqMods = ''
    let optMods = ''

    for(const mdl of mdls){

        if(mdl.rawModule.type === Type.ForgeMod || mdl.rawModule.type === Type.LiteMod || mdl.rawModule.type === Type.LiteLoader || mdl.rawModule.type === Type.FabricMod){

            if(mdl.getRequired().value){

                reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            ${settingsIconTile(mdl.rawModule.name, () => IconCache.peek(mdl), () => IconCache.mod(mdl))}
                            <div class="settingsModDetails">
                                <span class="settingsModName">${escapeSettingsHTML(mdl.rawModule.name)}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch" reqmod>
                            <input type="checkbox" checked>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, servConf[mdl.getVersionlessMavenIdentifier()])).join('')}
                    </div>` : ''}
                </div>`

            } else {

                const conf = servConf[mdl.getVersionlessMavenIdentifier()]
                const val = typeof conf === 'object' ? conf.value : conf

                optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" ${val ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            ${settingsIconTile(mdl.rawModule.name, () => IconCache.peek(mdl), () => IconCache.mod(mdl))}
                            <div class="settingsModDetails">
                                <span class="settingsModName">${escapeSettingsHTML(mdl.rawModule.name)}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${val ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, conf.mods)).join('')}
                    </div>` : ''}
                </div>`

            }
        }
    }

    return {
        reqMods,
        optMods
    }

}

/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch(){
    const sEls = settingsModsContainer.querySelectorAll('[formod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onchange = () => {
            if(v.checked) {
                document.getElementById(v.getAttribute('formod')).setAttribute('enabled', '')
            } else {
                document.getElementById(v.getAttribute('formod')).removeAttribute('enabled')
            }
        }
    })
}


/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    const modConf = ConfigManager.getModConfiguration(serv)
    if(modConf == null){
        return
    }
    modConf.mods = _saveModConfiguration(modConf.mods)
    ConfigManager.setModConfiguration(serv, modConf)
}

/**
 * Recursively save mod config with submods.
 * 
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf){
    for(let m of Object.entries(modConf)){
        const tSwitch = settingsModsContainer.querySelectorAll(`[formod='${m[0]}']`)
        // The tab can still show another pack's mods while it refreshes.
        if(tSwitch.length === 0){
            continue
        }
        if(!tSwitch[0].hasAttribute('dropin')){
            if(typeof m[1] === 'boolean'){
                modConf[m[0]] = tSwitch[0].checked
            } else {
                if(m[1] != null){
                    if(tSwitch.length > 0){
                        modConf[m[0]].value = tSwitch[0].checked
                    }
                    modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods)
                }
            }
        }
    }
    return modConf
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR
let CACHE_DROPIN_MODS

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
    CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(CACHE_SETTINGS_MODS_DIR, serv.rawServer.minecraftVersion)

    let dropinMods = ''

    for(dropin of CACHE_DROPIN_MODS){
        const jar = path.join(CACHE_SETTINGS_MODS_DIR, dropin.fullName)
        // File names come from whatever is in the mods folder, imported packs included.
        dropinMods += `<div id="${escapeSettingsHTML(dropin.fullName)}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            ${settingsIconTile(dropin.name, () => IconCache.peekFile(jar), () => IconCache.jar(jar))}
                            <div class="settingsModDetails">
                                <span class="settingsModName">${escapeSettingsHTML(dropin.name)}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${escapeSettingsHTML(dropin.fullName)}">${Lang.queryJS('settings.dropinMods.removeButton')}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${escapeSettingsHTML(dropin.fullName)}" dropin ${!dropin.disabled ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
    }

    document.getElementById('settingsDropinModsContent').innerHTML = dropinMods
    paintSettingsIcons(document.getElementById('settingsDropinModsContent'))
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton(){
    const sEls = settingsModsContainer.querySelectorAll('[remmod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            const res = await DropinModUtil.deleteDropinMod(CACHE_SETTINGS_MODS_DIR, fullName)
            if(res){
                document.getElementById(fullName).remove()
            } else {
                setOverlayContent(
                    Lang.queryJS('settings.dropinMods.deleteFailedTitle', { fullName }),
                    Lang.queryJS('settings.dropinMods.deleteFailedMessage'),
                    Lang.queryJS('settings.dropinMods.okButton')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        }
    })
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton(){
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    fsBtn.onclick = () => {
        DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR)
        shell.openPath(CACHE_SETTINGS_MODS_DIR)
    }
    fsBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        fsBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    fsBtn.ondragover = e => {
        e.preventDefault()
    }
    fsBtn.ondragleave = e => {
        fsBtn.removeAttribute('drag')
    }

    fsBtn.ondrop = async e => {
        fsBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR)
        await reloadDropinMods()
    }
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration(){
    if(CACHE_DROPIN_MODS == null) return
    for(dropin of CACHE_DROPIN_MODS){
        const dropinUI = document.getElementById(dropin.fullName)
        if(dropinUI != null){
            const dropinUIEnabled = dropinUI.hasAttribute('enabled')
            if(DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled){
                DropinModUtil.toggleDropinMod(CACHE_SETTINGS_MODS_DIR, dropin.fullName, dropinUIEnabled).catch(err => {
                    if(!isOverlayVisible()){
                        setOverlayContent(
                            Lang.queryJS('settings.dropinMods.failedToggleTitle'),
                            err.message,
                            Lang.queryJS('settings.dropinMods.okButton')
                        )
                        setOverlayHandler(null)
                        toggleOverlay(true)
                    }
                })
            }
        }
    }
}

// Refresh the drop-in mods and packs when F5 is pressed in the pack view.
document.addEventListener('keydown', async (e) => {
    if(getCurrentView() === VIEWS.pack){
        if(e.key === 'F5'){
            await reloadDropinMods()
            saveShaderpackSettings()
            await resolveShaderpacksForUI()
            saveResourcepackSettings()
            await resolveResourcepacksForUI()
        }
    }
})

async function reloadDropinMods(){
    await resolveDropinModsForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindModsToggleSwitch()
}

// Shaderpacks and resource packs.

let CACHE_SETTINGS_INSTANCE_DIR
let CACHE_SHADERPACKS
let CACHE_SELECTED_SHADERPACK
let CACHE_RESOURCEPACKS
let CACHE_SETTINGS_MC_VERSION

/**
 * Markup for a shaderpack or resource pack row.
 *
 * @param {{fullName: string, name: string, dir: boolean}} pack The pack.
 * @param {string} file The pack's path on disk.
 * @param {string} attr The toggle's attribute that carries the pack's fullName.
 * @param {boolean} enabled Whether the pack is on.
 */
function packRowHTML(pack, file, attr, enabled){
    return `<div class="settingsBaseMod settingsDropinMod settingsPack" ${enabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            ${settingsIconTile(pack.name, () => IconCache.peekFile(file), () => IconCache.pack(file))}
                            <div class="settingsModDetails">
                                <span class="settingsModName">${escapeSettingsHTML(pack.name)}</span>
                                <span class="settingsModVersion">${Lang.queryJS(pack.dir ? 'settings.packs.folder' : 'settings.packs.zip')}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" ${attr}="${escapeSettingsHTML(pack.fullName)}" ${enabled ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
}

/**
 * Fill a pack list, or show its empty note.
 */
function renderPackList(cont, rows, emptyKey){
    cont.innerHTML = rows.length > 0 ? rows.join('') : `<div class="settingsPackEmpty">${Lang.queryJS(emptyKey)}</div>`
    cont.toggleAttribute('empty', rows.length === 0)
    paintSettingsIcons(cont)
}

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(CACHE_SETTINGS_INSTANCE_DIR).filter(p => p.fullName !== 'OFF')
    CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR)

    const dir = path.join(CACHE_SETTINGS_INSTANCE_DIR, 'shaderpacks')
    const cont = document.getElementById('settingsShadersContent')
    renderPackList(cont, CACHE_SHADERPACKS.map(p => packRowHTML(p, path.join(dir, p.fullName), 'forshader', p.fullName === CACHE_SELECTED_SHADERPACK)), 'settings.packs.noShaderpacks')

    // Only one shaderpack runs at a time.
    for(const input of cont.querySelectorAll('[forshader]')){
        input.onchange = () => {
            for(const other of cont.querySelectorAll('[forshader]')){
                if(other !== input && input.checked) other.checked = false
                other.closest('.settingsPack').toggleAttribute('enabled', other.checked)
            }
        }
    }
}

function saveShaderpackSettings(){
    if(CACHE_SHADERPACKS == null) return
    const on = document.querySelector('#settingsShadersContent [forshader]:checked')
    const sel = on != null ? on.getAttribute('forshader') : 'OFF'
    if(sel !== CACHE_SELECTED_SHADERPACK){
        DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel)
        CACHE_SELECTED_SHADERPACK = sel
    }
}

/**
 * Load resource pack information.
 */
async function resolveResourcepacksForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SETTINGS_MC_VERSION = serv.rawServer.minecraftVersion
    CACHE_RESOURCEPACKS = DropinModUtil.scanForResourcepacks(CACHE_SETTINGS_INSTANCE_DIR)
    const enabled = DropinModUtil.getEnabledResourcepacks(CACHE_SETTINGS_INSTANCE_DIR, CACHE_RESOURCEPACKS)

    const dir = path.join(CACHE_SETTINGS_INSTANCE_DIR, 'resourcepacks')
    const cont = document.getElementById('settingsResourcepacksContent')
    renderPackList(cont, CACHE_RESOURCEPACKS.map(p => packRowHTML(p, path.join(dir, p.fullName), 'forpack', enabled.includes(p.fullName))), 'settings.packs.noResourcepacks')

    for(const input of cont.querySelectorAll('[forpack]')){
        input.onchange = () => input.closest('.settingsPack').toggleAttribute('enabled', input.checked)
    }
}

function saveResourcepackSettings(){
    if(CACHE_RESOURCEPACKS == null) return
    const enabled = Array.from(document.querySelectorAll('#settingsResourcepacksContent [forpack]:checked')).map(i => i.getAttribute('forpack'))
    try {
        DropinModUtil.setEnabledResourcepacks(CACHE_SETTINGS_INSTANCE_DIR, CACHE_RESOURCEPACKS, enabled, CACHE_SETTINGS_MC_VERSION)
    } catch(err) {
        console.error('Unable to save resource packs.', err)
        settingsSaveFailed(err)
    }
}

/**
 * Open a pack folder on click and take .zip files dropped on the button.
 *
 * @param {HTMLElement} btn The add button.
 * @param {string} folder The folder inside the instance directory.
 * @param {function(FileList, string)} add Moves dropped files into the folder.
 * @param {function(): Promise} reload Saves the current toggles and reloads the list.
 */
function bindPackButton(btn, folder, add, reload){
    btn.onclick = () => {
        const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, folder)
        DropinModUtil.validateDir(p)
        shell.openPath(p)
    }
    btn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        btn.setAttribute('drag', '')
        e.preventDefault()
    }
    btn.ondragover = e => {
        e.preventDefault()
    }
    btn.ondragleave = e => {
        btn.removeAttribute('drag')
    }

    btn.ondrop = async e => {
        btn.removeAttribute('drag')
        e.preventDefault()

        add(e.dataTransfer.files, CACHE_SETTINGS_INSTANCE_DIR)
        await reload()
    }
}

function bindShaderpackButton() {
    bindPackButton(document.getElementById('settingsShaderpackButton'), 'shaderpacks', DropinModUtil.addShaderpacks, async () => {
        saveShaderpackSettings()
        await resolveShaderpacksForUI()
    })
}

function bindResourcepackButton() {
    bindPackButton(document.getElementById('settingsResourcepackButton'), 'resourcepacks', DropinModUtil.addResourcepacks, async () => {
        saveResourcepackSettings()
        await resolveResourcepacksForUI()
    })
}

/**
 * Memory sliders (memoryControl.ejs), shared by the pack view and Settings → Game.
 */

/**
 * @param {Element} v A range slider.
 * @returns {{min: number, max: number, step: number}} Its bounds.
 */
function calculateRangeSliderMeta(v){
    return {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step'))
    }
}

/**
 * Move a slider to a value, clamped to its bounds and notches.
 */
function setRangeSlider(slider, value){
    const meta = calculateRangeSliderMeta(slider)
    value = Math.min(Math.max(Math.round((value - meta.min)/meta.step)*meta.step + meta.min, meta.min), meta.max)
    const perc = meta.max > meta.min ? (value - meta.min)/(meta.max - meta.min)*100 : 0
    slider.setAttribute('value', value)
    slider.setAttribute('aria-valuenow', value)
    slider.setAttribute('aria-valuetext', formatRAM(value))
    slider.querySelector('.rangeSliderTrack').style.left = perc + '%'
    slider.querySelector('.rangeSliderBar').style.width = perc + '%'
}

/**
 * @param {number} gb Memory in gigabytes.
 * @returns {string} E.g. "4G" or "4.5G".
 */
function formatRAM(gb){
    return `${Number(gb.toFixed(1))}G`
}

/**
 * Keep max at or above min, update the labels and warn about taking most of
 * the system's memory.
 *
 * @param {Element} root The memory control.
 * @param {'min' | 'max'} moved The slider that moved.
 */
function syncMemoryControl(root, moved){
    const max = root.querySelector('[data-ram="max"]')
    const min = root.querySelector('[data-ram="min"]')
    if(Number(max.getAttribute('value')) < Number(min.getAttribute('value'))){
        if(moved === 'max') setRangeSlider(min, Number(max.getAttribute('value')))
        else setRangeSlider(max, Number(min.getAttribute('value')))
    }
    const total = os.totalmem()/1073741824
    for(const slider of [max, min]){
        const value = Number(slider.getAttribute('value'))
        slider.setAttribute('warn', value >= total/2 ? 'high' : value >= total/4 ? 'mid' : '')
        root.querySelector(`[data-ram-label="${slider.getAttribute('data-ram')}"]`).textContent = formatRAM(value)
    }
}

/**
 * Bind dragging, clicks and arrow keys on the sliders of every memory control.
 */
function bindMemoryControls(){
    for(const root of document.getElementsByClassName('memoryControl')){
        for(const slider of root.getElementsByClassName('rangeSlider')){
            const which = slider.getAttribute('data-ram')
            slider.tabIndex = 0
            slider.setAttribute('role', 'slider')
            slider.setAttribute('aria-label', slider.parentElement.querySelector('.memoryRowTitle').textContent)
            // The track is centered on its position, so the mouse and the
            // track's center line up.
            const moveTo = (e) => {
                const rect = slider.getBoundingClientRect()
                const meta = calculateRangeSliderMeta(slider)
                const perc = Math.min(Math.max((e.clientX - rect.left)/rect.width, 0), 1)
                setRangeSlider(slider, meta.min + perc*(meta.max - meta.min))
                syncMemoryControl(root, which)
            }
            slider.onmousedown = (e) => {
                if(e.button !== 0 || root.hasAttribute('disabled')){
                    return
                }
                e.preventDefault()
                slider.focus()
                moveTo(e)
                document.onmouseup = () => {
                    document.onmousemove = null
                    document.onmouseup = null
                }
                document.onmousemove = moveTo
            }
            slider.onkeydown = (e) => {
                const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
                if(dir == null || root.hasAttribute('disabled')){
                    return
                }
                e.preventDefault()
                e.stopPropagation()
                const meta = calculateRangeSliderMeta(slider)
                setRangeSlider(slider, Number(slider.getAttribute('value')) + dir*meta.step)
                syncMemoryControl(root, which)
            }
        }
    }
}
bindMemoryControls()

/**
 * Show memory on a control.
 *
 * @param {Element} root The memory control.
 * @param {number} floor The least the sliders go to, in gigabytes.
 * @param {{minRAM: string, maxRAM: string}} memory The values to show.
 */
function setMemoryControl(root, floor, memory){
    const ceil = Math.max(ConfigManager.getAbsoluteMaxRAM(), floor)
    for(const slider of root.getElementsByClassName('rangeSlider')){
        slider.setAttribute('min', floor)
        slider.setAttribute('max', ceil)
        slider.setAttribute('aria-valuemin', floor)
        slider.setAttribute('aria-valuemax', ceil)
    }
    setRangeSlider(root.querySelector('[data-ram="max"]'), ConfigManager.ramGB(memory.maxRAM))
    setRangeSlider(root.querySelector('[data-ram="min"]'), ConfigManager.ramGB(memory.minRAM))
    syncMemoryControl(root, 'max')
    root.querySelector('[data-ram-total]').textContent = formatRAM((os.totalmem()-1073741824)/1073741824)
    root.querySelector('[data-ram-free]').textContent = formatRAM(os.freemem()/1073741824)
}

/**
 * @param {Element} root The memory control.
 * @returns {{minRAM: string, maxRAM: string}} The values on it.
 */
function readMemoryControl(root){
    return {
        minRAM: ConfigManager.ramString(Number(root.querySelector('[data-ram="min"]').getAttribute('value'))),
        maxRAM: ConfigManager.ramString(Number(root.querySelector('[data-ram="max"]').getAttribute('value')))
    }
}

/**
 * Turn a settings group (.packGroup) between its own values and the inherited
 * ones, which are shown greyed out.
 */
function setGroupOwn(group, own){
    group.toggleAttribute('own', own)
    group.querySelector('.packOwnToggle').checked = own
    const body = group.querySelector('.packGroupBody')
    for(const el of body.querySelectorAll('input, button')){
        el.disabled = !own
    }
    for(const memory of body.getElementsByClassName('memoryControl')){
        memory.toggleAttribute('disabled', !own)
        for(const slider of memory.getElementsByClassName('rangeSlider')){
            slider.tabIndex = own ? 0 : -1
            slider.setAttribute('aria-disabled', String(!own))
        }
    }
}

/**
 * Java
 */

const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc     = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink     = document.getElementById('settingsJvmOptsLink')

/**
 * Validate the provided executable path and display the data on
 * the UI.
 * 
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    const details = await validateSelectedJvm(ensureJavaDirIsRoot(execPath), server.effectiveJavaOptions.supported)

    if(details != null) {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.selectedJava', { version: details.semverStr, vendor: details.vendor })
    } else {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
    }
}

function populateJavaReqDesc(server) {
    settingsJavaReqDesc.innerHTML = Lang.queryJS('settings.java.requiresJava', { major: server.effectiveJavaOptions.suggestedMajor })
}

function populateJvmOptsLink(server) {
    const major = server.effectiveJavaOptions.suggestedMajor
    settingsJvmOptsLink.innerHTML = Lang.queryJS('settings.java.availableOptions', { major: major })
    if(major >= 12) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`
    }
    else if(major >= 11) {
        settingsJvmOptsLink.href = 'https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE'
    }
    else if(major >= 9) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`
    }
    else {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${process.platform === 'win32' ? 'windows' : 'unix'}/java.html`
    }
}

/**
 * The view itself
 */

const packContainer = document.getElementById('packContainer')
const packMemory    = document.getElementById('packMemory')
const packJvmInput  = document.getElementById('settingsJVMOptsVal')
const packJavaInput = document.getElementById('settingsJavaExecVal')

const packView = {
    serverId: null,
    // The view to go back to: the main screen or Settings → Modpacks.
    returnTo: VIEWS.landing,
    tab: 'packPanelOverview',
    // Groups the pack sets itself, as toggled on the Settings tab.
    own: { memory: false, window: false, jvm: false },
    // The pack's own values from when the view opened, shown again if a group
    // is turned off and back on.
    saved: {},
    javaExec: null
}

function memoryText(memory){
    return memory.minRAM === memory.maxRAM ? formatRAM(ConfigManager.ramGB(memory.maxRAM)) : `${formatRAM(ConfigManager.ramGB(memory.minRAM))} – ${formatRAM(ConfigManager.ramGB(memory.maxRAM))}`
}

function windowText(win){
    return win.fullscreen ? Lang.queryJS('pack.windowFull') : `${win.resWidth} × ${win.resHeight}`
}

/**
 * Where a group's values come from while the pack doesn't set its own.
 *
 * @param {'memory' | 'window' | 'jvm'} group The group.
 * @returns {'shared' | 'recommended'} The source.
 */
function inheritedSource(group){
    if(group === 'memory') return ConfigManager.getDefaultMemory() != null ? 'shared' : 'recommended'
    if(group === 'jvm') return ConfigManager.getDefaultJVMOptions() != null ? 'shared' : 'recommended'
    return 'shared'
}

/**
 * The values a group shows while the pack doesn't set its own.
 */
function inheritedText(group){
    const id = packView.serverId
    if(group === 'memory') return memoryText(ConfigManager.getInheritedMemory(id))
    if(group === 'window') return windowText(ConfigManager.getInheritedGameWindow())
    return ''
}

/**
 * Fill the line under a group's title and the Overview summary.
 */
function renderPackGroupStates(){
    for(const group of document.querySelectorAll('#packPanelSettings .packGroup[data-group]')){
        const name = group.getAttribute('data-group')
        const state = group.querySelector('.packGroupState')
        if(packView.own[name]){
            state.textContent = Lang.queryJS('pack.stateOwn')
        } else {
            const value = inheritedText(name)
            const key = inheritedSource(name) === 'shared' ? 'pack.stateShared' : 'pack.stateRecommended'
            state.textContent = Lang.queryJS(key + (value ? '' : 'Plain'), { value })
        }
    }

    const id = packView.serverId
    const summary = {
        packSumMemory: packView.own.memory ? memoryText(readMemoryControl(packMemory)) : inheritedText('memory'),
        packSumWindow: packView.own.window ? windowText(readPackWindow() ?? ConfigManager.getGameWindow(id)) : inheritedText('window'),
        packSumJvm: ''
    }
    for(const [el, group] of [['packSumMemory', 'memory'], ['packSumWindow', 'window'], ['packSumJvm', 'jvm']]){
        const source = packView.own[group] ? 'pack.sumOwn' : inheritedSource(group) === 'shared' ? 'pack.sumShared' : 'pack.sumRecommended'
        const value = summary[el]
        document.getElementById(el).textContent = value ? `${value} · ${Lang.queryJS(source)}` : Lang.queryJS(source + 'Plain')
    }
    document.getElementById('packOwnBadge').hidden = !Object.values(packView.own).some(Boolean)
}

/**
 * @returns {{resWidth: number, resHeight: number, fullscreen: boolean} | null} The window on the Settings tab, null if a size isn't a number.
 */
function readPackWindow(){
    const resWidth = document.getElementById('packGameWidth').value
    const resHeight = document.getElementById('packGameHeight').value
    if(!ConfigManager.validateGameWidth(resWidth) || !ConfigManager.validateGameHeight(resHeight)){
        return null
    }
    return { resWidth: Number.parseInt(resWidth), resHeight: Number.parseInt(resHeight), fullscreen: document.getElementById('packFullscreen').checked }
}

function showPackWindow(win){
    document.getElementById('packGameWidth').value = win.resWidth
    document.getElementById('packGameHeight').value = win.resHeight
    document.getElementById('packFullscreen').checked = win.fullscreen
}

/**
 * Show a group's values: the pack's own, or the inherited ones.
 */
function showPackGroupValues(name){
    const id = packView.serverId
    const own = packView.own[name]
    const saved = packView.saved[name]
    if(name === 'memory'){
        setMemoryControl(packMemory, ConfigManager.getRecommendedJava(id).floor, own && saved != null ? saved : ConfigManager.getInheritedMemory(id))
    } else if(name === 'window'){
        showPackWindow(own && saved != null ? saved : ConfigManager.getInheritedGameWindow())
    } else if(name === 'jvm'){
        packJvmInput.value = (own && saved != null ? saved : ConfigManager.getInheritedJVMOptions(id)).join(' ')
    }
}

for(const group of document.querySelectorAll('#packPanelSettings .packGroup[data-group]')){
    const name = group.getAttribute('data-group')
    group.querySelector('.packOwnToggle').onchange = (e) => {
        packView.own[name] = e.target.checked
        // Turned back on, the group shows the values it had.
        if(!e.target.checked){
            packView.saved[name] = name === 'memory' ? readMemoryControl(packMemory) : name === 'window' ? readPackWindow() : packJvmInput.value.trim().split(/\s+/).filter(Boolean)
        }
        showPackGroupValues(name)
        setGroupOwn(group, e.target.checked)
        renderPackGroupStates()
    }
}
packMemory.addEventListener('mouseup', renderPackGroupStates)
packMemory.addEventListener('keyup', renderPackGroupStates)
for(const id of ['packGameWidth', 'packGameHeight']){
    const input = document.getElementById(id)
    // Whole numbers only.
    input.addEventListener('keydown', (e) => {
        if(/^[-.eE]$/.test(e.key)){
            e.preventDefault()
        }
    })
    input.addEventListener('input', () => {
        input.toggleAttribute('error', !ConfigManager.validateGameWidth(input.value))
        renderPackGroupStates()
    })
}
document.getElementById('packFullscreen').onchange = renderPackGroupStates

document.getElementById('packResetOwn').onclick = () => {
    for(const group of document.querySelectorAll('#packPanelSettings .packGroup[data-group]')){
        const name = group.getAttribute('data-group')
        if(packView.own[name]){
            group.querySelector('.packOwnToggle').click()
        }
    }
}

/**
 * Load the selected pack's settings onto the Settings tab.
 */
async function preparePackSettings(server){
    const id = server.rawServer.id
    for(const name of Object.keys(packView.own)){
        packView.own[name] = ConfigManager.getPackOwn(id, name)
    }
    // A group turned on here starts from the inherited values.
    packView.saved = {
        memory: packView.own.memory ? ConfigManager.getOwnMemory(id) : null,
        window: packView.own.window ? ConfigManager.getGameWindow(id) : null,
        jvm: packView.own.jvm ? ConfigManager.getOwnJVMOptions(id) : null
    }
    for(const group of document.querySelectorAll('#packPanelSettings .packGroup[data-group]')){
        const name = group.getAttribute('data-group')
        showPackGroupValues(name)
        setGroupOwn(group, packView.own[name])
    }
    // Compared as shown: an unset Java (null) shows as empty.
    packJavaInput.value = ConfigManager.getJavaExecutable(id) ?? ''
    packView.javaExec = packJavaInput.value
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
    renderPackGroupStates()
    await populateJavaExecDetails(packJavaInput.value)
}

/**
 * Store the Settings tab.
 */
function savePackSettings(){
    const id = packView.serverId
    if(id == null || id !== ConfigManager.getSelectedServer() || !selectedServerExists()){
        return
    }
    if(packView.own.memory){
        const memory = readMemoryControl(packMemory)
        ConfigManager.setMinRAM(id, memory.minRAM)
        ConfigManager.setMaxRAM(id, memory.maxRAM)
    }
    if(packView.own.window){
        // A size that isn't a number keeps the last good one.
        const win = readPackWindow() ?? ConfigManager.getGameWindow(id)
        ConfigManager.setOwnGameWindow(id, win)
    }
    if(packView.own.jvm){
        ConfigManager.setJVMOptions(id, packJvmInput.value.trim() ? packJvmInput.value.trim().split(/\s+/) : [])
    }
    for(const [name, own] of Object.entries(packView.own)){
        ConfigManager.setPackOwn(id, name, own)
    }
    if(packJavaInput.value !== packView.javaExec){
        ConfigManager.setJavaExecutable(id, packJavaInput.value)
    }
}

/**
 * Pack name, chips and the Overview facts.
 */
function renderPackHeader(server){
    const raw = server.rawServer
    const local = LocalPacks.isLocal(raw)
    paintServerTile(document.getElementById('packTile'), raw, ConfigManager.getAppearance(), 'serverListTile')
    document.getElementById('packName').textContent = raw.name
    document.getElementById('packName').title = raw.name
    document.getElementById('packChipVersion').textContent = Lang.queryJS('landing.serverHero.minecraftVersion', { version: raw.minecraftVersion })
    document.getElementById('packChipLoader').textContent = getServerLoaderLabel(server)
    document.getElementById('packChipRevision').textContent = Lang.queryJS('landing.serverHero.modpackRevision', { version: raw.version })
    const source = document.getElementById('packChipSource')
    source.textContent = local ? Lang.queryJS('pack.sourceLocal') : raw.mainServer ? Lang.queryJS('settings.serverListing.mainServer') : ''
    source.hidden = source.textContent === ''
    source.toggleAttribute('main', !local && raw.mainServer === true)

    document.getElementById('packFactMinecraft').textContent = raw.minecraftVersion
    document.getElementById('packFactLoader').textContent = getServerLoaderLabel(server)
    document.getElementById('packFactRevision').textContent = raw.version
    document.getElementById('packSourceNote').textContent = Lang.queryJS(local ? 'pack.noteLocal' : 'pack.noteServer')

    const launch = document.getElementById('launch_button')
    document.getElementById('packPlay').disabled = launch.disabled

    // Own packs go entirely; a server pack only loses its files, the server
    // brings it back and they download again on launch.
    const remove = document.getElementById('packRemove')
    const running = isServerRunning(raw.id)
    remove.textContent = Lang.queryJS(local ? 'pack.removePack' : 'pack.removeFiles')
    remove.disabled = running
    document.getElementById('packRemoveNote').textContent = Lang.queryJS(running ? 'pack.removeRunning' : local ? 'pack.removePackNote' : 'pack.removeFilesNote')
}

document.getElementById('packRemove').onclick = async () => {
    const server = (await DistroAPI.getDistribution()).getServerById(packView.serverId)
    if(server == null) return
    const raw = server.rawServer
    const local = LocalPacks.isLocal(raw)
    setOverlayContent(
        Lang.queryJS(local ? 'settings.modpacks.removeTitle' : 'pack.removeFilesTitle', { name: escapeSettingsHTML(raw.name) }),
        Lang.queryJS(local ? 'settings.modpacks.removeDesc' : 'pack.removeFilesDesc'),
        Lang.queryJS(local ? 'settings.modpacks.removeConfirm' : 'pack.removeFilesConfirm'),
        Lang.queryJS('settings.modpacks.removeCancel')
    )
    setOverlayHandler(async () => {
        toggleOverlay(false)
        // Leave first, so the view doesn't show the pack while it goes.
        packView.returnTo = VIEWS.landing
        closePackView()
        if(local){
            await mpRemove(raw)
            return
        }
        const error = await mpRemoveFiles(raw)
        await refreshPackInstalled()
        if(error != null){
            setOverlayContent(Lang.queryJS('pack.removeFilesFailed', { name: escapeSettingsHTML(raw.name) }), error, Lang.queryJS('settings.modpacks.removeCancel'))
            setOverlayHandler(null)
            toggleOverlay(true)
        }
    })
    setDismissHandler(null)
    toggleOverlay(true, true)
}

/**
 * Item counts next to the tab names.
 */
function renderPackCounts(){
    const mods = settingsModsContainer.querySelectorAll('#settingsReqModsContent > .settingsBaseMod, #settingsOptModsContent > .settingsBaseMod, #settingsDropinModsContent > .settingsBaseMod').length
    document.getElementById('packCountMods').textContent = mods
    document.getElementById('packCountResourcepacks').textContent = CACHE_RESOURCEPACKS?.length ?? 0
    document.getElementById('packCountShaders').textContent = CACHE_SHADERPACKS?.length ?? 0
}

/**
 * Show one of the view's tabs.
 *
 * @param {string} panelId The panel to show.
 * @param {boolean} fade False to switch at once.
 */
function selectPackTab(panelId, fade = true){
    packView.tab = panelId
    for(const tab of document.getElementsByClassName('packTabButton')){
        const on = tab.getAttribute('rSc') === panelId
        tab.toggleAttribute('selected', on)
        tab.setAttribute('aria-selected', String(on))
        tab.tabIndex = on ? 0 : -1
    }
    for(const panel of document.getElementsByClassName('packPanel')){
        const on = panel.id === panelId
        if(on === !panel.hidden) continue
        panel.hidden = !on
        if(on){
            panel.scrollTop = 0
            if(fade) animateIn(panel, 260, { rise: 8 })
        }
    }
}

for(const tab of document.getElementsByClassName('packTabButton')){
    tab.onclick = () => selectPackTab(tab.getAttribute('rSc'))
}
document.getElementById('packTabs').addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if(dir == null) return
    const tabs = Array.from(document.getElementsByClassName('packTabButton'))
    const next = tabs[(tabs.findIndex(t => t.hasAttribute('selected')) + dir + tabs.length) % tabs.length]
    next.click()
    next.focus()
})
document.getElementById('packSumEdit').onclick = () => selectPackTab('packPanelSettings')

for(const btn of document.querySelectorAll('#packPanelOverview [data-open]')){
    btn.onclick = () => {
        const dir = path.join(ConfigManager.getInstanceDirectory(), packView.serverId, btn.getAttribute('data-open'))
        DropinModUtil.validateDir(dir)
        shell.openPath(dir)
    }
}

/**
 * Prepare the mods and pack lists for display.
 */
async function preparePackLists(){
    await resolveModsForUI()
    await resolveDropinModsForUI()
    await resolveShaderpacksForUI()
    await resolveResourcepacksForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindShaderpackButton()
    bindResourcepackButton()
    bindModsToggleSwitch()
    renderPackCounts()
}

/**
 * Fill the view for the selected pack.
 */
async function preparePackView(){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    // No pack left to show, e.g. offline after removing the last one.
    if(server == null || !selectedServerExists()){
        return
    }
    packView.serverId = server.rawServer.id
    renderPackHeader(server)
    selectPackTab(packView.tab, false)
    await preparePackLists()
    await preparePackSettings(server)
}

/**
 * Store everything changed in the view.
 */
function savePackView(){
    // A failed save must not keep the user from leaving.
    try {
        if(!selectedServerExists()){
            return
        }
        saveModConfiguration()
        savePackSettings()
        ConfigManager.save()
        saveDropinModConfiguration()
        saveShaderpackSettings()
        saveResourcepackSettings()
    } catch(err) {
        console.error('Unable to save the pack settings.', err)
        settingsSaveFailed(err)
    }
}

/**
 * Open the view for the selected pack, from the main screen or settings.
 */
function openPackView(){
    if(document.getElementById('landingContainer').hasAttribute('launching')) return
    packView.returnTo = getCurrentView() === VIEWS.settings ? VIEWS.settings : VIEWS.landing
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    switchView(getCurrentView(), VIEWS.pack, 500, 500, () => preparePackView())
}

function closePackView(){
    savePackView()
    switchView(getCurrentView(), packView.returnTo, 500, 500, () => {
        if(packView.returnTo === VIEWS.settings) mpRenderInstalled()
    })
}

document.getElementById('packBack').onclick = closePackView
document.getElementById('packPlay').onclick = () => {
    savePackView()
    switchView(getCurrentView(), VIEWS.landing, 500, 500, () => {}, () => {
        const launch = document.getElementById('launch_button')
        if(!launch.disabled) launch.click()
    })
}
document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && getCurrentView() === VIEWS.pack && !isOverlayVisible() && !e.defaultPrevented){
        // Taken: the view it goes back to mustn't close on it too.
        e.preventDefault()
        closePackView()
    }
})
