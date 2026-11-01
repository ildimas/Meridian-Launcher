/**
 * Whether the launcher updates itself, or something else installs new
 * versions.
 *
 * electron-builder writes app-update.yml into the resources of every build
 * electron-updater can update (nsis, dmg/zip, AppImage, deb, pacman). A
 * distribution package that runs the app on the system Electron (the AUR
 * package, Flatpak and so on) has none: its package manager brings new
 * versions, and an update from GitHub would only fight it.
 *
 * MERIDIAN_DISABLE_UPDATES=1 turns updates off for any other install.
 * Development runs keep their own handling (dev-app-update.yml).
 *
 * Works in the main and the renderer process.
 */
const fs    = require('fs')
const path  = require('path')

const isDev = require('./isdev')

let managedExternally = null

exports.isManagedExternally = function(){
    if(managedExternally == null){
        managedExternally = !isDev && (process.env.MERIDIAN_DISABLE_UPDATES === '1'
            || process.resourcesPath == null
            || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')))
    }
    return managedExternally
}
