const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionMojang = document.getElementById('loginOptionMojang')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')
const loginOptionProxyToggle = document.getElementById('loginOptionProxyToggle')
const loginOptionProxyPanel = document.getElementById('loginOptionProxyPanel')
const loginOptionProxyState = document.getElementById('loginOptionProxyState')

let loginOptionsCancellable = false

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

loginOptionMicrosoft.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        )
    })
}

loginOptionMojang.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
    })
}

loginOptionsCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        // Clear login values (Mojang login)
        // No cleanup needed for Microsoft.
        loginUsername.value = ''
        loginPassword.value = ''
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}

const loginOptionProxyForm = ProxyManager.bindForm(document.getElementById('loginOptionProxyForm'), ConfigManager)

function refreshLoginOptionProxyState(){
    const proxy = ConfigManager.getProxy()
    loginOptionProxyState.textContent = proxy.enabled ? `${proxy.host}:${proxy.port}` : ''
}
refreshLoginOptionProxyState()

loginOptionProxyToggle.onclick = () => {
    const open = loginOptionProxyPanel.style.display === 'none'
    if(open){
        loginOptionProxyForm.load()
        $(loginOptionProxyPanel).slideDown(200)
    } else {
        $(loginOptionProxyPanel).slideUp(200)
    }
    loginOptionProxyToggle.setAttribute('aria-expanded', open)
}

document.getElementById('loginOptionProxyForm').addEventListener('proxysaved', refreshLoginOptionProxyState)

/* Play without signing in (offline account). */

const loginOptionOffline = document.getElementById('loginOptionOffline')
const loginOptionOfflinePanel = document.getElementById('loginOptionOfflinePanel')
const loginOptionOfflineName = document.getElementById('loginOptionOfflineName')
const loginOptionOfflineSubmit = document.getElementById('loginOptionOfflineSubmit')

/**
 * Show or hide the offline name form.
 *
 * @param {boolean} open True to show the form.
 */
function loginOptionsShowOffline(open){
    if(open){
        $(loginOptionOfflinePanel).slideDown(200, () => loginOptionOfflineName.focus())
    } else {
        $(loginOptionOfflinePanel).slideUp(200)
    }
    loginOptionOffline.setAttribute('aria-expanded', open)
}

loginOptionOffline.onclick = () => {
    loginOptionsShowOffline(loginOptionOfflinePanel.style.display === 'none')
}

loginOptionOfflineName.oninput = () => {
    const valid = AuthManager.isValidOfflineName(loginOptionOfflineName.value)
    loginOptionOfflineSubmit.disabled = !valid
    loginOptionOfflineName.toggleAttribute('invalid', loginOptionOfflineName.value.trim() !== '' && !valid)
}

loginOptionOfflinePanel.onsubmit = async (e) => {
    e.preventDefault()
    if(loginOptionOfflineSubmit.disabled){
        return
    }
    loginOptionOfflineSubmit.disabled = true
    try {
        const account = await AuthManager.addOfflineAccount(loginOptionOfflineName.value)
        updateSelectedAccount(account)
        const next = loginOptionsViewOnLoginSuccess
        switchView(getCurrentView(), next, 500, 500, async () => {
            if(next === VIEWS.settings){
                await prepareSettings()
            }
            loginOptionOfflineName.value = ''
            loginOptionOfflineName.removeAttribute('invalid')
            loginOptionOfflinePanel.style.display = 'none'
            loginOptionOffline.setAttribute('aria-expanded', false)
        })
    } catch(err) {
        setOverlayContent(err.title, err.desc, Lang.queryJS('landing.launch.okay'))
        setOverlayHandler(null)
        toggleOverlay(true)
        loginOptionOfflineSubmit.disabled = false
    }
}
