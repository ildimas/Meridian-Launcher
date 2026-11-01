/**
 * Preloaded (--require) into helios-core's download process, like
 * proxychild.js. helios-core downloads 15 files at a time; big packs are
 * thousands of small files, where the time goes to round trips, not bytes,
 * so more at once makes them much faster.
 */
const { createRequire } = require('module')

// Files downloaded at once.
const DOWNLOADS = 32

// The fastq helios-core itself loads, patched before it does.
const fastq = createRequire(require.resolve('helios-core'))('fastq')
const promise = fastq.promise
fastq.promise = function(...args){
    // Only DownloadEngine's queue: promise(worker, 15).
    if(args.length === 2 && typeof args[0] === 'function' && args[1] === 15){
        args[1] = DOWNLOADS
    }
    return promise.apply(this, args)
}

// helios-core reports a failed download as "Error during request.", with no
// url or file, and nothing at all for disk errors (ENOSPC, EACCES). Report
// what failed, where it was going and why; landing.js shows it to the player.
const HELIOS_DIST = require('path').dirname(require.resolve('helios-core'))
const { FullRepairReceiver } = require(require('path').join(HELIOS_DIST, 'dl', 'receivers', 'FullRepairReceiver.js'))
const parseError = FullRepairReceiver.prototype.parseError
FullRepairReceiver.prototype.parseError = async function(err){
    const summary = await parseError.call(this, err).catch(() => undefined)
        || String(err?.message ?? err)
    return summary + '\n' + describeError(err, this.assets).join('\n')
}

/**
 * @param {Error} err The error the download process failed with.
 * @param {Array.<Object>} assets The assets queued for download.
 * @returns {Array.<string>} One line per detail, for the player and the log.
 */
function describeError(err, assets){
    const lines = []
    const url = err?.options?.url?.toString() || err?.request?.requestUrl?.toString()
    if(url){
        lines.push(`URL: ${url}`)
        const asset = assets?.find(a => a.url === url)
        if(asset != null){
            lines.push(`File: ${asset.path}`)
            lines.push(`Expected: ${asset.size} bytes, ${asset.algo} ${asset.hash}`)
        }
    }
    const res = err?.response
    if(res != null){
        lines.push(`HTTP: ${res.statusCode} ${res.statusMessage || ''}`.trimEnd())
        for(const header of ['server', 'content-type', 'content-length', 'location', 'cf-ray']){
            if(res.headers?.[header] != null){
                lines.push(`  ${header}: ${res.headers[header]}`)
            }
        }
        if(typeof res.body === 'string' && res.body.length > 0){
            lines.push(`  body: ${res.body.slice(0, 300).replace(/\s+/g, ' ')}`)
        }
    }
    if(err?.name === 'TimeoutError' && err.event){
        lines.push(`Timeout: ${err.event} (${err.timings?.phases?.total ?? '?'} ms)`)
    }
    if(err?.code){
        lines.push(`Code: ${err.code}${err.syscall ? ` (${err.syscall})` : ''}`)
    }
    if(err?.path && err.path !== url){
        lines.push(`Path: ${err.path}`)
    }
    const proxy = process.env.CUSTOM_LAUNCHER_PROXY
    if(proxy){
        try {
            const { type, host, port } = JSON.parse(proxy)
            lines.push(`Proxy: ${type}://${host}:${port}`)
        } catch(_err) {
            // No proxy details then.
        }
    }
    lines.push(`Queued: ${assets?.length ?? 0} files`)
    if(err?.stack){
        lines.push('', ...err.stack.split('\n').slice(0, 8))
    }
    return lines
}

// helios-core downloads over a file in place, truncating it before the first
// byte arrives: a download that failed (no network) left that pack file
// empty. The old files are moved aside first, and put back when the download
// doesn't complete.
//
// Without network, files that are all on disk but differ from the
// distribution (a config the game rewrites on every run) can't be fetched
// again; they stay as they are and the game starts on them. A missing file
// still fails the launch.
const fs = require('fs')
const { LoggerUtil } = require('helios-core')
const ASIDE = '.meridian-old'
const download = FullRepairReceiver.prototype.download
FullRepairReceiver.prototype.download = async function(message){
    const kept = this.assets.filter(asset => moveAside(asset.path))
    try {
        await download.call(this, message)
    } catch(err) {
        for(const asset of kept){
            fs.renameSync(asset.path + ASIDE, asset.path)
        }
        const offline = err?.name === 'RequestError' || err?.name === 'TimeoutError'
        if(!offline || kept.length < this.assets.length){
            throw err
        }
        const log = LoggerUtil.getLogger('DownloadChild')
        log.warn(`Unable to download (${err.code || err.message}); every file is on disk, keeping them:`)
        for(const asset of this.assets){
            log.warn(`  ${asset.path}`)
        }
        process.send({ response: 'downloadComplete' })
        return
    }
    for(const asset of kept){
        fs.rmSync(asset.path + ASIDE, { force: true })
    }
}

/**
 * Move a file out of the way of its download.
 *
 * @param {string} file The file's path.
 * @returns {boolean} Whether there was a file.
 */
function moveAside(file){
    try {
        fs.renameSync(file, file + ASIDE)
        return true
    } catch {
        return false
    }
}
