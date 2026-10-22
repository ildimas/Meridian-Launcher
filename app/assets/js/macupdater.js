/**
 * Updates the launcher on macOS without an Apple Developer ID.
 *
 * electron-updater installs Mac updates through Squirrel.Mac, which only
 * accepts signed apps. Instead the release's zip is downloaded here, checked
 * against the sha512 in latest-mac.yml and unpacked; once the launcher quits,
 * a small script swaps Meridian.app for the new one and opens it again.
 * Gatekeeper leaves the new app alone: files the launcher downloads itself
 * aren't quarantined, only those from a browser are.
 *
 * Runs in the main process. Settings live in ~/Library/Application Support,
 * outside the app bundle, so they survive the swap.
 */
const { app, net } = require('electron')
const child_process = require('child_process')
const crypto        = require('crypto')
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')

// Where releases are published, as in electron-builder's publish settings.
const RELEASES = 'https://github.com/ildimas/Helios-Custom-Worlds/releases/download'

/**
 * Meridian.app, from the running executable (Contents/MacOS/Meridian).
 */
function bundlePath(){
    return path.resolve(process.execPath, '..', '..', '..')
}

/**
 * Whether the app can replace itself. Not when it runs from the dmg, or from
 * a folder macOS moved it out of (App Translocation, when it was never put
 * in Applications), or a folder the player can't write to.
 */
exports.canInstall = function(){
    const bundle = bundlePath()
    if(!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')){
        return false
    }
    try {
        fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
        fs.accessSync(bundle, fs.constants.W_OK)
        return true
    } catch {
        return false
    }
}

/**
 * The zip for this Mac in the release, or null if the release has none
 * (releases before the zip was built only have dmgs).
 *
 * @param {Object} info The update info from electron-updater.
 */
function zipFile(info){
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return (info.files || []).find(f => f.url.endsWith(`-${arch}.zip`)) || null
}

exports.hasZip = (info) => zipFile(info) != null

// The unpacked update waiting for install().
let staged = null

/**
 * Download and unpack an update.
 *
 * @param {Object} info The update info from electron-updater.
 * @param {function(Object)} onProgress Called with { percent }.
 */
exports.download = async function(info, onProgress){
    const file = zipFile(info)
    if(file == null){
        throw new Error(`Release ${info.version} has no zip for ${process.arch}`)
    }
    const dir = path.join(os.tmpdir(), `meridian-update-${crypto.randomBytes(4).toString('hex')}`)
    await fs.ensureDir(dir)
    try {
        const zip = path.join(dir, 'update.zip')
        // net.fetch goes through the launcher's proxy settings.
        const res = await net.fetch(`${RELEASES}/v${info.version}/${file.url}`)
        if(!res.ok){
            throw new Error(`Download failed: HTTP ${res.status}`)
        }
        const total = Number(res.headers.get('content-length')) || file.size || 0
        const hash = crypto.createHash('sha512')
        const out = fs.createWriteStream(zip)
        const reader = res.body.getReader()
        let received = 0
        for(;;){
            const { done, value } = await reader.read()
            if(done) break
            hash.update(value)
            if(!out.write(value)){
                await new Promise(resolve => out.once('drain', resolve))
            }
            received += value.length
            if(total > 0){
                onProgress({ percent: Math.min(100, received / total * 100) })
            }
        }
        await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()))
        if(file.sha512 && hash.digest('base64') !== file.sha512){
            throw new Error('The downloaded update is corrupted (sha512 mismatch)')
        }

        // ditto keeps the bundle's symlinks, permissions and signature.
        const unpacked = path.join(dir, 'app')
        await new Promise((resolve, reject) => {
            child_process.execFile('/usr/bin/ditto', ['-x', '-k', zip, unpacked], err => err ? reject(err) : resolve())
        })
        const name = (await fs.readdir(unpacked)).find(n => n.endsWith('.app'))
        if(name == null){
            throw new Error('The update has no app inside')
        }
        await fs.remove(zip)
        staged = { dir, app: path.join(unpacked, name) }
    } catch(err) {
        await fs.remove(dir).catch(() => {})
        throw err
    }
}

/**
 * Quit, swap the app for the downloaded one and open it. The old app is kept
 * aside until the new one is in place, and put back if the copy fails.
 */
exports.install = function(){
    if(staged == null){
        throw new Error('No update downloaded')
    }
    const script = path.join(staged.dir, 'install.sh')
    fs.writeFileSync(script, [
        '#!/bin/sh',
        'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
        'rm -rf "$OLD.old"',
        'if mv "$OLD" "$OLD.old"; then',
        '  if ditto "$NEW" "$OLD"; then rm -rf "$OLD.old"; else rm -rf "$OLD"; mv "$OLD.old" "$OLD"; fi',
        'fi',
        'xattr -dr com.apple.quarantine "$OLD" 2>/dev/null',
        'open "$OLD"',
        'rm -rf "$DIR"',
        ''
    ].join('\n'))
    child_process.spawn('/bin/sh', [script], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PID: String(process.pid), OLD: bundlePath(), NEW: staged.app, DIR: staged.dir }
    }).unref()
    app.quit()
}
