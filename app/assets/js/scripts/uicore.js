/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        switch(arg){
            case 'checking-for-update':
                loggerAutoUpdater.info('Checking for update..')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
                break
            case 'update-available':
                loggerAutoUpdater.info('New update available', info.version)
                if(process.platform === 'darwin'){
                    info.darwindownload = `https://github.com/ildimas/Helios-Custom-Worlds/releases/download/v${info.version}/Meridian-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                }
                if(updateDownloading == null){
                    showUpdateUI(info)
                    populateSettingsUpdateInformation(info)
                    promptUpdate(info)
                }
                break
            case 'mac-manual':
                updateManualMac(updateDownloading || info)
                break
            case 'download-progress':
                showUpdateProgress(Math.floor(info.percent))
                break
            case 'update-downloaded':
                loggerAutoUpdater.info('Update ' + info.version + ' downloaded, installing.')
                setOverlayContent(
                    Lang.queryJS('uicore.autoUpdate.downloadingTitle', { version: info.version }),
                    Lang.queryJS('uicore.autoUpdate.downloadingDesc'),
                    Lang.queryJS('uicore.autoUpdate.installing')
                )
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installing'), true)
                ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
                break
            case 'update-not-available':
                loggerAutoUpdater.info('No new update found.')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            case 'ready':
                updateCheckListener = setInterval(() => {
                    // A check would reset the progress shown in settings.
                    if(updateDownloading == null){
                        ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                    }
                }, 1800000)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                break
            case 'realerror':
                if(updateDownloading != null){
                    loggerAutoUpdater.error('Error while downloading the update..', info)
                    updateDownloadFailed()
                    break
                }
                if(info != null && info.code != null){
                    if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                        loggerAutoUpdater.info('No suitable releases found.')
                    } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                        loggerAutoUpdater.info('No releases found.')
                    } else {
                        loggerAutoUpdater.error('Error during update check..', info)
                        loggerAutoUpdater.debug('Error Code:', info.code)
                    }
                }
                break
            default:
                loggerAutoUpdater.info('Unknown argument', arg)
                break
        }
    })
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function showUpdateUI(info){
    document.getElementById('image_seal_container').setAttribute('update', true)
    document.getElementById('image_seal_container').onclick = () => {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            settingsNavItemListener(document.getElementById('settingsNavAbout'), false)
        })
    }
}

// The version the player was already asked about; "Later" holds until the
// next start, when the check finds the update again and asks again.
let updatePromptVersion = null
let updatePromptTimer = null
// The update being downloaded, or null.
let updateDownloading = null

/**
 * Ask whether to download a new version now or later. Waits until the
 * launcher is idle: not on the splash or the Microsoft login, nothing
 * launching or running, no other dialog open. Installing restarts the
 * launcher, which would take a running game with it.
 *
 * @param {Object} info The update info from electron-updater.
 */
function promptUpdate(info){
    if(updatePromptVersion === info.version){
        return
    }
    clearTimeout(updatePromptTimer)
    const view = getCurrentView()
    if(view == null || view === VIEWS.waiting || launcherBusy() || isOverlayVisible()){
        updatePromptTimer = setTimeout(() => promptUpdate(info), 5000)
        return
    }
    updatePromptVersion = info.version
    setOverlayContent(
        Lang.queryJS('uicore.autoUpdate.promptTitle', { version: info.version }),
        Lang.queryJS('uicore.autoUpdate.promptDesc'),
        Lang.queryJS('uicore.autoUpdate.promptInstall'),
        Lang.queryJS('uicore.autoUpdate.promptLater')
    )
    setOverlayHandler(() => {
        startUpdateDownload(info)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

/**
 * Download the update, then install it and restart. Shows the progress in a
 * dialog that can't be closed: the launcher restarts once it's done.
 *
 * @param {Object} info The update info from electron-updater.
 */
function startUpdateDownload(info){
    if(updateDownloading != null){
        return
    }
    updateDownloading = info
    updatePromptVersion = info.version
    clearTimeout(updatePromptTimer)
    setOverlayContent(
        Lang.queryJS('uicore.autoUpdate.downloadingTitle', { version: info.version }),
        Lang.queryJS('uicore.autoUpdate.downloadingDesc'),
        ''
    )
    setOverlayHandler(() => {})
    showUpdateProgress(0)
    toggleOverlay(true)
    ipcRenderer.send('autoUpdateAction', 'downloadUpdate')
}

/**
 * Show the download progress in the dialog and in settings.
 *
 * @param {number} percent How much is downloaded, 0 to 100.
 */
function showUpdateProgress(percent){
    const text = Lang.queryJS('uicore.autoUpdate.downloadingProgress', { percent })
    const button = document.getElementById('overlayAcknowledge')
    button.innerHTML = text
    button.disabled = true
    settingsUpdateButtonStatus(text, true)
}

/**
 * macOS can't replace the launcher where it runs (from the dmg or Downloads):
 * offer the dmg instead, and say how to get updates on their own.
 *
 * @param {Object} info The update info from electron-updater.
 */
function updateManualMac(info){
    updateDownloading = null
    document.getElementById('overlayAcknowledge').disabled = false
    setOverlayContent(
        Lang.queryJS('uicore.autoUpdate.promptTitle', { version: info.version }),
        Lang.queryJS('uicore.autoUpdate.promptDescMac'),
        Lang.queryJS('uicore.autoUpdate.promptDownload'),
        Lang.queryJS('uicore.autoUpdate.promptLater')
    )
    setOverlayHandler(() => {
        shell.openExternal(info.darwindownload)
        toggleOverlay(false)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
    populateSettingsUpdateInformation(info)
}

/**
 * The download failed: say so and offer the update again from settings.
 */
function updateDownloadFailed(){
    const info = updateDownloading
    updateDownloading = null
    document.getElementById('overlayAcknowledge').disabled = false
    setOverlayContent(
        Lang.queryJS('uicore.autoUpdate.failedTitle'),
        Lang.queryJS('uicore.autoUpdate.failedDesc'),
        Lang.queryJS('uicore.autoUpdate.failedOk')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    populateSettingsUpdateInformation(info)
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        
    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})