// Requirements
const semver = require('semver')

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
            if(!selectedServerExists()){
                continue
            }
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
            if(!selectedServerExists()){
                return
            }
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

/**
 * Whether the selected pack is still in the distribution. Right after it was
 * removed on the Modpacks tab it is not, and its settings must not be saved.
 */
function selectedServerExists(){
    return ConfigManager.getModConfiguration(ConfigManager.getSelectedServer()) != null
}

function fullSettingsSave() {
    // A failed save must not keep the user from leaving settings.
    try {
        saveSettingsValues()
        saveGameDefaults()
        ConfigManager.save()
    } catch(err) {
        console.error('Unable to save the settings.', err)
        settingsSaveFailed(err)
    }
}

/**
 * Escape text for use in HTML content and attributes.
 */
function escapeSettingsHTML(str){
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c])
}

/**
 * Tell the user some settings weren't saved, unless a dialog is already open.
 */
function settingsSaveFailed(err){
    if(isOverlayVisible()){
        return
    }
    setOverlayContent(
        Lang.queryJS('settings.saveFailed.title'),
        Lang.queryJS('settings.saveFailed.desc', { message: escapeSettingsHTML(err && err.message ? err.message : String(err)) }),
        Lang.queryJS('settings.saveFailed.okButton')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

// Escape leaves too, unless a dialog, the picture drawer or the pack list
// is open: those close first.
document.addEventListener('keydown', (e) => {
    if(e.key !== 'Escape' || e.defaultPrevented || getCurrentView() !== VIEWS.settings || settingsNavDone.disabled){
        return
    }
    if(isOverlayVisible() || document.getElementById('settingsContainerRight').hasAttribute('drawer') || mpMenu.open){
        return
    }
    e.preventDefault()
    settingsNavDone.click()
})

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
// Sign-in continues in the system browser: the waiting view can cancel it.
const waitingBrowser = document.getElementById('waitingBrowser')
ipcRenderer.on(MSFT_OPCODE.REPLY_BROWSER, () => {
    $(waitingBrowser).fadeIn(200)
})
document.getElementById('waitingCancelButton').onclick = () => {
    ipcRenderer.send(MSFT_OPCODE.CANCEL_LOGIN)
}

ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    $(waitingBrowser).hide()
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
            const browserLogin = queryMap.code_verifier == null ? undefined : {
                redirectUri: queryMap.redirect_uri,
                codeVerifier: queryMap.code_verifier
            }
            AuthManager.addMicrosoftAccount(authCode, browserLogin).then(value => {
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
    // Mojang sign-in is gone; the section stays only for accounts added before.
    const hasMojang = authKeys.some(k => authAccounts[k].type !== 'microsoft' && authAccounts[k].type !== 'offline')
    settingsCurrentMojangAccounts.closest('.settingsAuthAccountTypeContainer').style.display = hasMojang ? '' : 'none'
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

// Memory and JVM options for every pack that doesn't set its own. Turned
// off, each pack takes what it recommends.
const gameMemory = document.getElementById('gameMemory')
const gameJvmInput = document.getElementById('gameJVMOptsVal')
const gameGroups = {
    memory: document.querySelector('[data-game-group="memory"]'),
    jvm: document.querySelector('[data-game-group="jvm"]')
}

function renderGameGroupState(name){
    const group = gameGroups[name]
    group.querySelector('.packGroupState').textContent = Lang.queryJS(group.hasAttribute('own') ? 'settings.game.stateOwn' : 'settings.game.stateRecommended')
}

for(const [name, group] of Object.entries(gameGroups)){
    group.querySelector('.packOwnToggle').onchange = (e) => {
        setGroupOwn(group, e.target.checked)
        renderGameGroupState(name)
    }
}

/**
 * Show the shared memory and JVM options. While unset, the selected pack's
 * recommendation fills the greyed out controls.
 */
async function prepareGameDefaults(){
    const id = ConfigManager.getSelectedServer()
    const rec = id != null && selectedServerExists() ? ConfigManager.getRecommendedJava(id) : null
    const memory = ConfigManager.getDefaultMemory()
    setMemoryControl(gameMemory, 1, memory ?? rec ?? { minRAM: '4G', maxRAM: '4G' })
    setGroupOwn(gameGroups.memory, memory != null)

    const jvm = ConfigManager.getDefaultJVMOptions()
    gameJvmInput.value = (jvm ?? rec?.jvmOptions ?? []).join(' ')
    setGroupOwn(gameGroups.jvm, jvm != null)

    renderGameGroupState('memory')
    renderGameGroupState('jvm')
}

function saveGameDefaults(){
    ConfigManager.setDefaultMemory(gameGroups.memory.hasAttribute('own') ? readMemoryControl(gameMemory) : null)
    const jvm = gameJvmInput.value.trim()
    ConfigManager.setDefaultJVMOptions(gameGroups.jvm.hasAttribute('own') ? (jvm ? jvm.split(/\s+/) : []) : null)
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
        url: 'https://github.com/ildimas/Meridian-Launcher/releases.atom',
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
    } else if(UpdatePolicy.isManagedExternally()){
        settingsUpdateTitle.innerHTML = launcherRelease != null
            ? Lang.queryJS('settings.updates.managedExternallyNewTitle', { version: launcherRelease.version })
            : Lang.queryJS('settings.updates.managedExternallyTitle')
        settingsUpdateTitle.toggleAttribute('available', launcherRelease != null)
        settingsUpdateActionButton.style.display = 'none'
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
    document.getElementById('apSplash').checked = appearance.splash !== false

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
    document.getElementById('apSplash').onchange = e => setAppearance({ splash: e.target.checked })

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

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
async function animateSettingsTabRefresh(){
    const tab = document.getElementById(selectedSettingsTab)
    await Promise.all([animateOut(tab, 160), prepareSettings()])
    animateIn(tab, 320, { rise: 8 })
}

async function prepareSettings(first = false) {
    if(first){
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
        prepareAppearanceTab()
    }
    await initSettingsValues()
    prepareProxySettings()
    prepareAccountsTab()
    await prepareGameDefaults()
    prepareAboutTab()
    prepareLanguageTab()
    prepareDistroUrlSetting()
    renderAppearanceTab()
}

/**
 * Distribution url
 */

/**
 * Show the distribution.json url in use and bind its buttons.
 */
function prepareDistroUrlSetting(){
    const input = document.getElementById('settingsDistroUrlInput')
    input.placeholder = REMOTE_DISTRO_URL
    input.value = ConfigManager.getDistributionURL()
    distroUrlStatus(null)
    if(input.hasAttribute('bound')){
        return
    }
    input.setAttribute('bound', '')
    input.addEventListener('input', () => distroUrlStatus(null))
    input.addEventListener('keydown', e => {
        if(e.key === 'Enter') applyDistroUrl(input.value)
    })
    document.getElementById('settingsDistroUrlApply').onclick = () => applyDistroUrl(input.value)
    document.getElementById('settingsDistroUrlReset').onclick = () => applyDistroUrl('')
}

function distroUrlStatus(key){
    const status = document.getElementById('settingsDistroUrlStatus')
    status.hidden = key == null
    status.textContent = key != null ? Lang.queryJS(`settings.distroUrl.${key}`) : ''
}

/**
 * Save a new distribution.json url and restart the launcher on it, so the
 * packs, servers and news all come from the new file.
 *
 * @param {string} value The url; empty for the built-in one.
 */
function applyDistroUrl(value){
    const url = String(value || '').trim()
    if(url !== ''){
        let parsed = null
        try {
            parsed = new URL(url)
        } catch {
            // Reported below.
        }
        if(parsed == null || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')){
            distroUrlStatus('invalid')
            return
        }
    }
    if(url === ConfigManager.getDistributionURL()){
        distroUrlStatus('unchanged')
        return
    }
    if(launcherBusy()){
        distroUrlStatus('busy')
        return
    }
    fullSettingsSave()
    ConfigManager.setDistributionURL(url)
    ConfigManager.save()
    // A plain reload: the preloader fetches the distribution from the new url.
    document.body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' })
        .finished.then(() => location.reload())
}

// Prepare the settings UI on startup.
//prepareSettings(true)
