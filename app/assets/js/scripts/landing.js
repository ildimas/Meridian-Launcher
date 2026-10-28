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
const PackFolders             = require('./assets/js/packfolders')
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
    for(const row of serverMenuRows()){
        row.toggleAttribute('running', isServerRunning(row.getAttribute('data-id')))
        row.toggleAttribute('update', packUpdateFor(row.getAttribute('data-id')) != null)
    }
    for(const tile of document.getElementById('serverDialTiles').children){
        tile.toggleAttribute('running', isServerRunning(tile.getAttribute('data-id')))
        tile.toggleAttribute('update', packUpdateFor(tile.getAttribute('data-id')) != null)
    }
}

/* Pack updates */

// The stamp next to distribution.json (published by Meridian Studio, a few
// bytes) is checked this often, and when the window comes back after at least
// focusGap; distribution.json itself is fetched only when the stamp changed.
// Without a stamp, distribution.json is fetched every fullEvery, and with one
// at least every stampFullEvery, in case it was uploaded without a new stamp
// (by hand, or by an older studio). The notice hides itself after toastMs.
const PACK_UPDATE = { every: 60 * 1000, focusGap: 15 * 1000, fullEvery: 10 * 60 * 1000, stampFullEvery: 30 * 60 * 1000, toastMs: 15000, timeout: 10000 }
// The stamp's MD5 for the distribution loaded now, or null before the first
// stamp was seen.
let packStampMd5 = null
let packDistroFetchedAt = Date.now()
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
 * The stamp published next to distribution.json: { md5, servers: { id: version } },
 * or null when there is none (an older publish, or another host).
 */
async function fetchPackStamp(){
    const url = DistroAPI.remoteUrl
    if(typeof url !== 'string' || !url.endsWith('distribution.json')) return null
    const stampUrl = url.replace(/[^/]*$/, name => 'stamp.' + name)
    try {
        const res = await fetch(stampUrl, { cache: 'no-store', signal: AbortSignal.timeout(PACK_UPDATE.timeout) })
        if(!res.ok) return null
        const stamp = await res.json()
        return stamp != null && typeof stamp.md5 === 'string' && stamp.servers != null ? stamp : null
    } catch {
        return null
    }
}

/**
 * Whether the stamp's servers and versions are the ones loaded now.
 */
function packStampMatches(stamp){
    const loaded = (DistroAPI.rawDistribution.servers || []).filter(raw => !LocalPacks.isLocal(raw))
    const ids = Object.keys(stamp.servers)
    return loaded.length === ids.length
        && loaded.every(raw => raw.id in stamp.servers && stamp.servers[raw.id] === (raw.version == null ? null : String(raw.version)))
}

/**
 * Whether distribution.json has to be fetched again. The first stamp is
 * compared with what is loaded, so starting the launcher doesn't download it
 * twice; after that any new stamp means a new publish.
 */
async function packDistroChanged(){
    const stamp = await fetchPackStamp()
    if(stamp == null){
        return Date.now() - packDistroFetchedAt >= PACK_UPDATE.fullEvery ? {} : null
    }
    if(packStampMd5 == null && packStampMatches(stamp)){
        packStampMd5 = stamp.md5
    }
    return stamp.md5 !== packStampMd5 || Date.now() - packDistroFetchedAt >= PACK_UPDATE.stampFullEvery ? stamp : null
}

/**
 * Fetch distribution.json again when it changed and show what changed.
 * Skipped while a game is launching or running, and away from the landing
 * view, so nothing is swapped under the player's feet.
 */
async function checkPackUpdates(){
    if(packUpdateChecking || DistroAPI.distribution == null) return
    if(getCurrentView() !== VIEWS.landing || launcherBusy()) return
    packUpdateChecking = true
    packUpdateCheckedAt = Date.now()
    try {
        const stamp = await packDistroChanged()
        if(stamp == null) return
        packDistroFetchedAt = Date.now()
        const before = JSON.stringify(DistroAPI.rawDistribution)
        const distro = await DistroAPI.refreshDistributionOrFallback()
        // A failed fetch keeps the old distribution: the stamp won't match it,
        // and the next check tries again.
        if(stamp.md5 != null) packStampMd5 = packStampMatches(stamp) ? stamp.md5 : null
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
    // News can be for one pack only.
    renderNews()
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
    const bounds = document.getElementById('serverDial').getBoundingClientRect()
    const controls = ['heroBlock', 'launchArea'].map(id => document.getElementById(id).getBoundingClientRect())
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
        const rect = { left: bounds.left + x - size / 2, right: bounds.left + x + size / 2, top: bounds.top + y - size / 2, bottom: bounds.top + y + size / 2 }
        const covered = ad > 0.1 && controls.some(c => rect.left < c.right + 6 && rect.right > c.left - 6 && rect.top < c.bottom + 6 && rect.bottom > c.top - 6)
        tile.style.visibility = opacity > 0 && !covered ? '' : 'hidden'
    })
    placeDialFolderBoundaries(pos)
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
 * Group every pack without changing its distribution data. Folder visibility
 * applies only to the dial; per-pack hiding applies to every picker.
 */
function readPackFolders(distribution = DistroAPI.rawDistribution){
    return PackFolders.read(ConfigManager.getLauncherDirectory(), distribution)
}

function pickerGroups(distro){
    const state = readPackFolders(distro?.rawDistribution)
    return PackFolders.groups(state, distro?.servers || [])
}

function packFolderName(folder){
    return folder.unassigned ? Lang.queryJS('settings.folders.unassigned') : folder.name
}

function pickerServers(distro, dial = false){
    const groups = pickerGroups(distro).filter(f => !dial || f.visible)
    return groups.flatMap(f => f.servers).filter(s => !ConfigManager.isPackHidden(s.rawServer.id))
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
    for(const row of serverMenuRows()){
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
    const servers = pickerServers(distro, true)
    const menuServers = pickerServers(distro)
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
    const folders = pickerGroups(distro)
    const folderFor = s => folders.find(f => f.servers.includes(s))
    const listKey = menuServers.map(s => s.rawServer.id + ':' + (PackIcons.isPicked(s.rawServer.id) ? '' : s.rawServer.icon)).join('|') + '#' + themeKey + JSON.stringify(folders.map(f => [f.id, f.name, f.servers.map(s => s.rawServer.id)]))
    if(menuList.getAttribute('data-key') !== listKey){
        menuList.innerHTML = ''
        for(const folder of folders){
            const members = folder.servers.filter(s => !ConfigManager.isPackHidden(s.rawServer.id))
            if(members.length === 0) continue
            const group = document.createElement('div')
            group.className = 'serverMenuFolder'
            group.setAttribute('role', 'group')
            group.setAttribute('aria-label', packFolderName(folder))
            if(!folder.unassigned){
                const heading = document.createElement('div')
                heading.className = 'serverMenuFolderHeading'
                heading.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v12H3z"/></svg><span class="serverMenuFolderName"></span>'
                heading.querySelector('.serverMenuFolderName').textContent = packFolderName(folder)
                heading.querySelector('.serverMenuFolderName').title = packFolderName(folder)
                group.appendChild(heading)
            }
            members.forEach(s => {
                const i = menuServers.indexOf(s)
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
                    selectServerAt(i, false)
                }
                row.onmousemove = () => setServerMenuActive(i)
                group.appendChild(row)
            })
            menuList.appendChild(group)
        }
        menuList.setAttribute('data-key', listKey)
        renderServerMenuStatus()
    }
    Array.from(serverMenuRows()).forEach((row, i) => {
        const selected = menuServers[i].rawServer.id === selId
        row.toggleAttribute('selected', selected)
        row.setAttribute('aria-selected', selected)
    })

    const curServ = selId != null && distro != null ? distro.getServerById(selId) : null
    const pickerTile = document.getElementById('serverPickerTile')
    if(curServ != null){
        if(pickerTile.getAttribute('data-key') !== curServ.rawServer.id + '#' + themeKey){
            paintServerTile(pickerTile, curServ.rawServer, appearance, 'serverListTile')
            pickerTile.setAttribute('data-key', curServ.rawServer.id + '#' + themeKey)
        }
        document.getElementById('serverPickerName').textContent = curServ.rawServer.name
        document.getElementById('serverPickerMeta').textContent = getServerMetaLabel(curServ) + (folderFor(curServ).unassigned ? '' : ' · ' + packFolderName(folderFor(curServ)))
    } else {
        pickerTile.removeAttribute('data-key')
        pickerTile.innerHTML = ''
        pickerTile.style.backgroundImage = ''
        document.getElementById('serverPickerName').textContent = Lang.queryJS('landing.selectedServer.noSelection')
        document.getElementById('serverPickerMeta').textContent = ''
    }
    pickerTile.toggleAttribute('empty', curServ == null)
    server_select.toggleAttribute('empty', menuServers.length === 0)

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

    renderDialFolderBoundaries(distro, servers)

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
    const currentFolder = cur != null ? folderFor(cur) : null
    const folderServers = currentFolder != null ? currentFolder.servers.filter(s => !ConfigManager.isPackHidden(s.rawServer.id)) : []
    document.getElementById('serverDialName').textContent = cur != null ? cur.rawServer.name : ''
    document.getElementById('serverDialPos').textContent = cur != null
        ? Lang.queryJS('landing.serverHero.position', { current: folderServers.indexOf(cur) + 1, total: folderServers.length }) + (currentFolder.unassigned ? '' : ' · ' + packFolderName(currentFolder))
        : ''
    document.getElementById('serverDialPos').title = document.getElementById('serverDialPos').textContent
    document.getElementById('serverDialPrev').disabled = selIndex <= 0
    document.getElementById('serverDialNext').disabled = servers.length === 0 || selIndex >= servers.length - 1
    renderRunningState()
}

/**
 * Select the server at an index in the distribution.
 */
async function selectServerAt(index, dial = true){
    if(document.getElementById('landingContainer').hasAttribute('launching')){
        return
    }
    const servers = pickerServers(await DistroAPI.getDistribution(), dial)
    const next = servers[Math.max(0, Math.min(servers.length - 1, index))]
    if(next == null || next.rawServer.id === ConfigManager.getSelectedServer()){
        return
    }
    updateSelectedServer(next)
    refreshServerStatus(true)
}


// Folder boundaries follow the arc; folder names stay in the bottom caption.
function renderDialFolderBoundaries(distro, servers){
    const lines = document.getElementById('serverDialBoundaries')
    lines.replaceChildren()
    for(const folder of pickerGroups(distro).filter(f => f.visible)){
        const index = servers.findIndex(s => folder.servers.includes(s))
        if(index <= 0) continue
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.dataset.index = index
        lines.appendChild(line)
    }
}

function placeDialFolderBoundaries(pos){
    for(const line of document.getElementById('serverDialBoundaries').children){
        const d = Number(line.dataset.index) - pos - 0.5
        line.style.display = Math.abs(d) > 2.4 ? 'none' : ''
        const angle = d * SERVER_DIAL.step * Math.PI / 180
        for(const [key, value] of Object.entries({ x1: SERVER_DIAL.cx + 278 * Math.sin(angle), y1: SERVER_DIAL.cy - 278 * Math.cos(angle), x2: SERVER_DIAL.cx + 325 * Math.sin(angle), y2: SERVER_DIAL.cy - 325 * Math.cos(angle) })){
            line.setAttribute(key, value)
        }
    }
}

function openPackFolders(){
    if(document.getElementById('landingContainer').hasAttribute('launching')) return
    switchView(getCurrentView(), VIEWS.settings, 500, 500, async () => {
        await prepareSettings()
        document.querySelector('.settingsNavItem[rSc="settingsTabFolders"]').click()
        document.getElementById('mpFolderName').focus()
    })
}
document.getElementById('managePackFolders').onclick = openPackFolders

async function stepServer(delta){
    const servers = pickerServers(await DistroAPI.getDistribution(), true)
    const cur = servers.findIndex(s => s.rawServer.id === ConfigManager.getSelectedServer())
    selectServerAt(cur + delta)
}

/* Server list popover. */
const serverPicker = document.getElementById('serverPicker')
const serverMenu = document.getElementById('serverMenu')
let serverMenuActive = -1

// Only selectable pack rows participate in status updates and keyboard navigation.
function serverMenuRows(){
    return document.querySelectorAll('#serverMenuList .serverListRow')
}

function setServerMenuActive(index){
    const rows = serverMenuRows()
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
    const rows = Array.from(serverMenuRows())
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
        const row = serverMenuRows()[serverMenuActive]
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

/**
 * Whether something between the element and the landing page scrolls by
 * itself in that direction, such as the pack menu or the news.
 *
 * @param {Element} el Where the wheel turned.
 * @param {number} dy The wheel's vertical delta.
 */
function wheelScrollsInside(el, dy){
    const landing = document.getElementById('landingContainer')
    for(; el != null && el !== landing; el = el.parentElement){
        const overflow = getComputedStyle(el).overflowY
        if((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight){
            const atEnd = dy > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0
            if(!atEnd) return true
        }
    }
    return false
}

// The wheel turns the dial wherever the mouse is on the landing page, one
// step per 280ms however fast the wheel or trackpad reports.
document.getElementById('landingContainer').addEventListener('wheel', e => {
    const landing = document.getElementById('landingContainer')
    if(landing.hasAttribute('dialHidden') || landing.hasAttribute('launching') || wheelScrollsInside(e.target, e.deltaY)){
        return
    }
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

/**
 * The failure text for a file check or download error: the download process's
 * summary, a hint, and its details (url, file, HTTP status, stack; see
 * downloadchild.js) in a block the player can select and copy.
 *
 * @param {string} [displayable] The download process's report.
 * @param {string} [hint] Trusted HTML shown under the summary.
 * @returns {string} HTML for the overlay.
 */
function downloadFailureDesc(displayable, hint){
    if(!displayable){
        return Lang.queryJS('landing.dlAsync.seeConsoleForDetails')
    }
    const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const [summary, ...details] = displayable.split('\n')
    let desc = escape(summary)
    if(hint){
        desc += '<br><br>' + hint
    }
    if(details.length > 0){
        desc += `<pre class="launchErrorDetails">${escape(details.join('\n'))}</pre>`
    }
    return desc
}

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

    // The process exits right after reporting an error; keep that report on screen.
    let failureShown = false
    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        failureShown = true
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}${signal ? ` (${signal})` : ''}, assuming error.`)
            // Let a pending error report land first.
            setTimeout(() => {
                if(!failureShown){
                    showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
                }
            }, 500)
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
        loggerLaunchSuite.error('Error during file validation.', err.displayable || err)
        failureShown = true
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), downloadFailureDesc(err.displayable))
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
            loggerLaunchSuite.error('Error during file download.', err.displayable || err)
            failureShown = true
            // A stalled download is almost always the network, not the pack.
            const hint = /timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(err.displayable || '')
                ? Lang.queryJS('landing.dlAsync.downloadTimedOutHint') : null
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), downloadFailureDesc(err.displayable, hint))
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
 * News: the feed Meridian Studio publishes as news.json, linked from
 * distribution.json (`news`). The index is small and asked for again on every
 * distro refresh, which costs a 304 when nothing changed. An article's text
 * and pictures load only when it is opened, from files named by their
 * content and cached for good: Chromium's own bounded cache keeps them, so a
 * player downloads each once, and years of news never pile up on disk. The
 * config keeps just the date of the newest article seen.
 */

const { marked }                    = require('marked')
const DOMPurify                     = require('dompurify')

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsList                      = document.getElementById('newsList')
const newsArticleView               = document.getElementById('newsArticleView')
const newsArticleScroll             = document.getElementById('newsArticleScroll')
const newsArticle                   = document.getElementById('newsArticle')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// Never more than this many articles, whatever the feed holds.
const NEWS_MAX = 50
const NEWS_TIMEOUT = 10000
// On the first run, only articles this recent count as unread.
const NEWS_FRESH = 14 * 24 * 3600 * 1000

// The loaded feed: { url, articles }, null when it failed to load, undefined
// before the first load.
let newsFeed
// Unread before the drawer was opened, so the badges stay while it is open.
let newsSeenShown = null
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
        closeNewsArticle()
        // Badges for what was unread go once the drawer has been seen.
        newsSeenShown = null
        renderNews()
    } else {
        $('#newsContainer, #newsContainer *').removeAttr('tabindex')
        newsSeenShown = newsSeen()
        markNewsSeen()
    }
    slide_(!newsActive)
    newsActive = !newsActive
    document.getElementById('newsButton').setAttribute('aria-pressed', newsActive)
}
document.getElementById('newsClose').onclick = () => {
    document.getElementById('newsButton').click()
}
document.getElementById('newsBack').onclick = () => {
    closeNewsArticle()
}

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(newsLoadingListener != null){
        clearInterval(newsLoadingListener)
        newsLoadingListener = null
    }
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
    }
}

/**
 * Show one of the drawer's states.
 * 
 * @param {'loading'|'failed'|'none'|'list'} state
 */
function setNewsState(state){
    setNewsLoading(state === 'loading')
    $('#newsErrorContainer').toggle(state !== 'list')
    $('#newsErrorLoading').toggle(state === 'loading')
    $('#newsErrorFailed').toggle(state === 'failed')
    $('#newsErrorNone').toggle(state === 'none')
    $(newsContent).toggle(state === 'list')
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    initNews()
}

/**
 * Date of the newest article the player has seen, in ms, or null.
 */
function newsSeen(){
    const cache = ConfigManager.getNewsCache()
    return cache != null && Number.isFinite(cache.seen) ? cache.seen : null
}

function isNewsUnread(article, seen){
    return article.time > (seen ?? Date.now() - NEWS_FRESH)
}

/**
 * Articles for the selected pack: those for everyone and those for it.
 * Pinned first, then newest first.
 */
function visibleNews(){
    if(newsFeed == null) return []
    const server = ConfigManager.getSelectedServer()
    return newsFeed.articles
        .filter(a => a.servers == null || a.servers.includes(server))
        .sort((a, b) => (b.pinned - a.pinned) || (b.time - a.time))
}

function markNewsSeen(){
    const newest = visibleNews().reduce((m, a) => Math.max(m, a.time), newsSeen() ?? 0)
    if(newest > 0 && newest !== newsSeen()){
        ConfigManager.setNewsCache({ seen: newest })
        ConfigManager.save()
    }
    $(newsButtonAlert).fadeOut(250)
}

function updateNewsAlert(){
    const seen = newsSeen()
    const unread = !newsActive && visibleNews().some(a => isNewsUnread(a, seen))
    if(unread) $(newsButtonAlert).fadeIn(250)
    else $(newsButtonAlert).hide()
}

function formatNewsDate(time){
    return new Date(time).toLocaleDateString(Lang.getCurrent().tag, { day: 'numeric', month: 'long', year: 'numeric' })
}

// Links in an article resolve against the feed; only web links survive.
let newsBaseUrl = null

function safeNewsUrl(value, base = newsBaseUrl){
    try {
        const url = new URL(value, base || undefined)
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
    } catch {
        return null
    }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if(node.tagName === 'IMG'){
        const src = safeNewsUrl(node.getAttribute('src'))
        if(src == null){
            node.remove()
            return
        }
        node.setAttribute('src', src)
        node.setAttribute('loading', 'lazy')
        node.setAttribute('decoding', 'async')
        node.setAttribute('referrerpolicy', 'no-referrer')
    } else if(node.tagName === 'A'){
        const href = safeNewsUrl(node.getAttribute('href'))
        if(href == null) node.removeAttribute('href')
        else node.setAttribute('href', href)
    }
})

/**
 * Markdown from the feed as safe HTML: no scripts, handlers, styles, frames or
 * forms; the window runs with Node in it.
 */
function renderNewsMarkdown(md){
    return DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true }), {
        FORBID_TAGS: ['style', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source', 'svg', 'math'],
        FORBID_ATTR: ['style', 'srcset']
    })
}

/**
 * Build the cards for the selected pack.
 */
function renderNews(){
    if(newsFeed === undefined) return
    if(newsFeed == null){
        setNewsState('failed')
        return
    }
    const list = visibleNews()
    updateNewsAlert()
    if(list.length === 0){
        setNewsState('none')
        return
    }
    const seen = newsActive ? newsSeenShown : newsSeen()
    newsList.replaceChildren(...list.map(a => {
        const card = document.createElement('button')
        card.className = 'newsCard'
        if(!newsActive) card.setAttribute('tabindex', '-1')
        if(a.cover){
            const img = document.createElement('img')
            img.className = 'newsCardCover'
            img.src = a.cover
            img.alt = ''
            img.loading = 'lazy'
            img.decoding = 'async'
            img.referrerPolicy = 'no-referrer'
            card.appendChild(img)
        }
        const body = document.createElement('div')
        body.className = 'newsCardBody'
        const meta = document.createElement('div')
        meta.className = 'newsCardMeta'
        if(a.pinned){
            const pin = document.createElement('span')
            pin.className = 'newsBadge pinned'
            pin.textContent = Lang.queryJS('landing.news.pinned')
            meta.appendChild(pin)
        }
        if(isNewsUnread(a, seen)){
            const badge = document.createElement('span')
            badge.className = 'newsBadge'
            badge.textContent = Lang.queryJS('landing.news.new')
            meta.appendChild(badge)
        }
        const date = document.createElement('span')
        date.textContent = formatNewsDate(a.time) + (a.author ? ' · ' + a.author : '')
        meta.appendChild(date)
        const title = document.createElement('span')
        title.className = 'newsCardTitle'
        title.textContent = a.title
        body.append(meta, title)
        if(a.summary){
            const summary = document.createElement('span')
            summary.className = 'newsCardSummary'
            summary.textContent = a.summary
            body.appendChild(summary)
        }
        card.appendChild(body)
        card.onclick = () => openNewsArticle(a)
        return card
    }))
    setNewsState('list')
}

// The article on screen, so a body that arrives late doesn't land in another.
let newsOpen = null

/**
 * An article's Markdown. The body's link changes with its text, so the
 * browser cache answers without asking the server again.
 */
async function loadNewsBody(a){
    const res = await fetch(a.body, { signal: AbortSignal.timeout(NEWS_TIMEOUT) })
    if(!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if(typeof data.content !== 'string') throw new Error('No content.')
    return data.content
}

/**
 * Show one article in place of the list.
 */
async function openNewsArticle(a){
    newsOpen = a
    newsBaseUrl = a.body
    newsArticle.replaceChildren()
    if(a.cover){
        const img = document.createElement('img')
        img.className = 'newsArticleCover'
        img.src = a.cover
        img.alt = ''
        img.referrerPolicy = 'no-referrer'
        newsArticle.appendChild(img)
    }
    const title = document.createElement('h2')
    title.textContent = a.title
    const meta = document.createElement('div')
    meta.className = 'newsArticleMeta'
    meta.textContent = formatNewsDate(a.time) + (a.author ? ' · ' + a.author : '')
    const body = document.createElement('div')
    body.className = 'newsArticleBody'
    body.setAttribute('loading', '')
    body.textContent = Lang.queryJS('landing.news.loadingArticle')
    newsArticle.append(title, meta, body)
    newsList.style.display = 'none'
    newsArticleView.style.display = ''
    newsArticleScroll.scrollTop = 0
    document.getElementById('newsBack').focus({ focusVisible: false })

    try {
        const content = await loadNewsBody(a)
        if(newsOpen !== a) return
        body.removeAttribute('loading')
        body.innerHTML = renderNewsMarkdown(content)
    } catch(err) {
        if(newsOpen !== a) return
        loggerLanding.warn('Unable to load the article.', err)
        // A changed article has a new link: the index may be out of date.
        body.textContent = Lang.queryJS('landing.news.articleFailed')
        const retry = document.createElement('button')
        retry.className = 'newsArticleRetry'
        retry.textContent = Lang.queryJS('landing.news.retry')
        retry.onclick = () => initNews()
        body.appendChild(retry)
    }
}

/**
 * Back to the list. The article's pictures go with it.
 */
function closeNewsArticle(){
    if(newsArticleView.style.display === 'none') return
    newsOpen = null
    newsArticle.replaceChildren()
    newsArticleView.style.display = 'none'
    newsList.style.display = ''
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading.
 */
async function initNews(){
    if(newsFeed == null) setNewsState('loading')
    const feed = await loadNews()
    // A failed refresh keeps what was loaded before.
    if(feed != null || newsFeed == null) newsFeed = feed
    closeNewsArticle()
    renderNews()
}

/**
 * Add keyboard controls to the news UI. Escape leaves an article, then closes
 * the drawer. If you are on the landing page, the up arrow opens it.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'Escape'){
            if(newsArticleView.style.display !== 'none') closeNewsArticle()
            else document.getElementById('newsButton').click()
        }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Load the feed linked from the distribution index.
 * 
 * @returns {Promise.<{url: string, articles: Array.<Object>}|null>} The feed,
 * with no articles when the distribution links none; null if it failed.
 */
async function loadNews(){
    try {
        const distroData = await DistroAPI.getDistribution()
        const url = distroData.rawDistribution.news
        if(!url){
            loggerLanding.debug('No news feed provided.')
            return { url: null, articles: [] }
        }
        const res = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(NEWS_TIMEOUT) })
        if(!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const str = (v) => typeof v === 'string' ? v : ''
        const articles = (Array.isArray(data.articles) ? data.articles : [])
            .map(a => ({
                id: str(a.id),
                title: str(a.title).trim(),
                summary: str(a.summary),
                author: str(a.author),
                time: new Date(a.date).getTime(),
                cover: a.cover ? safeNewsUrl(a.cover, url) : null,
                body: a.body ? safeNewsUrl(a.body, url) : null,
                servers: Array.isArray(a.servers) && a.servers.length > 0 ? a.servers.map(String) : null,
                pinned: a.pinned === true
            }))
            .filter(a => a.title && Number.isFinite(a.time) && a.body)
            .slice(0, NEWS_MAX)
        return { url, articles }
    } catch(err) {
        loggerLanding.warn('Unable to load the news.', err)
        return null
    }
}

window.addEventListener('resize', () => { if(serverDialTurn.pos != null) placeServerDial(serverDialTurn.pos) })

new ResizeObserver(() => { if(serverDialTurn.pos != null && serverDial.getBoundingClientRect().width > 0) placeServerDial(serverDialTurn.pos) }).observe(serverDial)
