/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Requirements
const path          = require('path')
const { Type }      = require('helios-distribution-types')

const AuthManager   = require('./assets/js/authmanager')
const ConfigManager = require('./assets/js/configmanager')
const { DistroAPI } = require('./assets/js/distromanager')
const ProxyManager  = require('./assets/js/proxymanager')
const ThemeEngine   = require('./assets/js/themeengine')
const IconCache     = require('./assets/js/iconcache')

let rscShouldLoad = false
let fatalStartupError = false

// Mapping of each view to their container IDs.
const VIEWS = {
    landing: '#landingContainer',
    loginOptions: '#loginOptionsContainer',
    login: '#loginContainer',
    settings: '#settingsContainer',
    welcome: '#welcomeContainer',
    waiting: '#waitingContainer'
}

// The currently shown view container.
let currentView

// Mount the wallpaper as soon as the page exists; config is loaded by the preloader.
document.addEventListener('DOMContentLoaded', () => {
    ThemeEngine.init(document.getElementById('wallpaper'))
})

// View transitions run on the compositor (opacity and transform only), so
// work happening on the page at the same time can't make them stutter.
const VIEW_OUT_MS = 180
const VIEW_IN_MS = 360
const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN_QUAD = 'cubic-bezier(0.5, 0, 0.75, 0)'
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Fade an element out and hide it. Resolves once it is hidden.
 *
 * @param {HTMLElement} el The element.
 * @param {number} ms Duration; 0 hides at once.
 * @param {Object} opts `lift` slides it up as it goes, `float` takes it out
 * of the layout while it fades so whatever replaces it can take its place.
 */
async function animateOut(el, ms, { lift = 0, scale = 1, float = false } = {}){
    if(el == null || getComputedStyle(el).display === 'none') return
    el.getAnimations().forEach(a => a.cancel())
    if(ms > 0 && !reduceMotion.matches){
        if(float){
            const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = el
            Object.assign(el.style, {
                position: 'absolute',
                left: offsetLeft + 'px',
                top: offsetTop + 'px',
                width: offsetWidth + 'px',
                height: offsetHeight + 'px',
                pointerEvents: 'none'
            })
        }
        const fade = el.animate([
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: `translateY(${-lift}px) scale(${scale})` }
        ], { duration: ms, easing: EASE_IN_QUAD, fill: 'forwards' })
        const done = await fade.finished.then(() => true, () => false)
        for(const k of ['position', 'left', 'top', 'width', 'height', 'pointerEvents']){
            el.style[k] = ''
        }
        if(!done){
            // Cancelled because it is being shown again; leave it visible.
            return
        }
        fade.cancel()
    }
    el.style.display = 'none'
}

/**
 * Show an element and fade it in.
 *
 * @param {HTMLElement} el The element.
 * @param {number} ms Duration; 0 shows at once.
 * @param {Object} opts `rise` slides it up into place, `scale` grows it to 1,
 * `delay` holds it invisible for a moment first.
 */
async function animateIn(el, ms, { rise = 0, scale = 1, delay = 0 } = {}){
    if(el == null) return
    el.getAnimations().forEach(a => a.cancel())
    el.style.display = ''
    if(getComputedStyle(el).display === 'none'){
        el.style.display = 'block'
    }
    if(ms > 0 && !reduceMotion.matches){
        await el.animate([
            { opacity: 0, transform: `translateY(${rise}px) scale(${scale})` },
            { opacity: 1, transform: 'none' }
        ], { duration: ms, delay, easing: EASE_OUT_EXPO, fill: 'backwards' }).finished.catch(() => {})
    }
}

/**
 * Switch launcher views. The next view starts coming in while the current
 * one is still leaving, so there is never an empty frame in between.
 * 
 * @param {string} current The ID of the current view container. 
 * @param {*} next The ID of the next view container.
 * @param {*} currentFadeTime Optional. The fade out time for the current view.
 * @param {*} nextFadeTime Optional. The fade in time for the next view.
 * @param {*} onCurrentFade Optional. Callback function to execute when the current
 * view fades out.
 * @param {*} onNextFade Optional. Callback function to execute when the next view
 * fades in.
 */
async function switchView(current, next, currentFadeTime = 500, nextFadeTime = 500, onCurrentFade = () => {}, onNextFade = () => {}){
    currentView = next
    const cur = document.querySelector(current)
    const nxt = document.querySelector(next)
    const outMs = Math.min(currentFadeTime, VIEW_OUT_MS)
    const inMs = Math.min(nextFadeTime, VIEW_IN_MS)
    // Settings opens like a sheet over the launcher; everything else crossfades.
    const toSettings = next === VIEWS.settings
    const fromSettings = current === VIEWS.settings
    // The wallpaper blurs itself under settings (see #settingsContainer in launcher.css).
    document.body.toggleAttribute('settingsOpen', toSettings)
    ThemeEngine.setBlurred(toSettings)
    const leaving = animateOut(cur, outMs, { float: true, scale: toSettings ? 0.985 : 1 })
    // Let the outgoing view get a head start, and the caller finish its work.
    await Promise.all([
        new Promise(r => setTimeout(r, outMs * 0.45)),
        Promise.resolve(onCurrentFade())
    ])
    if(currentView !== next){
        // Another switch was asked for meanwhile.
        return
    }
    await animateIn(nxt, inMs, toSettings ? { scale: 1.015 } : fromSettings ? { scale: 0.985 } : { rise: 10 })
    await leaving
    await onNextFade()
}

/**
 * Get the currently shown view container.
 * 
 * @returns {string} The currently shown view container.
 */
function getCurrentView(){
    return currentView
}

async function showMainUI(data){

    if(!isDev){
        loggerAutoUpdater.info('Initializing..')
        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater', ConfigManager.getAllowPrerelease())
    }

    await prepareSettings(true)
    updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    refreshServerStatus()

    const reopen = takeReopenState()
    if(reopen != null){
        await showMainUIAfterReload(reopen)
        initNews().then(() => {
            $('#newsContainer *').attr('tabindex', '-1')
        })
        return
    }

    setTimeout(() => {
        document.getElementById('frameBar').style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
        $('#main').show()

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        if(!isDev && isLoggedIn){
            validateSelectedAccount()
        }

        if(ConfigManager.isFirstLaunch()){
            currentView = VIEWS.welcome
            $(VIEWS.welcome).fadeIn(1000)
        } else {
            if(isLoggedIn){
                currentView = VIEWS.landing
                $(VIEWS.landing).fadeIn(1000)
            } else {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.landing
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                currentView = VIEWS.loginOptions
                $(VIEWS.loginOptions).fadeIn(1000)
            }
        }

        setTimeout(() => {
            $('#loadingContainer').fadeOut(500, () => {
                MeridianSplash.stop()
            })
        }, 250)
        
    }, Math.max(750, MeridianSplash.remaining()))
    // Disable tabbing to the news container.
    initNews().then(() => {
        $('#newsContainer *').attr('tabindex', '-1')
    })
}

/**
 * Where the launcher was before it reloaded to change the language, if it did.
 *
 * @returns {{view: string, tab: string, scroll: number} | null}
 */
function takeReopenState(){
    try {
        const raw = sessionStorage.getItem('meridian.reopen')
        sessionStorage.removeItem('meridian.reopen')
        return raw != null ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

/**
 * Show the launcher where it was before the reload, without the splash.
 */
async function showMainUIAfterReload(state){
    document.getElementById('frameBar').style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
    $('#loadingContainer').hide()
    MeridianSplash.stop()
    $('#main').show()

    const view = Object.values(VIEWS).includes(state.view) ? state.view : VIEWS.landing
    currentView = view
    if(view === VIEWS.settings){
        await prepareSettings()
        document.body.setAttribute('settingsOpen', '')
        ThemeEngine.setBlurred(true)
        const nav = document.querySelector(`.settingsNavItem[rSc="${state.tab}"]`)
        if(nav != null){
            settingsNavItemListener(nav, false)
        }
    }
    const el = document.querySelector(view)
    const shown = animateIn(el, 200)
    const tab = document.getElementById(selectedSettingsTab)
    if(view === VIEWS.settings && tab != null){
        tab.scrollTop = state.scroll || 0
    }
    await shown
}

function showFatalStartupError(){
    setTimeout(() => {
        $('#loadingContainer').fadeOut(250, () => {
            MeridianSplash.stop()
            document.getElementById('overlayContainer').style.background = 'none'
            setOverlayContent(
                Lang.queryJS('uibinder.startup.fatalErrorTitle'),
                Lang.queryJS('uibinder.startup.fatalErrorMessage'),
                Lang.queryJS('uibinder.startup.closeButton')
            )
            setOverlayHandler(() => {
                const window = remote.getCurrentWindow()
                window.close()
            })
            toggleOverlay(true)
        })
    }, 750)
}

/**
 * Common functions to perform after refreshing the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function onDistroRefresh(data){
    updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    refreshServerStatus()
    initNews()
    syncModConfigurations(data)
    ensureJavaSettings(data)
}

/**
 * Sync the mod configurations with the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function syncModConfigurations(data){

    const syncedCfgs = []

    for(let serv of data.servers){

        const id = serv.rawServer.id
        const mdls = serv.modules
        const cfg = ConfigManager.getModConfiguration(id)

        if(cfg != null){

            const modsOld = cfg.mods
            const mods = {}

            for(let mdl of mdls){
                const type = mdl.rawModule.type

                if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                    if(!mdl.getRequired().value){
                        const mdlID = mdl.getVersionlessMavenIdentifier()
                        if(modsOld[mdlID] == null){
                            mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl)
                        } else {
                            mods[mdlID] = mergeModConfiguration(modsOld[mdlID], scanOptionalSubModules(mdl.subModules, mdl), false)
                        }
                    } else {
                        if(mdl.subModules.length > 0){
                            const mdlID = mdl.getVersionlessMavenIdentifier()
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if(typeof v === 'object'){
                                if(modsOld[mdlID] == null){
                                    mods[mdlID] = v
                                } else {
                                    mods[mdlID] = mergeModConfiguration(modsOld[mdlID], v, true)
                                }
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        } else {

            const mods = {}

            for(let mdl of mdls){
                const type = mdl.rawModule.type
                if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                    if(!mdl.getRequired().value){
                        mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                    } else {
                        if(mdl.subModules.length > 0){
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if(typeof v === 'object'){
                                mods[mdl.getVersionlessMavenIdentifier()] = v
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        }
    }

    ConfigManager.setModConfigurations(syncedCfgs)
    ConfigManager.save()
}

/**
 * Ensure java configurations are present for the available servers.
 * 
 * @param {Object} data The distro index object.
 */
function ensureJavaSettings(data) {

    // Nothing too fancy for now.
    for(const serv of data.servers){
        ConfigManager.ensureJavaConfig(serv.rawServer.id, serv.effectiveJavaOptions, serv.rawServer.javaOptions?.ram)
    }

    ConfigManager.save()
}

/**
 * Recursively scan for optional sub modules. If none are found,
 * this function returns a boolean. If optional sub modules do exist,
 * a recursive configuration object is returned.
 * 
 * @returns {boolean | Object} The resolved mod configuration.
 */
function scanOptionalSubModules(mdls, origin){
    if(mdls != null){
        const mods = {}

        for(let mdl of mdls){
            const type = mdl.rawModule.type
            // Optional types.
            if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                // It is optional.
                if(!mdl.getRequired().value){
                    mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                } else {
                    if(mdl.hasSubModules()){
                        const v = scanOptionalSubModules(mdl.subModules, mdl)
                        if(typeof v === 'object'){
                            mods[mdl.getVersionlessMavenIdentifier()] = v
                        }
                    }
                }
            }
        }

        if(Object.keys(mods).length > 0){
            const ret = {
                mods
            }
            if(!origin.getRequired().value){
                ret.value = origin.getRequired().def
            }
            return ret
        }
    }
    return origin.getRequired().def
}

/**
 * Recursively merge an old configuration into a new configuration.
 * 
 * @param {boolean | Object} o The old configuration value.
 * @param {boolean | Object} n The new configuration value.
 * @param {boolean} nReq If the new value is a required mod.
 * 
 * @returns {boolean | Object} The merged configuration.
 */
function mergeModConfiguration(o, n, nReq = false){
    if(typeof o === 'boolean'){
        if(typeof n === 'boolean') return o
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = o
            }
            return n
        }
    } else if(typeof o === 'object'){
        if(typeof n === 'boolean') return typeof o.value !== 'undefined' ? o.value : true
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = typeof o.value !== 'undefined' ? o.value : true
            }

            const newMods = Object.keys(n.mods)
            for(let i=0; i<newMods.length; i++){

                const mod = newMods[i]
                if(o.mods[mod] != null){
                    n.mods[mod] = mergeModConfiguration(o.mods[mod], n.mods[mod])
                }
            }

            return n
        }
    }
    // If for some reason we haven't been able to merge,
    // wipe the old value and use the new one. Just to be safe
    return n
}

async function validateSelectedAccount(){
    const selectedAcc = ConfigManager.getSelectedAccount()
    if(selectedAcc != null){
        const val = await AuthManager.validateSelected()
        if(!val){
            ConfigManager.removeAuthAccount(selectedAcc.uuid)
            ConfigManager.save()
            const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
            setOverlayContent(
                Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                accLen > 0
                    ? Lang.queryJS('uibinder.validateAccount.failedMessage', { 'account': selectedAcc.displayName })
                    : Lang.queryJS('uibinder.validateAccount.failedMessageSelectAnotherAccount', { 'account': selectedAcc.displayName }),
                Lang.queryJS('uibinder.validateAccount.loginButton'),
                Lang.queryJS('uibinder.validateAccount.selectAnotherAccountButton')
            )
            setOverlayHandler(() => {

                const isMicrosoft = selectedAcc.type === 'microsoft'

                if(isMicrosoft) {
                    // Empty for now
                } else {
                    // Mojang
                    // For convenience, pre-populate the username of the account.
                    document.getElementById('loginUsername').value = selectedAcc.username
                    validateEmail(selectedAcc.username)
                }
                
                loginOptionsViewOnLoginSuccess = getCurrentView()
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions

                if(accLen > 0) {
                    loginOptionsViewOnCancel = getCurrentView()
                    loginOptionsViewCancelHandler = () => {
                        if(isMicrosoft) {
                            ConfigManager.addMicrosoftAuthAccount(
                                selectedAcc.uuid,
                                selectedAcc.accessToken,
                                selectedAcc.username,
                                selectedAcc.expiresAt,
                                selectedAcc.microsoft.access_token,
                                selectedAcc.microsoft.refresh_token,
                                selectedAcc.microsoft.expires_at
                            )
                        } else {
                            ConfigManager.addMojangAuthAccount(selectedAcc.uuid, selectedAcc.accessToken, selectedAcc.username, selectedAcc.displayName)
                        }
                        ConfigManager.save()
                        validateSelectedAccount()
                    }
                    loginOptionsCancelEnabled(true)
                } else {
                    loginOptionsCancelEnabled(false)
                }
                toggleOverlay(false)
                switchView(getCurrentView(), VIEWS.loginOptions)
            })
            setDismissHandler(() => {
                if(accLen > 1){
                    prepareAccountSelectionList()
                    $('#overlayContent').fadeOut(250, () => {
                        bindOverlayKeys(true, 'accountSelectContent', true)
                        $('#accountSelectContent').fadeIn(250)
                    })
                } else {
                    const accountsObj = ConfigManager.getAuthAccounts()
                    const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
                    // This function validates the account switch.
                    setSelectedAccount(accounts[0].uuid)
                    toggleOverlay(false)
                }
            })
            toggleOverlay(true, accLen > 0)
        } else {
            return true
        }
    } else {
        return true
    }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 * 
 * @param {string} uuid The UUID of the account.
 */
function setSelectedAccount(uuid){
    const authAcc = ConfigManager.setSelectedAccount(uuid)
    ConfigManager.save()
    updateSelectedAccount(authAcc)
    validateSelectedAccount()
}

// Synchronous Listener
document.addEventListener('readystatechange', async () => {

    if (document.readyState === 'interactive' || document.readyState === 'complete'){
        if(rscShouldLoad){
            rscShouldLoad = false
            if(!fatalStartupError){
                const data = await DistroAPI.getDistribution()
                await showMainUI(data)
            } else {
                showFatalStartupError()
            }
        } 
    }

}, false)

// Actions that must be performed after the distribution index is downloaded.
ipcRenderer.on('distributionIndexDone', async (event, res) => {
    if(res) {
        const data = await DistroAPI.getDistribution()
        syncModConfigurations(data)
        ensureJavaSettings(data)
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            await showMainUI(data)
        } else {
            rscShouldLoad = true
        }
    } else {
        fatalStartupError = true
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            showFatalStartupError()
        } else {
            rscShouldLoad = true
        }
    }
})

// Util for development
async function devModeToggle() {
    DistroAPI.toggleDevMode(true)
    const data = await DistroAPI.refreshDistributionOrFallback()
    ensureJavaSettings(data)
    updateSelectedServer(data.servers[0])
    syncModConfigurations(data)
}
