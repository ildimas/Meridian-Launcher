/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const fs                      = require('fs-extra')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile,
    getVersionJarPath
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
const PackIcons               = require('./assets/js/packicons')
const LocalPacks              = require('./assets/js/localpacks')
const PackCleanup             = require('./assets/js/packcleanup')

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
        launch_details.style.display = 'none'
        launch_content.style.display = 'flex'
        setLaunchPercentage(0)
        renderRunningState()
        // A launch downloads whatever was missing.
        refreshPackInstalled()
        maybeApplyPendingLanguage()
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
    sizeLaunchRing()
    followLaunchRing(percent)
    launch_progress_label.innerHTML = percent + '%'
}

const followLaunchRing = progressFollower(p => {
    launch_progress.querySelector('.launchRingFill').style.strokeDashoffset = 100 - p
})

// Gap between the pill and its progress ring, and the ring's width, in px.
const LAUNCH_RING = { gap: 4, width: 3 }

/**
 * Shape the progress ring to the launch button: a pill just outside it,
 * starting at the top centre and running clockwise.
 */
function sizeLaunchRing(){
    const button = document.getElementById('launch_button')
    const w = button.offsetWidth
    const h = button.offsetHeight
    if(w === 0 || launch_progress.getAttribute('data-size') === `${w}x${h}`){
        return
    }
    launch_progress.setAttribute('data-size', `${w}x${h}`)
    const o = LAUNCH_RING.gap + LAUNCH_RING.width
    const W = w + 2 * o
    const H = h + 2 * o
    const s = LAUNCH_RING.width / 2
    const r = H / 2 - s
    const d = `M ${W / 2} ${s} H ${W - s - r} A ${r} ${r} 0 0 1 ${W - s - r} ${H - s} H ${s + r} A ${r} ${r} 0 0 1 ${s + r} ${s} Z`
    launch_progress.setAttribute('viewBox', `0 0 ${W} ${H}`)
    launch_progress.style.inset = `${-o}px`
    for(const path of launch_progress.querySelectorAll('path')){
        path.setAttribute('d', d)
    }
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
    // A modpack that is already running can't be launched a second time.
    document.getElementById('launch_button').disabled = !val || isServerRunning(ConfigManager.getSelectedServer())
}

/* Running game tracking */

// Game processes per server id, while they are running.
const runningServers = new Map()

/**
 * @param {string} id The server id.
 * @returns {boolean} Whether the modpack of that server is currently running.
 */
function isServerRunning(id){
    return id != null && runningServers.has(id)
}

/**
 * Track a game process until it exits, keeping the running indicators in sync.
 *
 * @param {string} id The server id.
 * @param {ChildProcess} child The game process.
 */
function trackRunningServer(id, child){
    runningServers.set(id, child)
    const done = () => {
        if(runningServers.get(id) === child){
            runningServers.delete(id)
            renderRunningState()
            // A language picked while the game ran applies now.
            maybeApplyPendingLanguage()
        }
    }
    child.on('close', done)
    child.on('error', done)
    renderRunningState()
}

/* Download vs Play */

// Whether a server's pack is fully on disk, per server id; absent until checked.
const packInstalled = new Map()

/**
 * Collect the files a pack needs on disk: every module (optional ones are
 * downloaded too) and the Minecraft version jar.
 */
function packFiles(serv){
    const files = [getVersionJarPath(ConfigManager.getCommonDirectory(), serv.rawServer.minecraftVersion)]
    const walk = (mdls) => {
        for(const mdl of mdls){
            try {
                files.push(mdl.getPath())
            } catch {
                // Modules without a local path have nothing to check.
            }
            walk(mdl.subModules)
        }
    }
    walk(serv.modules)
    return files
}

/**
 * Check whether the selected server's pack is on disk and relabel the launch
 * button. Only checks the files exist; hashes are validated on launch.
 */
async function refreshPackInstalled(){
    const id = ConfigManager.getSelectedServer()
    const distro = await DistroAPI.getDistribution()
    const serv = distro != null ? distro.getServerById(id) : null
    if(serv == null){
        return
    }
    const exists = await Promise.all(packFiles(serv).map(f => fs.pathExists(f)))
    packInstalled.set(id, exists.every(Boolean))
    renderRunningState()
}

/**
 * Show which modpacks are running: the hero chip, the Play button, the server
 * list rows and the dial tiles.
 */
function renderRunningState(){
    const selId = ConfigManager.getSelectedServer()
    const running = isServerRunning(selId)
    const launchButton = document.getElementById('launch_button')

    document.getElementById('serverHeroRunning').hidden = !running
    launchButton.toggleAttribute('running', running)
    // Until the check finishes the button keeps saying Play.
    const needsDownload = packInstalled.get(selId) === false
    const update = packUpdateFor(selId)
    const updateChip = document.getElementById('serverHeroUpdate')
    updateChip.hidden = running || update == null
    updateChip.textContent = update != null ? Lang.queryJS('landing.packUpdate.chip', { version: update }) : ''
    document.getElementById('launchButtonLabel').textContent = Lang.queryJS(running ? 'landing.running.button' : update != null ? 'landing.running.update' : needsDownload ? 'landing.running.download' : 'landing.running.play')
    if(!document.getElementById('landingContainer').hasAttribute('launching')){
        launchButton.disabled = selId == null || running
    }

    server_select.toggleAttribute('running', running)
    for(const row of document.getElementById('serverMenuList').children){
        row.toggleAttribute('running', isServerRunning(row.getAttribute('data-id')))
        row.toggleAttribute('update', packUpdateFor(row.getAttribute('data-id')) != null)
    }
    for(const tile of document.getElementById('serverDialTiles').children){
        tile.toggleAttribute('running', isServerRunning(tile.getAttribute('data-id')))
        tile.toggleAttribute('update', packUpdateFor(tile.getAttribute('data-id')) != null)
    }
}

/* Pack updates */

// distribution.json is fetched again this often, and when the window comes
// back after at least focusGap; the notice hides itself after toastMs.
const PACK_UPDATE = { every: 10 * 60 * 1000, focusGap: 2 * 60 * 1000, toastMs: 15000 }
// "<server id>@<version>" the player was already told about this session.
const packUpdatesTold = new Set()
let packUpdateCheckedAt = 0
let packUpdateChecking = false
let packUpdateToastTimer = null

/**
 * The new version of a pack the player has, or null when it is up to date,
 * was never launched here, or is a local modpack.
 *
 * @param {string} id The server id.
 */
function packUpdateFor(id){
    const distro = DistroAPI.distribution
    const serv = distro != null && id != null ? distro.getServerById(id) : null
    if(serv == null || LocalPacks.isLocal(serv.rawServer) || serv.rawServer.version == null) return null
    const have = ConfigManager.getPackVersion(id)
    return have != null && have !== String(serv.rawServer.version) ? String(serv.rawServer.version) : null
}

/**
 * Packs installed before versions were remembered count as up to date with
 * what the distribution says the first time it is seen.
 */
function packUpdateBaseline(distro){
    let changed = false
    for(const serv of distro.servers){
        const raw = serv.rawServer
        if(LocalPacks.isLocal(raw) || raw.version == null || ConfigManager.getPackVersion(raw.id) != null) continue
        if(fs.existsSync(require('path').join(ConfigManager.getInstanceDirectory(), raw.id))){
            ConfigManager.setPackVersion(raw.id, raw.version)
            changed = true
        }
    }
    if(changed) ConfigManager.save()
}

/**
 * Tell the player about packs that got a new version, once per version: a
 * notice on the landing view and, when the launcher is in the background, a
 * system notification.
 */
function announcePackUpdates(distro){
    const fresh = distro.servers.filter(s => {
        const v = packUpdateFor(s.rawServer.id)
        return v != null && !packUpdatesTold.has(`${s.rawServer.id}@${v}`)
    })
    if(fresh.length === 0) return
    for(const s of fresh) packUpdatesTold.add(`${s.rawServer.id}@${s.rawServer.version}`)
    const one = fresh.length === 1 ? fresh[0].rawServer : null
    const title = Lang.queryJS('landing.packUpdate.title')
    const text = one != null
        ? Lang.queryJS('landing.packUpdate.one', { name: one.name, version: one.version })
        : Lang.queryJS('landing.packUpdate.many', { names: fresh.map(s => s.rawServer.name).join(', ') })
    const open = () => {
        hidePackUpdateToast()
        if(one != null && one.id !== ConfigManager.getSelectedServer()){
            updateSelectedServer(DistroAPI.distribution.getServerById(one.id))
        }
    }

    const toast = document.getElementById('packUpdateToast')
    toast.querySelector('.packUpdateTitle').textContent = title
    toast.querySelector('.packUpdateText').textContent = text
    const btn = toast.querySelector('.packUpdateOpen')
    btn.hidden = one == null || one.id === ConfigManager.getSelectedServer()
    btn.onclick = open
    toast.hidden = false
    void toast.offsetWidth
    toast.classList.add('packUpdateShown')
    clearTimeout(packUpdateToastTimer)
    packUpdateToastTimer = setTimeout(hidePackUpdateToast, PACK_UPDATE.toastMs)

    if(!document.hasFocus() && typeof Notification !== 'undefined'){
        const note = new Notification(title, { body: text, silent: false })
        note.onclick = () => {
            const win = remote.getCurrentWindow()
            if(win.isMinimized()) win.restore()
            win.show()
            win.focus()
            open()
        }
    }
}

function hidePackUpdateToast(){
    clearTimeout(packUpdateToastTimer)
    const toast = document.getElementById('packUpdateToast')
    toast.classList.remove('packUpdateShown')
    setTimeout(() => {
        if(!toast.classList.contains('packUpdateShown')) toast.hidden = true
    }, 320)
}
document.querySelector('#packUpdateToast .packUpdateClose').onclick = hidePackUpdateToast

/**
 * Fetch distribution.json again and show what changed. Skipped while a game
 * is launching or running, and away from the landing view, so nothing is
 * swapped under the player's feet.
 */
async function checkPackUpdates(){
    if(packUpdateChecking || DistroAPI.distribution == null) return
    if(getCurrentView() !== VIEWS.landing || launcherBusy()) return
    packUpdateChecking = true
    packUpdateCheckedAt = Date.now()
    try {
        const before = JSON.stringify(DistroAPI.rawDistribution)
        const distro = await DistroAPI.refreshDistributionOrFallback()
        if(JSON.stringify(DistroAPI.rawDistribution) !== before){
            onDistroRefresh(distro)
        }
        packUpdateBaseline(distro)
        renderRunningState()
        announcePackUpdates(distro)
    } catch(err) {
        loggerLanding.warn('Unable to check for pack updates.', err)
    } finally {
        packUpdateChecking = false
    }
}

// First look at the distribution loaded on start, then keep checking.
const packUpdateStart = setInterval(() => {
    if(DistroAPI.distribution == null || getCurrentView() !== VIEWS.landing) return
    clearInterval(packUpdateStart)
    packUpdateBaseline(DistroAPI.distribution)
    packUpdateCheckedAt = Date.now()
    renderRunningState()
    announcePackUpdates(DistroAPI.distribution)
    setInterval(checkPackUpdates, PACK_UPDATE.every)
}, 2000)
window.addEventListener('focus', () => {
    if(Date.now() - packUpdateCheckedAt >= PACK_UPDATE.focusGap) checkPackUpdates()
})

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
// Settings are filled in while the landing fades out, not before it starts.
document.getElementById('settingsMediaButton').onclick = () => {
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => prepareSettings())
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = () => {
    switchView(getCurrentView(), VIEWS.settings, 500, 500, async () => {
        await prepareSettings()
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
    // Local packs record their loader; their first module can be a library of
    // it (NeoForge's is fancymodloader) with an unrelated version.
    const local = serv.rawServer.local
    if(local != null && local.loader){
        if(local.loader === 'vanilla'){
            return Lang.queryJS('landing.serverHero.vanilla')
        }
        const name = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', quilt: 'Quilt' }[local.loader] || local.loader
        return local.loaderVersion ? `${name} ${local.loaderVersion}` : name
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

const HERO_NAME_SIZE = { max: 52, min: 30, step: 2, lines: 2 }

/**
 * The hero name wraps between words; shrink it until it fits in two lines
 * without a word overflowing the hero.
 */
function fitHeroName(){
    const name = document.getElementById('serverHeroName')
    name.style.fontSize = ''
    const width = name.parentElement.clientWidth
    if(width === 0){
        return
    }
    const fits = (size) => {
        name.style.fontSize = size + 'px'
        const lineHeight = parseFloat(getComputedStyle(name).lineHeight)
        return name.scrollWidth <= width && name.offsetHeight <= lineHeight * HERO_NAME_SIZE.lines * 1.2
    }
    let size = HERO_NAME_SIZE.max
    while(size > HERO_NAME_SIZE.min && !fits(size)){
        size -= HERO_NAME_SIZE.step
    }
    if(size === HERO_NAME_SIZE.max){
        name.style.fontSize = ''
    }
}
// Also refits when the landing view is shown, since its width is 0 while hidden.
new ResizeObserver(fitHeroName).observe(document.getElementById('serverHero'))

// Large selected-server summary on the landing view.
function updateServerHero(serv){
    const name = document.getElementById('serverHeroName')
    const version = document.getElementById('serverHeroVersion')
    const loader = document.getElementById('serverHeroLoader')
    const revision = document.getElementById('serverHeroRevision')
    // Local modpacks have no server, so there is no status to show.
    document.getElementById('statusCard').hidden = serv != null && LocalPacks.isLocal(serv.rawServer)
    if(serv == null){
        name.textContent = Lang.queryJS('landing.selectedServer.noSelection')
        name.removeAttribute('title')
        fitHeroName()
        version.textContent = ''
        loader.textContent = ''
        revision.textContent = ''
        renderRunningState()
        return
    }
    name.textContent = serv.rawServer.name
    name.title = serv.rawServer.name
    fitHeroName()
    version.textContent = Lang.queryJS('landing.serverHero.minecraftVersion', { version: serv.rawServer.minecraftVersion })
    loader.textContent = getServerLoaderLabel(serv)
    revision.textContent = Lang.queryJS('landing.serverHero.modpackRevision', { version: serv.rawServer.version })
    renderRunningState()
    refreshPackInstalled()
}

/* Server picker: the dial above the dock and the list next to Play. */

// Dial geometry, in the dial's own 520x180 box (see the handoff spec).
const SERVER_DIAL = { cx: 260, cy: 372, r: 300, step: 20, tile: 72 }
let serverDialWheelAt = 0

// Where the dial is turned to: a fractional server index while it turns.
const serverDialTurn = { pos: null, from: 0, to: 0, start: 0, ms: 0, frame: null }

// Narrow windows show only the neighbouring tiles (matches launcher.css).
const serverDialNarrow = window.matchMedia('(max-width: 1239px)')
serverDialNarrow.addEventListener('change', () => {
    if(serverDialTurn.pos != null) placeServerDial(serverDialTurn.pos)
})

/**
 * Put every dial tile on the arc for a dial position. Positions between
 * servers place tiles between their slots, so a turn of any length follows
 * the circle; animating each tile's transform instead cuts straight across
 * it, and over a few steps the tiles dip towards its centre.
 *
 * @param {number} pos The server index at the top, fractional mid-turn.
 */
function placeServerDial(pos){
    Array.from(document.getElementById('serverDialTiles').children).forEach((tile, i) => {
        const d = i - pos
        const ad = Math.abs(d)
        const a = d * SERVER_DIAL.step * Math.PI / 180
        const x = SERVER_DIAL.cx + SERVER_DIAL.r * Math.sin(a)
        const y = SERVER_DIAL.cy - SERVER_DIAL.r * Math.cos(a)
        // Selected 72px, neighbours 52px, the rest 42px, blended in between.
        const size = ad <= 1 ? 72 - 20 * ad : ad <= 2 ? 52 - 10 * (ad - 1) : 42
        // Narrow windows fade tiles out just past the neighbours, by where they
        // are mid-turn rather than where they end up, so they clear the side
        // blocks.
        const opacity = ad <= 1 ? 1 - 0.08 * ad
            : serverDialNarrow.matches ? Math.max(0, 0.92 * (1 - 2 * (ad - 1)))
            : ad <= 2 ? 0.92 - 0.42 * (ad - 1) : Math.max(0, 0.5 * (3 - ad))
        // Tiles are SERVER_DIAL.tile wide; a transform places and sizes them.
        tile.style.transform = `translate(${(x - SERVER_DIAL.tile / 2).toFixed(1)}px, ${(y - SERVER_DIAL.tile / 2).toFixed(1)}px) scale(${(size / SERVER_DIAL.tile).toFixed(4)})`
        tile.style.opacity = opacity.toFixed(3)
        tile.style.visibility = opacity > 0 ? '' : 'hidden'
    })
    document.getElementById('serverDialTicks').style.transform = `rotate(${(-pos * SERVER_DIAL.step).toFixed(3)}deg)`
}

/**
 * Turn the dial to a server, along the arc. A new target mid-turn carries on
 * from where the dial is.
 *
 * @param {number} sel The server index to bring to the top.
 * @param {boolean} jump Place it at once, e.g. when the tiles were rebuilt.
 */
function turnServerDial(sel, jump = false){
    const t = serverDialTurn
    if(t.frame != null){
        cancelAnimationFrame(t.frame)
        t.frame = null
    }
    if(jump || t.pos == null || reduceMotion.matches || t.pos === sel){
        t.pos = sel
        placeServerDial(sel)
        return
    }
    t.from = t.pos
    t.to = sel
    t.start = performance.now()
    // Longer turns take a little longer, so they stay readable.
    t.ms = Math.min(900, 420 + 100 * Math.abs(sel - t.from))
    const step = (now) => {
        const k = Math.min(1, (now - t.start) / t.ms)
        // Ease out, close to --dial-ease.
        t.pos = t.from + (t.to - t.from) * (1 - Math.pow(1 - k, 4))
        placeServerDial(t.pos)
        t.frame = k < 1 ? requestAnimationFrame(step) : null
    }
    t.frame = requestAnimationFrame(step)
}

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
 * Without a monogram from the distribution it gets a Minecraft item icon
 * instead (see packicons.js), which also shows if the logo fails to load.
 *
 * @param {HTMLElement} tile The tile element. Its children are replaced.
 * @param {Object} raw The raw server from distribution.json.
 * @param {Object} appearance The appearance settings.
 * @param {string} prefix Class prefix for the monogram and icon children.
 */
function paintServerTile(tile, raw, appearance, prefix, ownIcon = false){
    // An icon the player picked replaces the pack's logo and monogram.
    const picked = !ownIcon && PackIcons.isPicked(raw.id)
    const logo = picked ? null : raw.icon
    tile.setAttribute('data-pack-id', raw.id)
    tile.setAttribute('data-pack-prefix', prefix)
    tile.toggleAttribute('data-own-icon', ownIcon)
    tile.style.backgroundImage = 'linear-gradient(160deg, var(--meridian-mid) 0%, var(--meridian-navy) 100%)'
    tile.removeAttribute('hasIcon')
    tile.removeAttribute('data-pack-icon')
    tile.removeAttribute('data-pack-mc')
    tile.innerHTML = ''
    const mono = document.createElement('span')
    mono.className = prefix + 'Mono'
    mono.textContent = getServerMonogram(raw)
    tile.appendChild(mono)
    if(picked || raw.launcherTheme == null || !raw.launcherTheme.monogram){
        // Filled in now, or once the icons are loaded (applyPackIcons).
        tile.setAttribute('data-pack-icon', raw.id)
        tile.setAttribute('data-pack-mc', raw.minecraftVersion || '')
        // A server with its own logo only needs the icon if that fails.
        applyPackIcon(tile, !logo)
    }
    tile.setAttribute('data-icon', logo || '')
    if(logo){
        const show = (url) => {
            // The tile may have been repainted for another server meanwhile.
            if(url == null || tile.getAttribute('data-icon') !== logo) return
            const img = document.createElement('img')
            img.className = prefix + 'Icon'
            img.alt = ''
            img.onload = () => tile.setAttribute('hasIcon', '')
            img.onerror = () => {
                img.remove()
                applyPackIcon(tile, true)
            }
            img.src = url
            tile.appendChild(img)
        }
        const cached = IconCache.peek(logo)
        if(cached !== undefined) show(cached)
        else IconCache.remote(logo).then(show)
    }
}

/**
 * Paint every tile of a pack again, e.g. after its icon was picked.
 *
 * @param {Object} raw The pack's raw server.
 */
function repaintPackTiles(raw){
    const appearance = ConfigManager.getAppearance()
    document.querySelectorAll('[data-pack-id]').forEach(tile => {
        if(tile.getAttribute('data-pack-id') === raw.id){
            paintServerTile(tile, raw, appearance, tile.getAttribute('data-pack-prefix'), tile.hasAttribute('data-own-icon'))
        }
    })
}

/**
 * The packs offered by the dial, the list next to Play and the switch
 * dialog: all but the hidden ones. A hidden pack stays selected (Play still
 * launches it), it just isn't offered.
 *
 * @param {Object} distro The distribution.
 * @returns {Array.<Object>} The servers to offer.
 */
function pickerServers(distro){
    if(distro == null) return []
    return distro.servers.filter(s => !ConfigManager.isPackHidden(s.rawServer.id))
}

/**
 * Swap a tile's monogram for its Minecraft icon, if the icons are loaded.
 *
 * @param {HTMLElement} tile A tile marked with data-pack-icon.
 * @param {boolean} load Load the icons if they aren't yet.
 */
function applyPackIcon(tile, load = false){
    const id = tile.getAttribute('data-pack-icon')
    const icon = id != null ? PackIcons.iconFor(id) : null
    const mono = tile.firstElementChild
    if(icon == null){
        // Only a tile that shows the icon is worth downloading a client for.
        if(id != null && load) PackIcons.load(tile.getAttribute('data-pack-mc')).then(ok => { if(ok) applyPackIcons() })
        return
    }
    if(mono == null){
        return
    }
    tile.style.backgroundImage = icon.background
    mono.textContent = ''
    mono.classList.add('serverGlyph')
    // The user's own picture fills the tile; item icons sit inside it.
    mono.classList.toggle('serverGlyphFull', icon.full)
    Object.assign(mono.style, { backgroundImage: icon.image, backgroundSize: icon.size, backgroundPosition: icon.position })
}

function applyPackIcons(){
    document.querySelectorAll('[data-pack-icon]').forEach(tile => applyPackIcon(tile))
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
    // Local modpacks have no server to ask.
    await Promise.all(distro.servers.filter(s => !LocalPacks.isLocal(s.rawServer)).map(async s => {
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
        if(row.hasAttribute('local')){
            cell.removeAttribute('state')
            cell.textContent = ''
        } else if(p === undefined){
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
    const servers = pickerServers(distro)
    const selId = ConfigManager.getSelectedServer()
    // -1 when the selected pack is hidden: then no tile or row is marked.
    const selIndex = selId != null ? servers.findIndex(s => s.rawServer.id === selId) : -1
    const sel = Math.max(0, selIndex)
    const appearance = ConfigManager.getAppearance()
    const tiles = document.getElementById('serverDialTiles')
    const landing = document.getElementById('landingContainer')

    landing.toggleAttribute('dialHidden', appearance.serverPicker === 'dropdown' || servers.length === 0)

    // Server list next to Play. Rebuilt when the servers or the theme change.
    const menuList = document.getElementById('serverMenuList')
    const themeKey = appearance.theme
    const listKey = servers.map(s => s.rawServer.id + ':' + (PackIcons.isPicked(s.rawServer.id) ? '' : s.rawServer.icon)).join('|') + '#' + themeKey
    if(menuList.getAttribute('data-key') !== listKey){
        menuList.innerHTML = ''
        servers.forEach((s, i) => {
            const row = document.createElement('div')
            row.className = 'serverListRow'
            row.setAttribute('role', 'option')
            row.setAttribute('data-id', s.rawServer.id)
            row.toggleAttribute('local', LocalPacks.isLocal(s.rawServer))
            row.innerHTML = '<span class="serverListTile"></span>'
                + '<span class="serverListText"><span class="serverListName"></span><span class="serverListMeta"></span></span>'
                + '<span class="serverListRunning"></span>'
                + '<span class="serverListStatus"></span>'
            paintServerTile(row.firstChild, s.rawServer, appearance, 'serverListTile')
            row.querySelector('.serverListName').textContent = s.rawServer.name
            row.querySelector('.serverListMeta').textContent = getServerMetaLabel(s)
            row.querySelector('.serverListRunning').textContent = Lang.queryJS('landing.running.badge')
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
        row.toggleAttribute('selected', i === selIndex)
        row.setAttribute('aria-selected', i === selIndex)
    })

    const curServ = selId != null && distro != null ? distro.getServerById(selId) : null
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
    const rebuilt = tiles.getAttribute('data-key') !== tileKey
    if(rebuilt){
        tiles.innerHTML = ''
        servers.forEach((s, i) => {
            const raw = s.rawServer
            const tile = document.createElement('button')
            tile.className = 'serverTile'
            tile.tabIndex = -1
            tile.setAttribute('role', 'option')
            tile.setAttribute('aria-label', raw.name)
            tile.setAttribute('data-id', raw.id)
            paintServerTile(tile, raw, appearance, 'serverTile')
            tile.onclick = () => selectServerAt(i)
            tiles.appendChild(tile)
        })
        tiles.setAttribute('data-key', tileKey)
    }

    // New tiles are placed at once; otherwise the dial turns to the server.
    turnServerDial(sel, rebuilt)
    Array.from(tiles.children).forEach((tile, i) => {
        const d = i - sel
        const ad = Math.abs(d)
        tile.toggleAttribute('selected', i === selIndex)
        tile.toggleAttribute('far', ad > 2)
        tile.toggleAttribute('edge', ad === 2)
        tile.setAttribute('aria-selected', i === selIndex)
    })

    const cur = servers[selIndex]
    document.getElementById('serverDialName').textContent = cur != null ? cur.rawServer.name : ''
    document.getElementById('serverDialPos').textContent = cur != null
        ? Lang.queryJS('landing.serverHero.position', { current: sel + 1, total: servers.length })
        : ''
    document.getElementById('serverDialPrev').disabled = selIndex <= 0
    document.getElementById('serverDialNext').disabled = selIndex >= servers.length - 1
    renderRunningState()
}

/**
 * Select the server at an index in the distribution.
 */
async function selectServerAt(index){
    if(document.getElementById('landingContainer').hasAttribute('launching')){
        return
    }
    const servers = pickerServers(await DistroAPI.getDistribution())
    const next = servers[Math.max(0, Math.min(servers.length - 1, index))]
    if(next == null || next.rawServer.id === ConfigManager.getSelectedServer()){
        return
    }
    updateSelectedServer(next)
    refreshServerStatus(true)
}

async function stepServer(delta){
    const servers = pickerServers(await DistroAPI.getDistribution())
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
    updateServerMenuFade()
}

/**
 * Fade the list's top or bottom edge while there is more to scroll that way.
 */
function updateServerMenuFade(){
    const list = document.getElementById('serverMenuList')
    list.toggleAttribute('fadeTop', list.scrollTop > 1)
    list.toggleAttribute('fadeBottom', list.scrollTop + list.clientHeight < list.scrollHeight - 1)
}
document.getElementById('serverMenuList').addEventListener('scroll', updateServerMenuFade, { passive: true })

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

/**
 * Stable 0..1 value from a string, used to vary the shade of letter tiles
 * (mods and packs in settings).
 */
function modShade(str){
    let h = 0
    for(let i = 0; i < str.length; i++){
        h = (h * 31 + str.charCodeAt(i)) | 0
    }
    return (Math.abs(h) % 1000) / 1000
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

    // Local modpacks have no server, so there is no status to show.
    const local = serv != null && LocalPacks.isLocal(serv.rawServer)
    document.getElementById('statusCard').hidden = local
    if(local){
        return
    }

    let players = null

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        players = { online: servStat.players.online, max: servStat.players.max }
        serverPlayers.set(serv.rawServer.id, players)

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
        if(serv != null) serverPlayers.set(serv.rawServer.id, null)
    }
    const online = players != null
    // Offline, or the player count while the server answers.
    const pVal = online
        ? Lang.queryJS('landing.serverStatus.playerCount', players)
        : Lang.queryJS('landing.serverStatus.offline')
    renderServerMenuStatus()
    document.getElementById('server_status_wrapper').toggleAttribute('online', online)
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('player_count').textContent = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('player_count').textContent = pVal
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
// "Setting user" is printed by every version, including NeoForge without ModLauncher.
// Before 1.6 it's printed bare, or with FML as "… [INFO] [STDOUT] Setting user: …".
const GAME_LAUNCH_REGEX = /(?:^\[.+\]: |\[STDOUT\] |^)(?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+|Setting user: .+)$/
const MIN_LINGER = 5000
// Versions that print none of the lines above (before 1.6) still free the
// launch area once the game has been up this long.
const MAX_LINGER = 20000

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

    // Mod jars older versions left in mods/ would load twice.
    try {
        await PackCleanup.clean(serv, require('path').join(ConfigManager.getInstanceDirectory(), serv.rawServer.id), loggerLaunchSuite)
    } catch(err) {
        loggerLaunchSuite.warn('Unable to clean up the pack folder.', err)
    }

    // The pack's files now match this version (see Pack updates).
    if(serv.rawServer.version != null){
        ConfigManager.setPackVersion(serv.rawServer.id, serv.rawServer.version)
        ConfigManager.save()
    }
    hidePackUpdateToast()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const versionData = await mojangIndexProcessor.getVersionJson()
    // Null for vanilla packs (see localpacks.js): launch on Mojang's manifest alone.
    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv) || {
        id: versionData.id,
        mainClass: versionData.mainClass,
        arguments: { jvm: [], game: [] },
        minecraftArguments: versionData.minecraftArguments
    }

    if(login) {
        // The Minecraft token lasts about a day and is otherwise only checked
        // when the launcher starts; an expired one fails on servers with
        // "Invalid session". Refresh it now, or ask to log in again.
        if(!(await AuthManager.validateSelected())){
            loggerLaunchSuite.warn('The account session expired and could not be refreshed.')
            toggleLaunchArea(false)
            validateSelectedAccount()
            return
        }
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        let loadComplete = false
        const onLoadComplete = () => {
            if(loadComplete){
                return
            }
            loadComplete = true
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            clearTimeout(lingerTimer)
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()
        let lingerTimer = null

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff. Output arrives in chunks of several
        // lines, the last one possibly cut off.
        let pending = ''
        const tempListener = function(data){
            const lines = (pending + data).split('\n')
            pending = lines.pop()
            if(lines.some(line => GAME_LAUNCH_REGEX.test(line.trim()))){
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

        // Start the game in the launcher's language.
        const langConf = ConfigManager.getLanguage()
        if(langConf.minecraft){
            try {
                DropinModUtil.setGameLanguage(pb.gameDir, Lang.minecraftCode(Lang.resolve(langConf), serv.rawServer.minecraftVersion))
            } catch(err) {
                loggerLaunchSuite.warn('Unable to set the game language.', err)
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()
            trackRunningServer(serv.rawServer.id, proc)
            // The game quit (or crashed) before it finished loading.
            proc.on('close', () => {
                if(!loadComplete){
                    loggerLaunchSuite.warn('Game exited before it finished loading.')
                    onLoadComplete()
                }
            })

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)
            lingerTimer = setTimeout(onLoadComplete, MAX_LINGER)

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
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString(Lang.getCurrent().tag, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

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
