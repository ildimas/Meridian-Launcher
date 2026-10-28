/**
 * Installs deb and pacman updates without freezing the launcher.
 *
 * electron-updater runs `pkexec pacman -U` (or dpkg) with spawnSync, which
 * blocks the main process for as long as the password dialog is open. The
 * window stops answering, the compositor offers to kill it, and killing it
 * takes the install with it. Here the same command runs asynchronously; the
 * launcher restarts once the package manager is done.
 *
 * Runs in the main process. Settings live in ~/.config/Meridian, outside the
 * install folder, so they survive the update.
 */
const { app } = require('electron')
const child_process = require('child_process')
const fs            = require('fs')
const path          = require('path')

/**
 * How the launcher was installed: 'deb', 'pacman', or null for AppImage and
 * anything else electron-updater installs by itself.
 */
function packageType(){
    if(process.platform !== 'linux'){
        return null
    }
    try {
        const type = fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim()
        return type === 'deb' || type === 'pacman' ? type : null
    } catch {
        return null
    }
}

/**
 * The full path of a command on PATH, or null.
 */
function which(cmd){
    for(const dir of (process.env.PATH || '/usr/bin:/bin').split(':')){
        const file = path.join(dir, cmd)
        try {
            fs.accessSync(file, fs.constants.X_OK)
            return file
        } catch {
            // Not here.
        }
    }
    return null
}

/**
 * Whether this install is handled here rather than by electron-updater.
 * pkexec asks for the password in a desktop dialog; without it there is no
 * way to ask, and electron-updater's own fallbacks are left to try.
 */
exports.handles = function(){
    return packageType() != null && which('pkexec') != null
}

/**
 * The command that installs the package, as root.
 *
 * @param {string} file The downloaded package.
 */
function installCommand(file){
    if(packageType() === 'pacman'){
        return [which('pacman') || '/usr/bin/pacman', '-U', '--noconfirm', file]
    }
    // apt pulls in dependencies the new version added; dpkg alone can't.
    const apt = which('apt-get')
    if(apt != null){
        return [apt, 'install', '-y', '--allow-downgrades', file]
    }
    return [which('dpkg') || '/usr/bin/dpkg', '-i', file]
}

/**
 * Install the package, then restart the launcher.
 *
 * Rejects with { cancelled: true } when the player closes the password
 * dialog (pkexec exits 126), otherwise with the package manager's output
 * (pkexec itself exits 127 when it can't ask at all).
 *
 * @param {string} file The downloaded package.
 */
exports.install = function(file){
    return new Promise((resolve, reject) => {
        const command = installCommand(file)
        const child = child_process.spawn(which('pkexec'), command, { stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', d => { output += d })
        child.stderr.on('data', d => { output += d })
        child.on('error', reject)
        child.on('close', code => {
            if(code === 0){
                resolve()
                app.relaunch()
                app.quit()
            } else if(code === 126){
                reject(Object.assign(new Error('Authentication cancelled'), { cancelled: true }))
            } else {
                reject(new Error(`${path.basename(command[0])} exited with code ${code}\n${output.trim()}`))
            }
        })
    })
}
