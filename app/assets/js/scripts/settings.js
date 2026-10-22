// Requirements
const os     = require('os')
const semver = require('semver')

const DropinModUtil  = require('./assets/js/dropinmodutil')
const Screenshots    = require('./assets/js/screenshots')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')

const settingsState = {
    invalid: new Set()
}

function bindSettingsSelect(){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]

        selectedDiv.onclick = (e) => {
            e.stopPropagation()
            closeSettingsSelect(e.target)
            e.target.nextElementSibling.toggleAttribute('hidden')
            e.target.classList.toggle('select-arrow-active')
        }
    }
}

function closeSettingsSelect(el){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]
        const optionsDiv = ele.getElementsByClassName('settingsSelectOptions')[0]

        if(!(selectedDiv === el)) {
            selectedDiv.classList.remove('select-arrow-active')
            optionsDiv.setAttribute('hidden', '')
        }
    }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener('click', closeSettingsSelect)

bindSettingsSelect()


function bindFileSelectors(){
    for(let ele of document.getElementsByClassName('settingsFileSelButton')){
        
        ele.onclick = async e => {
            const isJavaExecSel = ele.id === 'settingsJavaExecSel'
            const directoryDialog = ele.hasAttribute('dialogDirectory') && ele.getAttribute('dialogDirectory') == 'true'
            const properties = directoryDialog ? ['openDirectory', 'createDirectory'] : ['openFile']

            const options = {
                properties
            }

            if(ele.hasAttribute('dialogTitle')) {
                options.title = ele.getAttribute('dialogTitle')
            }

            if(isJavaExecSel && process.platform === 'win32') {
                options.filters = [
                    { name: Lang.queryJS('settings.fileSelectors.executables'), extensions: ['exe'] },
                    { name: Lang.queryJS('settings.fileSelectors.allFiles'), extensions: ['*'] }
                ]
            }

            const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), options)
            if(!res.canceled) {
                ele.previousElementSibling.value = res.filePaths[0]
                if(isJavaExecSel) {
                    await populateJavaExecDetails(ele.previousElementSibling.value)
                }
            }
        }
    }
}

bindFileSelectors()


/**
 * General Settings Functions
 */

/**
  * Bind value validators to the settings UI elements. These will
  * validate against the criteria defined in the ConfigManager (if
  * any). If the value is invalid, the UI will reflect this and saving
  * will be disabled until the value is corrected. This is an automated
  * process. More complex UI may need to be bound separately.
  */
function initSettingsValidators(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const vFn = ConfigManager['validate' + v.getAttribute('cValue')]
        if(typeof vFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    v.addEventListener('keyup', (e) => {
                        const v = e.target
                        if(!vFn(v.value)){
                            settingsState.invalid.add(v.id)
                            v.setAttribute('error', '')
                            settingsSaveDisabled(true)
                        } else {
                            if(v.hasAttribute('error')){
                                v.removeAttribute('error')
                                settingsState.invalid.delete(v.id)
                                if(settingsState.invalid.size === 0){
                                    settingsSaveDisabled(false)
                                }
                            }
                        }
                    })
                }
            }
        }

    })
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')

    for(const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const gFn = ConfigManager['get' + cVal]
        const gFnOpts = []
        if(serverDependent) {
            gFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof gFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if(cVal === 'JavaExecutable'){
                        v.value = gFn.apply(null, gFnOpts)
                        await populateJavaExecDetails(v.value)
                    } else if (cVal === 'DataDirectory'){
                        v.value = gFn.apply(null, gFnOpts)
                    } else if(cVal === 'JVMOptions'){
                        v.value = gFn.apply(null, gFnOpts).join(' ')
                    } else {
                        v.value = gFn.apply(null, gFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    v.checked = gFn.apply(null, gFnOpts)
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = gFn.apply(null, gFnOpts)
                        if(val.endsWith('M')){
                            val = Number(val.substring(0, val.length-1))/1024
                        } else {
                            val = Number.parseFloat(val)
                        }

                        v.setAttribute('value', val)
                    } else {
                        v.setAttribute('value', Number.parseFloat(gFn.apply(null, gFnOpts)))
                    }
                }
            }
        }
    }

}

/**
 * Save the settings values.
 */
function saveSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const sFn = ConfigManager['set' + cVal]
        const sFnOpts = []
        if(serverDependent) {
            sFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof sFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if(cVal === 'JVMOptions'){
                        if(!v.value.trim()) {
                            sFnOpts.push([])
                            sFn.apply(null, sFnOpts)
                        } else {
                            sFnOpts.push(v.value.trim().split(/\s+/))
                            sFn.apply(null, sFnOpts)
                        }
                    } else {
                        sFnOpts.push(v.value)
                        sFn.apply(null, sFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    sFnOpts.push(v.checked)
                    sFn.apply(null, sFnOpts)
                    // Special Conditions
                    if(cVal === 'AllowPrerelease'){
                        changeAllowPrerelease(v.checked)
                    }
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = Number(v.getAttribute('value'))
                        if(val%1 > 0){
                            val = val*1024 + 'M'
                        } else {
                            val = val + 'G'
                        }

                        sFnOpts.push(val)
                        sFn.apply(null, sFnOpts)
                    } else {
                        sFnOpts.push(v.getAttribute('value'))
                        sFn.apply(null, sFnOpts)
                    }
                }
            }
        }
    })
}

let selectedSettingsTab = 'settingsTabAccount'

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 * 
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e){
    if(e.target.scrollTop > Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)){
        document.getElementById('settingsContainer').setAttribute('scrolled', '')
    } else {
        document.getElementById('settingsContainer').removeAttribute('scrolled')
    }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs(){
    Array.from(document.getElementsByClassName('settingsNavItem')).map((val) => {
        if(val.hasAttribute('rSc')){
            val.onclick = () => {
                settingsNavItemListener(val)
            }
        }
    })
    const pill = document.createElement('span')
    pill.id = 'settingsNavPill'
    document.getElementById('settingsNavItemsContent').prepend(pill)
    // Settings is hidden while the launcher starts, so place it once it shows.
    new ResizeObserver(() => moveSettingsNavPill(false)).observe(document.getElementById('settingsNavItemsContent'))
}

/**
 * Slide the highlight behind the selected nav item.
 *
 * @param {boolean} animate False to jump straight there.
 */
function moveSettingsNavPill(animate = true){
    const pill = document.getElementById('settingsNavPill')
    const item = document.querySelector('.settingsNavItem[selected]')
    if(pill == null || item == null || item.offsetHeight === 0) return
    pill.toggleAttribute('still', !animate)
    pill.style.height = item.offsetHeight + 'px'
    pill.style.transform = `translateY(${item.offsetTop}px)`
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.
 * 
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = true){
    if(ele.hasAttribute('selected')){
        return
    }
    const navItems = document.getElementsByClassName('settingsNavItem')
    for(let i=0; i<navItems.length; i++){
        if(navItems[i].hasAttribute('selected')){
            navItems[i].removeAttribute('selected')
        }
    }
    ele.setAttribute('selected', '')
    closePackDrawer()
    let prevTab = selectedSettingsTab
    selectedSettingsTab = ele.getAttribute('rSc')

    const prev = document.getElementById(prevTab)
    const next = document.getElementById(selectedSettingsTab)
    prev.onscroll = null
    next.onscroll = settingsTabScrollListener
    moveSettingsNavPill(fade)

    // Hide every other tab too, in case clicks came faster than the fades.
    for(const tab of document.getElementsByClassName('settingsTab')){
        if(tab !== prev && tab !== next){
            tab.getAnimations().forEach(a => a.cancel())
            tab.style.display = 'none'
        }
    }
    next.scrollTop = 0
    // The old tab lifts away while the new one rises into its place.
    animateOut(prev, fade ? 120 : 0, { lift: 6, float: true })
    animateIn(next, fade ? 320 : 0, { rise: 12, delay: 80 })
    settingsTabScrollListener({ target: next })
}

const settingsNavDone = document.getElementById('settingsNavDone')

/**
 * Set if the settings save (done) button is disabled.
 * 
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v){
    settingsNavDone.disabled = v
}

function fullSettingsSave() {
    saveSettingsValues()
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
    saveShaderpackSettings()
    saveResourcepackSettings()
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

// Bind the add mojang account button.
document.getElementById('settingsAddMojangAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnCancel = VIEWS.settings
        loginViewOnSuccess = VIEWS.settings
        loginCancelEnabled(true)
    })
}

// Bind the add offline account button.
document.getElementById('settingsAddOfflineAccount').onclick = () => {
    switchView(getCurrentView(), VIEWS.loginOptions, 500, 500, () => {
        loginOptionsViewOnLoginSuccess = VIEWS.settings
        loginOptionsViewOnLoginCancel = VIEWS.loginOptions
        loginOptionsViewOnCancel = VIEWS.settings
        loginOptionsCancelEnabled(true)
        loginOptionsShowOffline(true)
    })
}

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings)
    })
}

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {

        const viewOnClose = arguments_[2]
        console.log(arguments_)
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {

            if(arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLoginLogger.info('Login cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]

        // Error from request to Microsoft.
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                // TODO Dont know what these errors are. Just show them I guess.
                // This is probably if you messed up the app registration with Azure.      
                let error = queryMap.error // Error might be 'access_denied' ?
                let errorDesc = queryMap.error_description
                console.log('Error getting authCode, is Azure application registered correctly?')
                console.log(error)
                console.log(errorDesc)
                console.log('Full query map: ', queryMap)
                setOverlayContent(
                    error,
                    errorDesc,
                    Lang.queryJS('settings.msftLogin.okButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true)

            })
        } else {

            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')

            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            })
                .catch((displayableError) => {

                    let actualDisplayableError
                    if(isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Uh oh.
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = Lang.queryJS('login.error.unknown')
                    }

                    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                        setOverlayHandler(() => {
                            toggleOverlay(false)
                        })
                        toggleOverlay(true)
                    })
                })
        }
    }
})

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect(){
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if(val.hasAttribute('selected')){
                return
            }
            const selectBtns = document.getElementsByClassName('settingsAuthAccountSelect')
            for(let i=0; i<selectBtns.length; i++){
                if(selectBtns[i].hasAttribute('selected')){
                    selectBtns[i].removeAttribute('selected')
                    selectBtns[i].innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
                }
            }
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut(){
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if(Object.keys(ConfigManager.getAuthAccounts()).length === 1){
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }
            
        }
    })
}

let msAccDomElementCache
/**
 * Process a log out.
 * 
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount){
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    if(targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        const remove = targetAcc.type === 'offline' ? AuthManager.removeOfflineAccount : AuthManager.removeMojangAccount
        remove(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        $(parent).fadeOut(250, () => {
            parent.remove()
        })
    }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {

            if(arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLogoutLogger.info('Logout cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        
        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()

        msftLogoutLogger.info('Logout Successful. uuid:', uuid)
        
        AuthManager.removeMicrosoftAccount(uuid)
            .then(() => {
                if(!isLastAccount && uuid === prevSelAcc.uuid){
                    const selAcc = ConfigManager.getSelectedAccount()
                    refreshAuthAccountSelected(selAcc.uuid)
                    updateSelectedAccount(selAcc)
                    validateSelectedAccount()
                }
                if(isLastAccount) {
                    loginOptionsCancelEnabled(false)
                    loginOptionsViewOnLoginSuccess = VIEWS.settings
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions)
                }
                if(msAccDomElementCache) {
                    msAccDomElementCache.remove()
                    msAccDomElementCache = null
                }
            })
            .finally(() => {
                if(!isLastAccount) {
                    switchView(getCurrentView(), VIEWS.settings, 500, 500)
                }
            })

    }
})

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 * 
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid){
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if(uuid === val.getAttribute('uuid')){
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            if(selBtn.hasAttribute('selected')){
                selBtn.removeAttribute('selected')
            }
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')
const settingsCurrentMojangAccounts = document.getElementById('settingsCurrentMojangAccounts')
const settingsCurrentOfflineAccounts = document.getElementById('settingsCurrentOfflineAccounts')

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts(){
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if(authKeys.length === 0){
        return
    }
    const selectedUUID = ConfigManager.getSelectedAccount().uuid

    let microsoftAuthAccountStr = ''
    let mojangAuthAccountStr = ''
    let offlineAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]

        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/body/${getAccountSkinId(acc)}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.username')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.uuid')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
                    </div>
                </div>
            </div>
        </div>`

        if(acc.type === 'microsoft') {
            microsoftAuthAccountStr += accHtml
        } else if(acc.type === 'offline') {
            offlineAuthAccountStr += accHtml
        } else {
            mojangAuthAccountStr += accHtml
        }

    })

    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
    settingsCurrentMojangAccounts.innerHTML = mojangAuthAccountStr
    settingsCurrentOfflineAccounts.innerHTML = offlineAuthAccountStr
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

/**
 * Minecraft Tab
 */

/**
  * Disable decimals, negative signs, and scientific notation.
  */
document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById('settingsModsContainer')

/**
 * Escape text for use in HTML content and attributes.
 */
function escapeSettingsHTML(str){
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c])
}

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
                                <span class="settingsModName">${mdl.rawModule.name}</span>
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
                                <span class="settingsModName">${mdl.rawModule.name}</span>
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
        dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            ${settingsIconTile(dropin.name, () => IconCache.peekFile(jar), () => IconCache.jar(jar))}
                            <div class="settingsModDetails">
                                <span class="settingsModName">${dropin.name}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${dropin.fullName}">${Lang.queryJS('settings.dropinMods.removeButton')}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? 'checked' : ''}>
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

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener('keydown', async (e) => {
    if(getCurrentView() === VIEWS.settings && selectedSettingsTab === 'settingsTabMods'){
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

// Server status bar functions.

/**
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    for(const el of document.getElementsByClassName('settingsSelServContent')) {
        el.innerHTML = `
            <span class="serverListTile settingsSelServTile"></span>
            <div class="serverListingDetails">
                <span class="serverListingName">${serv.rawServer.name}</span>
                <span class="serverListingDescription">${serv.rawServer.description}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${serv.rawServer.minecraftVersion}</div>
                    <div class="serverListingRevision">${serv.rawServer.version}</div>
                    ${serv.rawServer.mainServer ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS('settings.serverListing.mainServer')}</span>
                    </div>` : ''}
                </div>
            </div>
        `
        // The pack's logo over its monogram, like the modpack picker.
        paintServerTile(el.querySelector('.settingsSelServTile'), serv.rawServer, ConfigManager.getAppearance(), 'serverListTile')
    }
}

// Bind functionality to the server switch button.
Array.from(document.getElementsByClassName('settingsSwitchServerButton')).forEach(el => {
    el.addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
})

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations(){
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
    saveShaderpackSettings()
    saveResourcepackSettings()
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
async function animateSettingsTabRefresh(){
    const tab = document.getElementById(selectedSettingsTab)
    await Promise.all([animateOut(tab, 160), prepareSettings()])
    animateIn(tab, 320, { rise: 8 })
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first){
    await resolveModsForUI()
    await resolveDropinModsForUI()
    await resolveShaderpacksForUI()
    await resolveResourcepacksForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindShaderpackButton()
    bindResourcepackButton()
    bindModsToggleSwitch()
    await loadSelectedServerOnModsTab()
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange     = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange     = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel     = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel     = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal     = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail     = document.getElementById('settingsMemoryAvail')
const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc     = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink     = document.getElementById('settingsJvmOptsLink')

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {

    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMinV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMinV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Increase maximum memory if the minimum exceeds its value.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV,
            ((sMinV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
    }

    // Update label
    settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
}

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMaxV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMaxV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Decrease the minimum memory if the maximum value is less.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV,
            ((sMaxV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
    }
    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
}

/**
 * Calculate common values for a ranged slider.
 * 
 * @param {Element} v The range slider to calculate against. 
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v){
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min)/val.step
    val.inc = 100/val.ticks
    return val
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider(){
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {

        // Reference the track (thumb).
        const track = v.getElementsByClassName('rangeSliderTrack')[0]

        // Set the initial slider value.
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)

        updateRangedSlider(v, value, ((value-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)

        // The magic happens when we click on the track.
        track.onmousedown = (e) => {

            // Stop moving the track on mouse up.
            document.onmouseup = (e) => {
                document.onmousemove = null
                document.onmouseup = null
            }

            // Move slider according to the mouse position.
            document.onmousemove = (e) => {

                // Distance from the beginning of the bar in pixels.
                const diff = e.pageX - v.offsetLeft - track.offsetWidth/2
                
                // Don't move the track off the bar.
                if(diff >= 0 && diff <= v.offsetWidth-track.offsetWidth/2){

                    // Convert the difference to a percentage.
                    const perc = (diff/v.offsetWidth)*100
                    // Calculate the percentage of the closest notch.
                    const notch = Number(perc/sliderMeta.inc).toFixed(0)*sliderMeta.inc

                    // If we're close to that notch, stick to it.
                    if(Math.abs(perc-notch) < sliderMeta.inc/2){
                        updateRangedSlider(v, sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc)), notch)
                    }
                }
            }
        }
    }) 
}

/**
 * Update a ranged slider's value and position.
 * 
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch){
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]
    
    element.setAttribute('value', value)

    if(notch < 0){
        notch = 0
    } else if(notch > 100) {
        notch = 100
    }

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    })

    let cancelled = !element.dispatchEvent(event)

    if(!cancelled){
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
    } else {
        element.setAttribute('value', oldVal)
    }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus(){
    settingsMemoryTotal.innerHTML = Number((os.totalmem()-1073741824)/1073741824).toFixed(1) + 'G'
    settingsMemoryAvail.innerHTML = Number(os.freemem()/1073741824).toFixed(1) + 'G'
}

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

function bindMinMaxRam(server) {
    // Store maximum memory values.
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)

    // Set the max and min values for the ranged sliders.
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab(){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
}

/**
 * Language Tab
 */

const langList = document.getElementById('langList')
const langSearchInput = document.getElementById('langSearchInput')
// Set when a language was picked while a game or download was running.
let langPendingReload = false

function langFlagUrl(country){
    return `./assets/images/flags/${country}.svg`
}

/**
 * Name of a language or region in the interface language, e.g. "Russian"
 * or "English (United States)".
 *
 * @param {string} type 'language' or 'region'.
 * @param {string} code A language tag or region code.
 */
function langDisplayName(type, code){
    const tag = Lang.getCurrent().tag
    try {
        const name = new Intl.DisplayNames([tag], { type, languageDisplay: 'standard' }).of(code)
        return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
    } catch {
        return code
    }
}

/**
 * Whether reloading the page now would interrupt a download or lose track of
 * a running game.
 */
function launcherBusy(){
    return runningServers.size > 0 || document.getElementById('landingContainer').hasAttribute('launching')
}

/**
 * The country to use for a language: the system's when it speaks it.
 */
function langDefaultCountry(def){
    for(const locale of Lang.systemLocales()){
        const hit = Lang.matchLocale(locale)
        if(hit != null && hit.language === def.id) return hit.country
    }
    return def.countries[0].code
}

/**
 * Fill the language tab from the saved selection.
 */
function renderLanguageTab(){
    const conf = ConfigManager.getLanguage()
    const sel = Lang.resolve(conf)
    const def = Lang.LANGUAGES.find(l => l.id === sel.language)
    const country = def.countries.find(c => c.code === sel.country)

    document.getElementById('langCurrentFlag').src = langFlagUrl(sel.country)
    document.getElementById('langCurrentName').textContent = def.name
    document.getElementById('langCurrentMeta').textContent = `${country.name} · ${sel.language}-${sel.country}`
    document.getElementById('langCurrent').toggleAttribute('pending', langPendingReload)
    document.getElementById('langCurrentStatusText').textContent = langPendingReload
        ? Lang.queryJS('settings.language.pending')
        : Lang.queryEJS('settings.languageApplied')

    const detected = Lang.systemLocales()[0]
    document.getElementById('langSystemToggle').checked = conf.system
    document.getElementById('langSystemDesc').textContent = Lang.queryJS('settings.language.systemDesc', {
        language: detected != null ? langDisplayName('language', detected) : '—'
    })
    document.getElementById('langMinecraftToggle').checked = conf.minecraft
    document.getElementById('langMinecraftDesc').textContent = Lang.queryJS('settings.language.minecraftDesc', {
        language: def.name,
        code: Lang.minecraftCode(sel, null)
    })

    renderLanguageList()
}

/**
 * Build the language cards, filtered by the search box.
 */
function renderLanguageList(){
    const sel = Lang.resolve(ConfigManager.getLanguage())
    const query = langSearchInput.value.trim().toLocaleLowerCase()
    langList.innerHTML = ''
    let shown = 0

    for(const def of Lang.LANGUAGES){
        const english = langDisplayName('language', def.id)
        const haystack = [def.id, def.name, english, ...def.countries.flatMap(c => [c.code, c.name, langDisplayName('region', c.code)])]
            .join(' ').toLocaleLowerCase()
        if(query && !haystack.includes(query)){
            continue
        }
        shown++
        const selected = def.id === sel.language
        const available = Lang.isAvailable(def.id)
        const flagCountry = selected ? sel.country : def.countries[0].code

        const card = document.createElement('div')
        card.className = 'langCard'
        card.tabIndex = 0
        card.setAttribute('role', 'radio')
        card.setAttribute('aria-checked', String(selected))
        card.toggleAttribute('selected', selected)
        card.toggleAttribute('disabled', !available)
        if(!available){
            card.tabIndex = -1
            card.setAttribute('aria-disabled', 'true')
        }

        const flag = document.createElement('img')
        flag.className = 'langFlag'
        flag.alt = ''
        flag.src = langFlagUrl(flagCountry)

        const text = document.createElement('div')
        text.className = 'langText'
        const name = document.createElement('span')
        name.className = 'langName'
        name.textContent = def.name
        name.lang = def.id
        const sub = document.createElement('span')
        sub.className = 'langSub'
        sub.textContent = `${english} · ${def.countries.length > 1
            ? Lang.queryJS('settings.language.countries', { count: def.countries.length })
            : def.countries[0].name}`
        text.append(name, sub)

        // Languages without a translation yet are listed but can't be picked.
        const mark = document.createElement('span')
        if(available){
            mark.className = 'langRadio'
        } else {
            mark.className = 'langInProgress'
            mark.textContent = Lang.queryJS('settings.language.inProgress')
        }
        card.append(flag, text, mark)

        if(def.countries.length > 1 && available){
            const chips = document.createElement('div')
            chips.className = 'langChips'
            for(const c of def.countries){
                const chip = document.createElement('button')
                chip.type = 'button'
                chip.className = 'langChip'
                chip.toggleAttribute('selected', selected && sel.country === c.code)
                chip.innerHTML = `<img class="langFlag" alt="" src="${langFlagUrl(c.code)}">`
                chip.append(c.name)
                chip.onclick = (e) => {
                    e.stopPropagation()
                    chooseLanguage(def.id, c.code)
                }
                chips.appendChild(chip)
            }
            card.appendChild(chips)
        }

        const pick = () => {
            if(available) chooseLanguage(def.id, selected ? sel.country : langDefaultCountry(def))
        }
        card.onclick = pick
        card.onkeydown = (e) => {
            if(e.target === card && (e.key === 'Enter' || e.key === ' ')){
                e.preventDefault()
                pick()
            }
        }
        langList.appendChild(card)
    }

    document.getElementById('langEmpty').textContent = shown === 0 ? Lang.queryJS('settings.language.noResults') : ''
}

/**
 * Save a picked language and switch to it.
 */
function chooseLanguage(language, country){
    ConfigManager.setLanguage({ system: false, language, country })
    ConfigManager.save()
    applyLanguageChange()
}

/**
 * Show the saved language: reload the page with its strings, or wait for the
 * running game or download to finish first.
 */
function applyLanguageChange(){
    const want = Lang.resolve(ConfigManager.getLanguage())
    const cur = Lang.getCurrent()
    if(want.language === cur.language && want.country === cur.country){
        langPendingReload = false
    } else if(launcherBusy()){
        langPendingReload = true
    } else {
        reloadForLanguage()
        return
    }
    renderLanguageTab()
}

/**
 * The page is rendered with the strings it loaded with, so a new language
 * means reloading it. The view, tab and scroll position come back as they
 * were (see showMainUI).
 */
function reloadForLanguage(){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ipcRenderer.sendSync('languageChanged', ConfigManager.getLanguage())
    try {
        const tab = document.getElementById(selectedSettingsTab)
        sessionStorage.setItem('meridian.reopen', JSON.stringify({
            view: getCurrentView(),
            tab: selectedSettingsTab,
            scroll: tab != null ? tab.scrollTop : 0
        }))
    } catch {
        // Without it the launcher just starts as usual.
    }
    document.body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' })
        .finished.then(() => location.reload())
}

/**
 * Switch to a language picked during a game or download once that is over.
 */
function maybeApplyPendingLanguage(){
    if(langPendingReload && !launcherBusy()){
        langPendingReload = false
        reloadForLanguage()
    }
}

document.getElementById('langSystemToggle').onchange = (e) => {
    const sel = Lang.resolve(ConfigManager.getLanguage())
    // Turning it off keeps whatever language is showing now.
    ConfigManager.setLanguage(e.target.checked ? { system: true } : { system: false, language: sel.language, country: sel.country })
    ConfigManager.save()
    applyLanguageChange()
}

document.getElementById('langMinecraftToggle').onchange = (e) => {
    ConfigManager.setLanguage({ minecraft: e.target.checked })
    ConfigManager.save()
}

langSearchInput.oninput = () => renderLanguageList()

/**
 * Prepare the language tab for display.
 */
function prepareLanguageTab(){
    renderLanguageTab()
}

/**
 * About & Updates Tab
 */

const settingsTabAbout             = document.getElementById('settingsTabAbout')
const settingsAboutChangelogLabel  = settingsTabAbout.getElementsByClassName('settingsChangelogLabel')[0]
const settingsAboutChangelogTitle  = settingsTabAbout.getElementsByClassName('settingsChangelogTitle')[0]
const settingsAboutChangelogText   = settingsTabAbout.getElementsByClassName('settingsChangelogText')[0]
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName('settingsChangelogButton')[0]
const settingsUpdateTitle          = document.getElementById('settingsUpdateTitle')
const settingsUpdateActionButton   = document.getElementById('settingsUpdateActionButton')

// Release notes of the running version, once fetched.
let settingsCurrentReleaseNotes = null
// The pending update, if there is one. Its notes take the changelog's place.
let settingsUpdateInfo = null

// Bind the devtools toggle button.
document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

/**
 * Return whether or not the provided version is a prerelease.
 * 
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version){
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

/**
 * Utility method to display version information on the About tab.
 * 
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(version, valueElement, titleElement, checkElement){
    valueElement.innerHTML = version
    if(isPrerelease(version)){
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation(){
    populateVersionInformation(remote.app.getVersion(), document.getElementById('settingsAboutCurrentVersionValue'), document.getElementById('settingsAboutCurrentVersionTitle'), document.getElementById('settingsAboutCurrentVersionCheck'))
}

/**
 * Show the pending update's notes if there is an update, otherwise the
 * notes of the running version.
 */
function renderChangelog(){
    if(settingsUpdateInfo != null){
        settingsAboutChangelogLabel.innerHTML = Lang.queryJS('settings.updates.whatsNew', { version: settingsUpdateInfo.version })
        settingsAboutChangelogTitle.innerHTML = settingsUpdateInfo.releaseName || settingsUpdateInfo.version
        settingsAboutChangelogText.innerHTML = settingsUpdateInfo.releaseNotes || Lang.queryEJS('settings.noReleaseNotes')
    } else if(settingsCurrentReleaseNotes != null){
        settingsAboutChangelogLabel.innerHTML = Lang.queryEJS('settings.releaseNotes')
        settingsAboutChangelogTitle.innerHTML = settingsCurrentReleaseNotes.title
        settingsAboutChangelogText.innerHTML = settingsCurrentReleaseNotes.text
        if(settingsCurrentReleaseNotes.href){
            settingsAboutChangelogButton.href = settingsCurrentReleaseNotes.href
        }
    }
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
function populateReleaseNotes(){
    $.ajax({
        url: 'https://github.com/ildimas/Helios-Custom-Worlds/releases.atom',
        success: (data) => {
            const version = 'v' + remote.app.getVersion()
            const entries = $(data).find('entry')
            
            for(let i=0; i<entries.length; i++){
                const entry = $(entries[i])
                let id = entry.find('id').text()
                id = id.substring(id.lastIndexOf('/')+1)

                if(id === version){
                    settingsCurrentReleaseNotes = {
                        title: entry.find('title').text(),
                        text: entry.find('content').text(),
                        href: entry.find('link').attr('href')
                    }
                    renderChangelog()
                }
            }

        },
        timeout: 2500
    }).catch(err => {
        if(settingsUpdateInfo == null && settingsCurrentReleaseNotes == null){
            settingsAboutChangelogText.innerHTML = Lang.queryJS('settings.about.releaseNotesFailed')
        }
    })
}

/**
 * Prepare the about tab for display.
 */
function prepareAboutTab(){
    populateAboutVersionInformation()
    populateReleaseNotes()
}

/**
 * Update the properties of the update action button.
 * 
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null){
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if(handler != null){
        settingsUpdateActionButton.onclick = handler
    }
}

/**
 * Populate the update status with relevant information.
 * 
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data){
    settingsUpdateInfo = data
    if(data != null){
        settingsUpdateTitle.innerHTML = Lang.queryJS(isPrerelease(data.version) ? 'settings.updates.newPreReleaseTitle' : 'settings.updates.newReleaseTitle', { version: data.version })
        settingsUpdateTitle.setAttribute('available', '')
        
        settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.promptInstall'), false, () => {
            startUpdateDownload(data)
        })
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateTitle.removeAttribute('available')
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
    renderChangelog()
}

/**
 * Prepare the update status for display.
 * 
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null){
    populateSettingsUpdateInformation(data)
}

/**
 * Settings preparation functions.
 */

/**
  * Prepare the entire settings UI.
  * 
  * @param {boolean} first Whether or not it is the first load.
  */
/**
 * Proxy Settings (Proxy Tab)
 */

let settingsProxyForm

function prepareProxySettings(){
    if(settingsProxyForm == null){
        settingsProxyForm = ProxyManager.bindForm(document.getElementById('settingsProxyForm'), ConfigManager)
    } else {
        settingsProxyForm.load()
    }
}

/**
 * Appearance Tab
 */

// Pack images shown in the drawer before "Show all".
const AP_ART_PAGE = 6
// Most pictures the preview cycles through (one dot each).
const AP_PREVIEW_MAX = 8
const AP_PREVIEW_MS = 4000
// The modpack shown in the preview, and the one open in the drawer.
let apPreviewServer = null
let apDrawerServer = null
let apArtExpanded = false
let apToken = 0
let apDrawerToken = 0

/**
 * Save appearance keys, then repaint the wallpaper and this tab.
 *
 * @param {Object} change The appearance keys to change.
 */
function setAppearance(change){
    ConfigManager.setAppearance(change)
    ConfigManager.save()
    ThemeEngine.refresh()
    renderAppearanceTab()
    if(apDrawerServer != null) renderPackDrawer()
}

/**
 * Change the settings of the modpack open in the drawer.
 *
 * @param {function(Object): void} edit Receives the pack's settings to change in place.
 */
function setPackAppearance(edit){
    const packs = ConfigManager.getAppearance().packs
    const pack = packs[apDrawerServer] || {}
    edit(pack)
    packs[apDrawerServer] = pack
    setAppearance({ packs })
}

/**
 * Mark the button of a segmented control whose value matches.
 */
function setSegment(id, value){
    for(const btn of document.getElementById(id).children){
        btn.toggleAttribute('selected', btn.value === value)
        btn.setAttribute('aria-pressed', btn.value === value)
    }
}

async function getAppearanceServers(){
    const distro = await DistroAPI.getDistribution()
    return distro != null ? distro.servers : []
}

/**
 * Render the Appearance tab from the saved settings.
 */
async function renderAppearanceTab(){
    const token = ++apToken
    const appearance = ConfigManager.getAppearance()
    setSegment('apInterval', String(appearance.interval))
    document.getElementById('apMotion').checked = appearance.motion !== false

    const servers = await getAppearanceServers()
    if(!servers.some(s => s.rawServer.id === apPreviewServer)){
        apPreviewServer = ConfigManager.getSelectedServer() || (servers[0] && servers[0].rawServer.id) || null
    }
    const rotations = await Promise.all(servers.map(s => ThemeEngine.packRotation(s.rawServer.id)))
    if(token !== apToken) return

    const list = document.getElementById('apPackList')
    list.innerHTML = ''
    servers.forEach((serv, i) => {
        const id = serv.rawServer.id
        const rot = rotations[i]
        const art = rot.art.items.filter(it => !rot.hidden.has(it.key)).length
        const shots = rot.shots.filter(it => !rot.hidden.has(it.key)).length

        const row = document.createElement('div')
        row.className = 'apPackRow'
        row.setAttribute('role', 'listitem')
        row.toggleAttribute('selected', id === apPreviewServer)
        row.innerHTML = '<span class="serverListTile"></span><span class="apPackRowName"></span><span class="apPackRowMeta"></span>'
            + '<button class="apEdit"><span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>'
        paintServerTile(row.firstChild, serv.rawServer, appearance, 'serverListTile')
        row.querySelector('.apPackRowName').textContent = serv.rawServer.name
        row.querySelector('.apPackRowMeta').textContent = Lang.queryJS('settings.appearance.packCounts', { art, shots })
        const edit = row.querySelector('.apEdit')
        edit.firstChild.textContent = Lang.queryEJS('settings.appearanceEdit')
        edit.onclick = e => {
            e.stopPropagation()
            openPackDrawer(id)
        }
        row.onclick = () => {
            if(apPreviewServer === id) return
            apPreviewServer = id
            renderAppearanceTab()
        }
        list.appendChild(row)
    })

    const preview = servers.find(s => s.rawServer.id === apPreviewServer)
    setPreviewPlaylist(preview, preview != null ? rotations[servers.indexOf(preview)] : null)
}

/* Preview: the selected pack's rotation, cross-fading in a small frame. */

let apPreview = { key: null, items: [], i: 0 }
let apPreviewTimer = null

function setPreviewPlaylist(server, rot){
    document.getElementById('apPreviewCaption').textContent = server != null ? Lang.queryJS('settings.appearance.preview', { server: server.rawServer.name }) : ''
    const items = rot != null ? rot.list.items.slice(0, AP_PREVIEW_MAX) : []
    const key = (server != null ? server.rawServer.id : '') + '#' + items.map(it => it.key).join('|')
    if(key === apPreview.key) return
    apPreview = { key, items, i: 0 }
    const dots = document.getElementById('apPreviewDots')
    dots.innerHTML = items.length > 1 ? '<span></span>'.repeat(items.length) : ''
    showPreviewItem()
}

async function showPreviewItem(){
    clearTimeout(apPreviewTimer)
    const { key, items, i } = apPreview
    const frame = document.getElementById('apPreviewFrame')
    const label = document.getElementById('apPreviewLabel')
    Array.from(document.getElementById('apPreviewDots').children).forEach((d, n) => d.toggleAttribute('selected', n === i))
    const item = items[i]
    if(item == null){
        Array.from(frame.getElementsByClassName('apPreviewImg')).forEach(el => el.remove())
        label.hidden = true
        return
    }
    const url = item.url || await Screenshots.preview(item.file)
    if(key !== apPreview.key || i !== apPreview.i) return
    const img = document.createElement('img')
    img.className = 'apPreviewImg'
    img.alt = ''
    img.src = url || ''
    try {
        await img.decode()
    } catch {
        // Shown dark.
    }
    if(key !== apPreview.key || i !== apPreview.i) return
    const old = Array.from(frame.getElementsByClassName('apPreviewImg'))
    frame.insertBefore(img, label)
    void img.offsetWidth
    img.classList.add('apShown')
    setTimeout(() => old.forEach(el => el.remove()), 700)
    label.hidden = false
    label.textContent = Lang.queryJS(item.kind === 'shot' ? 'settings.appearance.labelShot' : item.kind === 'gallery' ? 'settings.appearance.labelGallery' : 'settings.appearance.labelPack')
    if(items.length > 1){
        apPreviewTimer = setTimeout(() => {
            // Hold still while nobody is looking at the tab.
            if(document.getElementById('settingsTabAppearance').offsetParent != null && document.hasFocus()){
                apPreview.i = (apPreview.i + 1) % apPreview.items.length
            }
            showPreviewItem()
        }, AP_PREVIEW_MS)
    }
}

/* Drawer: one modpack's source and pictures. */

// Thumbnails are made only for tiles scrolled into view.
const apThumbObserver = new IntersectionObserver(entries => {
    for(const entry of entries){
        if(!entry.isIntersecting) continue
        apThumbObserver.unobserve(entry.target)
        Screenshots.thumb(entry.target.getAttribute('data-src')).then(url => {
            if(url == null) return
            entry.target.style.backgroundImage = `url("${url}")`
        })
    }
}, { rootMargin: '200px 0px' })

/**
 * A picture tile: ticked when it is in rotation.
 */
function buildPictureTile(item, picked){
    const tile = document.createElement('button')
    tile.className = 'apShot'
    tile.toggleAttribute('selected', picked)
    tile.setAttribute('aria-pressed', picked)
    tile.title = item.file.split(/[\\/]/).pop()
    const preview = document.createElement('span')
    preview.className = 'apShotPreview'
    preview.setAttribute('data-src', item.file)
    const mark = document.createElement('span')
    mark.className = 'apShotMark'
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
    preview.appendChild(mark)
    tile.appendChild(preview)
    tile.onclick = () => setPackAppearance(pack => {
        const hidden = new Set(pack.hidden || [])
        hidden.has(item.key) ? hidden.delete(item.key) : hidden.add(item.key)
        pack.hidden = Array.from(hidden)
    })
    apThumbObserver.observe(preview)
    return tile
}

function fillPictureGrid(grid, items, hidden){
    // Keep tiles (and their loaded thumbnails) when only ticks changed.
    const key = items.map(it => it.key).join('|')
    if(grid.getAttribute('data-key') === key){
        Array.from(grid.children).forEach((tile, i) => {
            const picked = !hidden.has(items[i].key)
            tile.toggleAttribute('selected', picked)
            tile.setAttribute('aria-pressed', picked)
        })
        return
    }
    grid.innerHTML = ''
    grid.setAttribute('data-key', key)
    for(const item of items){
        grid.appendChild(buildPictureTile(item, !hidden.has(item.key)))
    }
}

async function renderPackDrawer(){
    const token = ++apDrawerToken
    const servers = await getAppearanceServers()
    const server = servers.find(s => s.rawServer.id === apDrawerServer)
    if(server == null){
        closePackDrawer()
        return
    }
    const rot = await ThemeEngine.packRotation(apDrawerServer)
    if(token !== apDrawerToken) return
    const appearance = ConfigManager.getAppearance()

    const tile = document.getElementById('apDrawerTile')
    if(tile.getAttribute('data-key') !== apDrawerServer){
        paintServerTile(tile, server.rawServer, appearance, 'serverListTile')
        tile.setAttribute('data-key', apDrawerServer)
    }
    document.getElementById('apDrawerName').textContent = server.rawServer.name
    document.getElementById('apDrawerSub').textContent = Lang.queryJS('settings.appearance.serverPack')

    const picked = items => items.filter(it => !rot.hidden.has(it.key)).length
    const art = rot.art.items
    document.getElementById('apArtTitle').textContent = Lang.queryJS('settings.appearance.artTitle')
    document.getElementById('apArtCount').textContent = Lang.queryJS('settings.appearance.count', { count: picked(art), total: art.length })
    const artAll = document.getElementById('apArtAll')
    artAll.hidden = art.length <= AP_ART_PAGE
    artAll.textContent = apArtExpanded ? Lang.queryJS('settings.appearance.showLess') : Lang.queryEJS('settings.appearanceShowAll')
    fillPictureGrid(document.getElementById('apArtGrid'), apArtExpanded ? art : art.slice(0, AP_ART_PAGE), rot.hidden)

    document.getElementById('apShotCount').textContent = Lang.queryJS('settings.appearance.count', { count: picked(rot.shots), total: rot.shots.length })
    document.getElementById('apShotEmpty').hidden = rot.shots.length > 0
    fillPictureGrid(document.getElementById('apShotGrid'), rot.shots, rot.hidden)
}

const apDrawer = document.getElementById('apDrawer')

function openPackDrawer(id){
    if(apDrawerServer !== id){
        apArtExpanded = false
        document.querySelector('#apDrawer .apDrawerBody').scrollTop = 0
    }
    apDrawerServer = id
    apPreviewServer = id
    renderAppearanceTab()
    renderPackDrawer()
    document.getElementById('settingsContainerRight').setAttribute('drawer', '')
    apDrawer.setAttribute('aria-hidden', 'false')
    // The drawer is still off to the right; scrolling it into view would shove the tab aside.
    document.getElementById('apDrawerClose').focus({ preventScroll: true })
}

function closePackDrawer(){
    if(apDrawerServer == null) return
    apDrawerServer = null
    document.getElementById('settingsContainerRight').removeAttribute('drawer')
    apDrawer.setAttribute('aria-hidden', 'true')
}

/**
 * Bind the Appearance tab's controls. Runs once.
 */
function prepareAppearanceTab(){
    for(const btn of document.getElementById('apInterval').children){
        btn.onclick = () => setAppearance({ interval: Number(btn.value) })
    }
    document.getElementById('apMotion').onchange = e => setAppearance({ motion: e.target.checked })

    document.getElementById('apArtAll').onclick = () => {
        apArtExpanded = !apArtExpanded
        renderPackDrawer()
    }
    document.getElementById('apShotsFolder').onclick = async () => {
        if(apDrawerServer == null) return
        const dir = Screenshots.directory(apDrawerServer)
        await fs.ensureDir(dir)
        shell.openPath(dir)
    }
    document.getElementById('apDrawerClose').onclick = closePackDrawer
    document.getElementById('apDrawerDone').onclick = closePackDrawer
    document.getElementById('apDrawerScrim').onclick = closePackDrawer
    apDrawer.addEventListener('keydown', e => {
        if(e.key === 'Escape'){
            e.stopPropagation()
            closePackDrawer()
        }
    })
}

async function prepareSettings(first = false) {
    if(first){
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
        prepareAppearanceTab()
    } else {
        await prepareModsTab()
    }
    await initSettingsValues()
    prepareProxySettings()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
    prepareLanguageTab()
    renderAppearanceTab()
}

// Prepare the settings UI on startup.
//prepareSettings(true)
