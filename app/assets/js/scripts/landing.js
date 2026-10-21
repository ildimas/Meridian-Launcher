/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_select           = document.getElementById('server_select')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    const launchButton = document.getElementById('launch_button')
    // The server can't change while a launch is in progress.
    document.getElementById('landingContainer').toggleAttribute('launching', loading)
    launchButton.toggleAttribute('launching', loading)
    server_select.disabled = loading
    if(loading) closeServerMenu()
    if(loading){
        launchButton.disabled = true
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launchButton.disabled = ConfigManager.getSelectedServer() == null
        launch_details.style.display = 'none'
        launch_content.style.display = 'flex'
        setLaunchPercentage(0)
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.style.width = percent + '%'
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

/**
 * What to ask mc-heads.net for when drawing an account's skin. Offline
 * accounts have no Mojang profile, so the name (which picks up the skin of
 * the premium player with that name, or Steve) is used instead.
 */
function getAccountSkinId(acc){
    return acc.type === 'offline' ? encodeURIComponent(acc.displayName) : acc.uuid
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/avatar/${getAccountSkinId(authUser)}/88')`
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    updateServerHero(serv)
    renderServerPicker()
    updateModsButton()
    ThemeEngine.setServer(serv != null ? serv.rawServer : null)
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

/**
 * Short label for the server's mod loader, e.g. "Forge 47.2.0".
 *
 * @param {Object} serv The HeliosServer.
 * @returns {string} The label, or Vanilla when the pack has no loader.
 */
function getServerLoaderLabel(serv){
    // Keyed by maven group: Forge ships under several artifact names.
    const names = {
        'net.minecraftforge': 'Forge',
        'net.neoforged': 'NeoForge',
        'net.fabricmc': 'Fabric',
        'org.quiltmc': 'Quilt'
    }
    for(const mdl of serv.modules){
        const type = mdl.rawModule.type
        if(type !== Type.ForgeHosted && type !== Type.Fabric){
            continue
        }
        try {
            const { group, version } = mdl.getMavenComponents()
            const name = names[group] || (type === Type.Fabric ? 'Fabric' : 'Forge')
            // Forge versions are "<mc>-<forge>"; only the loader part is useful.
            return `${name} ${String(version).split('-').pop()}`
        } catch(err) {
            return type === Type.Fabric ? 'Fabric' : 'Forge'
        }
    }
    return Lang.queryJS('landing.serverHero.vanilla')
}

/**
 * One-line summary for the server list, e.g. "Fabric 0.16 · 1.21.1".
 */
function getServerMetaLabel(serv){
    return `${getServerLoaderLabel(serv)} · ${serv.rawServer.minecraftVersion}`
}

// Large selected-server summary on the landing view.
function updateServerHero(serv){
    const name = document.getElementById('serverHeroName')
    const version = document.getElementById('serverHeroVersion')
    const loader = document.getElementById('serverHeroLoader')
    const revision = document.getElementById('serverHeroRevision')
    const desc = document.getElementById('serverHeroDesc')
    const ready = document.getElementById('launchReadyText')
    if(serv == null){
        name.textContent = Lang.queryJS('landing.selectedServer.noSelection')
        version.textContent = ''
        loader.textContent = ''
        revision.textContent = ''
        desc.textContent = ''
        ready.textContent = ''
        return
    }
    name.textContent = serv.rawServer.name
    version.textContent = Lang.queryJS('landing.serverHero.minecraftVersion', { version: serv.rawServer.minecraftVersion })
    loader.textContent = getServerLoaderLabel(serv)
    revision.textContent = Lang.queryJS('landing.serverHero.modpackRevision', { version: serv.rawServer.version })
    desc.textContent = serv.rawServer.description || ''
    ready.textContent = Lang.queryJS('landing.serverHero.ready', { version: serv.rawServer.version })
}

/* Server picker: the dial above the dock and the list next to Play. */

// Dial geometry, in the dial's own 520x180 box (see the handoff spec).
const SERVER_DIAL = { cx: 260, cy: 372, r: 300, step: 20 }
let serverDialWheelAt = 0

/**
 * Initials shown on a dial tile when a server has no icon.
 */
function getServerMonogram(raw){
    if(raw.launcherTheme != null && raw.launcherTheme.monogram){
        return String(raw.launcherTheme.monogram).slice(0, 3)
    }
    const words = String(raw.name).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean)
    const letters = words.length > 1 ? words[0][0] + words[1][0] : String(raw.name).slice(0, 2)
    return letters.toUpperCase()
}

/**
 * Paint a server tile: the server's icon over a monogram on the theme colours.
 *
 * @param {HTMLElement} tile The tile element. Its children are replaced.
 * @param {Object} raw The raw server from distribution.json.
 * @param {Object} appearance The appearance settings.
 * @param {string} prefix Class prefix for the monogram and icon children.
 */
function paintServerTile(tile, raw, appearance, prefix){
    const scene = raw.launcherTheme && raw.launcherTheme.scene
        ? raw.launcherTheme.scene
        : appearance.theme === 'geometry' ? appearance.scene.geometry : appearance.scene.landscapes
    const palette = raw.launcherTheme && raw.launcherTheme.palette ? raw.launcherTheme.palette : appearance.palette.geometry
    const [c0, c1] = Wallpaper.tileColors(scene, palette)
    tile.style.backgroundImage = `linear-gradient(160deg, ${c0} 0%, ${c1} 100%)`
    tile.removeAttribute('hasIcon')
    tile.innerHTML = ''
    const mono = document.createElement('span')
    mono.className = prefix + 'Mono'
    mono.textContent = getServerMonogram(raw)
    tile.appendChild(mono)
    tile.setAttribute('data-icon', raw.icon || '')
    if(raw.icon){
        const show = (url) => {
            // The tile may have been repainted for another server meanwhile.
            if(url == null || tile.getAttribute('data-icon') !== raw.icon) return
            const img = document.createElement('img')
            img.className = prefix + 'Icon'
            img.alt = ''
            img.onload = () => tile.setAttribute('hasIcon', '')
            img.onerror = () => img.remove()
            img.src = url
            tile.appendChild(img)
        }
        const cached = IconCache.peek(raw.icon)
        if(cached !== undefined) show(cached)
        else IconCache.remote(raw.icon).then(show)
    }
}

// Players per server id: { online, max }, null when offline, absent while unknown.
const serverPlayers = new Map()
let serverPlayersAt = 0

/**
 * Ping every server in the distribution and update the list as answers come in.
 *
 * @param {boolean} force Ping even if the last round was under a minute ago.
 */
async function refreshAllServerPlayers(force = false){
    if(!force && Date.now() - serverPlayersAt < 60 * 1000){
        return
    }
    serverPlayersAt = Date.now()
    const distro = await DistroAPI.getDistribution()
    if(distro == null){
        return
    }
    await Promise.all(distro.servers.map(async s => {
        try {
            const stat = await getServerStatus(47, s.hostname, s.port)
            serverPlayers.set(s.rawServer.id, { online: stat.players.online, max: stat.players.max })
        } catch {
            serverPlayers.set(s.rawServer.id, null)
        }
        renderServerMenuStatus()
    }))
}

/**
 * Write the cached player counts into the server list rows.
 */
function renderServerMenuStatus(){
    for(const row of document.getElementById('serverMenuList').children){
        const cell = row.querySelector('.serverListStatus')
        const id = row.getAttribute('data-id')
        const p = serverPlayers.get(id)
        if(p === undefined){
            cell.setAttribute('state', 'pending')
            cell.textContent = Lang.queryJS('landing.serverStatus.checking')
        } else if(p === null){
            cell.setAttribute('state', 'offline')
            cell.textContent = Lang.queryJS('landing.serverStatus.offline')
        } else {
            cell.setAttribute('state', 'online')
            cell.textContent = `${p.online}/${p.max}`
        }
    }
}

// Draw the dial's tick marks once; the ring is rotated as the selection moves.
;(function drawServerDialTicks(){
    let minor = ''
    let major = ''
    const { cx, cy, r } = SERVER_DIAL
    for(let deg = -180; deg < 180; deg += 4){
        const a = deg * Math.PI / 180
        const isMajor = deg % 20 === 0
        const pt = (rad) => (cx + rad * Math.sin(a)).toFixed(1) + ' ' + (cy - rad * Math.cos(a)).toFixed(1)
        const seg = 'M' + pt(r + 7) + ' L' + pt(r + (isMajor ? 19 : 12)) + ' '
        if(isMajor) major += seg
        else minor += seg
    }
    document.getElementById('serverDialTicksMinor').setAttribute('d', minor)
    document.getElementById('serverDialTicksMajor').setAttribute('d', major)
})()

/**
 * Rebuild the dial tiles and the server list from the distribution, and
 * place them around the selected server.
 */
async function renderServerPicker(){
    const distro = await DistroAPI.getDistribution()
    const servers = distro != null ? distro.servers : []
    const selId = ConfigManager.getSelectedServer()
    const sel = Math.max(0, servers.findIndex(s => s.rawServer.id === selId))
    const appearance = ConfigManager.getAppearance()
    const tiles = document.getElementById('serverDialTiles')
    const landing = document.getElementById('landingContainer')

    landing.toggleAttribute('dialHidden', appearance.serverPicker === 'dropdown' || servers.length === 0)

    // Server list next to Play. Rebuilt when the servers or the theme change.
    const menuList = document.getElementById('serverMenuList')
    const themeKey = JSON.stringify([appearance.theme, appearance.scene, appearance.palette])
    const listKey = servers.map(s => s.rawServer.id + ':' + s.rawServer.icon).join('|') + '#' + themeKey
    if(menuList.getAttribute('data-key') !== listKey){
        menuList.innerHTML = ''
        servers.forEach((s, i) => {
            const row = document.createElement('div')
            row.className = 'serverListRow'
            row.setAttribute('role', 'option')
            row.setAttribute('data-id', s.rawServer.id)
            row.innerHTML = '<span class="serverListTile"></span>'
                + '<span class="serverListText"><span class="serverListName"></span><span class="serverListMeta"></span></span>'
                + '<span class="serverListStatus"></span>'
            paintServerTile(row.firstChild, s.rawServer, appearance, 'serverListTile')
            row.querySelector('.serverListName').textContent = s.rawServer.name
            row.querySelector('.serverListMeta').textContent = getServerMetaLabel(s)
            row.onclick = () => {
                closeServerMenu(true)
                selectServerAt(i)
            }
            row.onmousemove = () => setServerMenuActive(i)
            menuList.appendChild(row)
        })
        menuList.setAttribute('data-key', listKey)
        renderServerMenuStatus()
    }
    Array.from(menuList.children).forEach((row, i) => {
        row.toggleAttribute('selected', i === sel && selId != null)
        row.setAttribute('aria-selected', i === sel && selId != null)
    })

    const curServ = selId != null ? servers[sel] : null
    const pickerTile = document.getElementById('serverPickerTile')
    if(curServ != null){
        if(pickerTile.getAttribute('data-key') !== curServ.rawServer.id + '#' + themeKey){
            paintServerTile(pickerTile, curServ.rawServer, appearance, 'serverListTile')
            pickerTile.setAttribute('data-key', curServ.rawServer.id + '#' + themeKey)
        }
        document.getElementById('serverPickerName').textContent = curServ.rawServer.name
        document.getElementById('serverPickerMeta').textContent = getServerMetaLabel(curServ)
    } else {
        pickerTile.removeAttribute('data-key')
        pickerTile.innerHTML = ''
        pickerTile.style.backgroundImage = ''
        document.getElementById('serverPickerName').textContent = Lang.queryJS('landing.selectedServer.noSelection')
        document.getElementById('serverPickerMeta').textContent = ''
    }
    pickerTile.toggleAttribute('empty', curServ == null)
    server_select.toggleAttribute('empty', servers.length === 0)

    // Dial tiles. Tiles are reused so their position animates between states.
    // Rebuild when the servers or the theme (tile colours) change.
    const tileKey = servers.map(s => s.rawServer.id).join('|') + '#' + themeKey
    if(tiles.getAttribute('data-key') !== tileKey){
        tiles.innerHTML = ''
        servers.forEach((s, i) => {
            const raw = s.rawServer
            const tile = document.createElement('button')
            tile.className = 'serverTile'
            tile.tabIndex = -1
            tile.setAttribute('role', 'option')
            tile.setAttribute('aria-label', raw.name)
            paintServerTile(tile, raw, appearance, 'serverTile')
            tile.onclick = () => selectServerAt(i)
            tiles.appendChild(tile)
        })
        tiles.setAttribute('data-key', tileKey)
    }

    Array.from(tiles.children).forEach((tile, i) => {
        const d = i - sel
        const ad = Math.abs(d)
        const a = d * SERVER_DIAL.step * Math.PI / 180
        const x = SERVER_DIAL.cx + SERVER_DIAL.r * Math.sin(a)
        const y = SERVER_DIAL.cy - SERVER_DIAL.r * Math.cos(a)
        const size = ad === 0 ? 72 : ad === 1 ? 52 : 42
        tile.style.left = (x - size / 2).toFixed(1) + 'px'
        tile.style.top = (y - size / 2).toFixed(1) + 'px'
        tile.style.width = size + 'px'
        tile.style.height = size + 'px'
        tile.style.opacity = ad === 0 ? 1 : ad === 1 ? 0.92 : ad === 2 ? 0.5 : 0
        tile.toggleAttribute('selected', d === 0)
        tile.toggleAttribute('far', ad > 2)
        tile.toggleAttribute('edge', ad === 2)
        tile.setAttribute('aria-selected', d === 0)
    })

    document.getElementById('serverDialTicks').style.transform = `rotate(${-sel * SERVER_DIAL.step}deg)`
    const cur = servers[sel]
    document.getElementById('serverDialName').textContent = cur != null ? cur.rawServer.name : ''
    document.getElementById('serverDialPos').textContent = servers.length > 0
        ? Lang.queryJS('landing.serverHero.position', { current: sel + 1, total: servers.length })
        : ''
    document.getElementById('serverDialPrev').disabled = sel <= 0
    document.getElementById('serverDialNext').disabled = sel >= servers.length - 1
}

/**
 * Select the server at an index in the distribution.
 */
async function selectServerAt(index){
    if(document.getElementById('landingContainer').hasAttribute('launching')){
        return
    }
    const servers = (await DistroAPI.getDistribution()).servers
    const next = servers[Math.max(0, Math.min(servers.length - 1, index))]
    if(next == null || next.rawServer.id === ConfigManager.getSelectedServer()){
        return
    }
    updateSelectedServer(next)
    refreshServerStatus(true)
}

async function stepServer(delta){
    const servers = (await DistroAPI.getDistribution()).servers
    const cur = servers.findIndex(s => s.rawServer.id === ConfigManager.getSelectedServer())
    selectServerAt(cur + delta)
}

/* Server list popover. */
const serverPicker = document.getElementById('serverPicker')
const serverMenu = document.getElementById('serverMenu')
let serverMenuActive = -1

function setServerMenuActive(index){
    const rows = document.getElementById('serverMenuList').children
    if(rows.length === 0) return
    serverMenuActive = Math.max(0, Math.min(rows.length - 1, index))
    Array.from(rows).forEach((row, i) => row.toggleAttribute('active', i === serverMenuActive))
    rows[serverMenuActive].scrollIntoView({ block: 'nearest' })
}

function openServerMenu(){
    if(server_select.disabled || server_select.hasAttribute('empty')) return
    serverPicker.setAttribute('open', '')
    server_select.setAttribute('aria-expanded', 'true')
    const rows = Array.from(document.getElementById('serverMenuList').children)
    setServerMenuActive(Math.max(0, rows.findIndex(r => r.hasAttribute('selected'))))
    serverMenu.focus()
    refreshAllServerPlayers()
}

/**
 * @param {boolean} refocus Return focus to the picker button.
 */
function closeServerMenu(refocus = false){
    if(!serverPicker.hasAttribute('open')) return
    serverPicker.removeAttribute('open')
    server_select.setAttribute('aria-expanded', 'false')
    if(refocus) server_select.focus()
}

server_select.onclick = () => {
    if(serverPicker.hasAttribute('open')) closeServerMenu()
    else openServerMenu()
}
server_select.addEventListener('keydown', e => {
    if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
        e.preventDefault()
        e.stopPropagation()
        openServerMenu()
    }
})
serverMenu.addEventListener('keydown', e => {
    // Keep arrows and Escape away from the news drawer shortcuts.
    e.stopPropagation()
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
        e.preventDefault()
        setServerMenuActive(serverMenuActive + (e.key === 'ArrowDown' ? 1 : -1))
    } else if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault()
        const row = document.getElementById('serverMenuList').children[serverMenuActive]
        if(row != null) row.click()
    } else if(e.key === 'Escape' || e.key === 'Tab'){
        closeServerMenu(e.key === 'Escape')
    }
})
document.addEventListener('mousedown', e => {
    if(!serverPicker.contains(e.target)) closeServerMenu()
})
document.getElementById('serverDialPrev').onclick = () => stepServer(-1)
document.getElementById('serverDialNext').onclick = () => stepServer(1)

const serverDial = document.getElementById('serverDial')
// One step per 280ms, however fast the wheel or trackpad reports.
serverDial.addEventListener('wheel', e => {
    const dv = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    const now = Date.now()
    if(Math.abs(dv) < 4 || now - serverDialWheelAt < 280){
        return
    }
    serverDialWheelAt = now
    stepServer(dv > 0 ? 1 : -1)
}, { passive: true })
serverDial.addEventListener('keydown', e => {
    if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
        e.preventDefault()
        e.stopPropagation()
        stepServer(e.key === 'ArrowRight' ? 1 : -1)
    }
})

/* Mods dialog: what the selected pack installs. */

const MOD_TYPES = [Type.ForgeMod, Type.FabricMod, Type.LiteMod, Type.LiteLoader]

/**
 * Flatten a server's mods (including sub-mods) for display.
 *
 * @param {Object} serv The HeliosServer.
 * @returns {Array.<{id: string, mdl: Object, name: string, version: string, optional: boolean, enabled: boolean}>}
 */
function collectServerMods(serv){
    const conf = ConfigManager.getModConfiguration(serv.rawServer.id)
    const out = []
    const walk = (mdls, modCfg) => {
        for(const mdl of mdls){
            if(!MOD_TYPES.includes(mdl.rawModule.type)){
                continue
            }
            const id = mdl.getVersionlessMavenIdentifier()
            const cfg = modCfg != null ? modCfg[id] : null
            let version = ''
            try {
                version = mdl.getMavenComponents().version
            } catch {
                version = ''
            }
            out.push({
                id,
                mdl,
                name: mdl.rawModule.name || id,
                version,
                optional: !mdl.getRequired().value,
                enabled: ProcessBuilder.isModEnabled(cfg, mdl.getRequired())
            })
            if(mdl.subModules.length > 0){
                walk(mdl.subModules, cfg != null && typeof cfg === 'object' ? cfg.mods : null)
            }
        }
    }
    walk(serv.modules, conf != null ? conf.mods : null)
    return out.sort((x, y) => x.name.localeCompare(y.name))
}

let modsDialogMods = []

/**
 * Stable 0..1 value from a string, used to vary the mod tile shade.
 */
function modShade(str){
    let h = 0
    for(let i = 0; i < str.length; i++){
        h = (h * 31 + str.charCodeAt(i)) | 0
    }
    return (Math.abs(h) % 1000) / 1000
}

/**
 * Put the mod's own icon on its tile once it's known; the letter stays otherwise.
 */
function paintModIcon(tile, mdl){
    const show = (url) => {
        if(url == null) return
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
    const cached = IconCache.peek(mdl)
    if(cached !== undefined) show(cached)
    else IconCache.mod(mdl).then(show)
}

function renderModsList(){
    const query = document.getElementById('modsSearchInput').value.trim().toLowerCase()
    const list = document.getElementById('modsList')
    const shown = modsDialogMods.filter(m => !query || m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
    list.innerHTML = ''
    for(const mod of shown){
        const row = document.createElement('div')
        row.className = 'modRow'
        row.setAttribute('role', 'listitem')
        row.toggleAttribute('disabled', !mod.enabled)
        const icon = document.createElement('span')
        icon.className = 'modIcon'
        icon.style.setProperty('--shade', `${Math.round(38 + modShade(mod.id) * 30)}%`)
        icon.textContent = (mod.name.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()
        paintModIcon(icon, mod.mdl)
        const name = document.createElement('span')
        name.className = 'modName'
        name.textContent = mod.name
        row.append(icon, name)
        if(mod.optional){
            const tag = document.createElement('span')
            tag.className = 'modTag'
            tag.textContent = Lang.queryJS(mod.enabled ? 'landing.mods.optional' : 'landing.mods.off')
            row.appendChild(tag)
        }
        const version = document.createElement('span')
        version.className = 'modVersion'
        version.textContent = mod.version
        row.appendChild(version)
        list.appendChild(row)
    }
    list.style.display = shown.length === 0 ? 'none' : ''
    document.getElementById('modsEmpty').style.display = shown.length === 0 ? 'flex' : 'none'
}

/**
 * Refresh the count on the Mods button for the selected server.
 */
async function updateModsButton(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    const button = document.getElementById('modsButton')
    const count = serv != null ? collectServerMods(serv).length : 0
    document.getElementById('modsButtonCount').textContent = count
    // Vanilla packs have nothing to list.
    button.style.display = count > 0 ? '' : 'none'
}

async function openModsDialog(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    if(serv == null){
        return
    }
    modsDialogMods = collectServerMods(serv)
    const optional = modsDialogMods.filter(m => m.optional).length
    document.getElementById('modsSummary').textContent = Lang.queryJS(optional > 0 ? 'landing.mods.summaryOptional' : 'landing.mods.summary', {
        pack: serv.rawServer.name,
        installed: modsDialogMods.filter(m => m.enabled).length,
        optional
    })
    document.getElementById('modsSynced').textContent = Lang.queryJS('landing.mods.synced', { version: serv.rawServer.version })
    document.getElementById('modsManage').style.display = optional > 0 ? '' : 'none'
    const input = document.getElementById('modsSearchInput')
    input.value = ''
    renderModsList()
    const overlay = document.getElementById('modsOverlay')
    overlay.setAttribute('open', '')
    overlay.setAttribute('aria-hidden', 'false')
    document.getElementById('modsButton').setAttribute('aria-expanded', 'true')
    document.getElementById('modsList').scrollTop = 0
    setTimeout(() => input.focus(), 50)
}

function closeModsDialog(){
    const overlay = document.getElementById('modsOverlay')
    if(!overlay.hasAttribute('open')){
        return
    }
    overlay.removeAttribute('open')
    overlay.setAttribute('aria-hidden', 'true')
    document.getElementById('modsButton').setAttribute('aria-expanded', 'false')
    document.getElementById('modsButton').focus()
}

document.getElementById('modsButton').onclick = () => openModsDialog()
document.getElementById('modsClose').onclick = () => closeModsDialog()
document.getElementById('modsSearchInput').oninput = () => renderModsList()
document.getElementById('modsOverlay').addEventListener('mousedown', e => {
    // Clicking the dimmed backdrop closes the dialog.
    if(e.target.id === 'modsOverlay'){
        closeModsDialog()
    }
})
// Capture phase, so Escape closes the dialog before anything else reacts.
document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && document.getElementById('modsOverlay').hasAttribute('open')){
        e.stopPropagation()
        closeModsDialog()
    }
}, true)
document.getElementById('modsManage').onclick = async () => {
    closeModsDialog()
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.querySelector('.settingsNavItem[rSc="settingsTabMods"]'), false)
    })
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    const mojangStatusIcon = document.getElementById('mojang_status_icon')
    mojangStatusIcon.style.color = MojangRestAPI.statusToHex(status)
    mojangStatusIcon.setAttribute('data-label', Lang.queryJS(`landing.mojangStatusLabel.${status}`))
    const stateLabel = document.getElementById('mojangStatusTooltipState')
    stateLabel.textContent = Lang.queryJS(`landing.mojangStatusLabel.${status}`)
    stateLabel.style.color = MojangRestAPI.statusToHex(status)
    document.getElementById('mojangStatusWrapper').setAttribute('aria-label', `${Lang.queryJS('landing.mojang.aria')}: ${stateLabel.textContent}`)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max
        serverPlayers.set(serv.rawServer.id, { online: servStat.players.online, max: servStat.players.max })

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
        if(serv != null) serverPlayers.set(serv.rawServer.id, null)
    }
    renderServerMenuStatus()
    document.getElementById('server_status_wrapper').toggleAttribute('online', pLabel === Lang.queryJS('landing.serverStatus.players'))
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => {
    refreshServerStatus(true)
    refreshAllServerPlayers(true)
}, 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    // The download runs in a child process; hand it the proxy and timeouts.
    ProxyManager.spawnReceiver(fullRepairModule, ConfigManager.getProxy())

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            let desc = err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
            // A stalled download is almost always the network, not the pack.
            if(/timed out/i.test(desc)){
                desc += '<br><br>' + Lang.queryJS('landing.dlAsync.downloadTimedOutHint')
            }
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), desc)
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false

/**
 * Show or hide the news UI. The motion itself lives in CSS, keyed off the
 * landing container's `news` attribute.
 * 
 * @param {boolean} up True to show the news, otherwise false. 
 */
function slide_(up){
    document.getElementById('landingContainer').toggleAttribute('news', up)
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing. The drawer leaves the rest of the landing usable.
    if(newsActive){
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#newsContainer, #newsContainer *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
    document.getElementById('newsButton').setAttribute('aria-pressed', newsActive)
}
document.getElementById('newsClose').onclick = () => {
    document.getElementById('newsButton').click()
}

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    // Keys belong to the mods dialog (search field) while it is open.
    if(document.getElementById('modsOverlay').hasAttribute('open')){
        return
    }
    if(newsActive){
        if(e.key === 'Escape'){
            document.getElementById('newsButton').click()
        }
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}
