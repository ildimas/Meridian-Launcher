/**
 * What to tell a player when the game stops by itself with an error: whether
 * it crashed, the crash report or the end of the game's log, a likely cause
 * for the usual cases, and a report to copy or share.
 *
 * The game's own output is kept as it runs (tail()), so a crash before the
 * game writes any file still has something to show. Reports never carry the
 * player's access token, and the home directory is shortened to ~.
 */
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

/** Lines of the game's output kept for the report. */
const TAIL_LINES = 400
/** Lines of it shown in the window. */
exports.SHOWN_LINES = 60
/** The largest report shared or copied, in characters. */
const MAX_REPORT = 2000000

/** Signals the system sends to stop a program on purpose, not a crash. */
const QUIT_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP'])

/**
 * Keep the last lines of a game's stdout and stderr.
 *
 * @param {ChildProcess} child The game process.
 * @param {number} [max] Lines to keep.
 * @returns {{ lines: () => Array.<string> }}
 */
exports.tail = function(child, max = TAIL_LINES){
    const kept = []
    const pending = { stdout: '', stderr: '' }
    const take = stream => data => {
        const lines = (pending[stream] + data).split(/\r?\n/)
        pending[stream] = lines.pop()
        for(const line of lines){
            kept.push(line)
        }
        if(kept.length > max){
            kept.splice(0, kept.length - max)
        }
    }
    child.stdout?.on('data', take('stdout'))
    child.stderr?.on('data', take('stderr'))
    return {
        lines: () => {
            const rest = [pending.stdout, pending.stderr].filter(Boolean)
            return kept.concat(rest).slice(-max)
        }
    }
}

/**
 * The newest crash report the game wrote since it started: Minecraft's own
 * (crash-reports/crash-*.txt) or the JVM's (hs_err_pid*.log).
 *
 * @param {string} gameDir The pack folder.
 * @param {number} since When the game started (ms since epoch).
 * @returns {Promise.<{ file: string, kind: 'game' | 'jvm' } | null>}
 */
exports.findReport = async function(gameDir, since){
    const candidates = []
    const look = async (dir, test, kind) => {
        let names
        try {
            names = await fs.readdir(dir)
        } catch {
            return
        }
        for(const name of names.filter(test)){
            const file = path.join(dir, name)
            try {
                const stat = await fs.stat(file)
                // A second's grace for file systems that round times.
                if(stat.isFile() && stat.mtimeMs >= since - 1000){
                    candidates.push({ file, kind, time: stat.mtimeMs })
                }
            } catch {
                // Gone since the listing.
            }
        }
    }
    await look(path.join(gameDir, 'crash-reports'), n => /\.txt$/i.test(n), 'game')
    await look(gameDir, n => /^hs_err_pid\d+\.log$/i.test(n), 'jvm')
    candidates.sort((a, b) => b.time - a.time)
    return candidates.length > 0 ? { file: candidates[0].file, kind: candidates[0].kind } : null
}

/**
 * Whether the player asked the game to quit: Minecraft logs "Stopping!" as it
 * shuts down (every version, 1.4 to today).
 *
 * @param {Array.<string>} lines The end of the game's output.
 * @returns {boolean}
 */
exports.quitting = function(lines){
    return lines.some(line => /(?:^|[\]:] )Stopping!\s*$/.test(line))
}

/**
 * Whether the game stopped with an error rather than being closed.
 *
 * A crash report always counts. Otherwise a non-zero exit counts unless the
 * game was already quitting (some packs fail while shutting down after the
 * player closed the window), and so does a signal other than a request to
 * quit (the system killing it for memory, for one).
 *
 * @param {Object} exit
 * @param {number | null} exit.code The exit code.
 * @param {string | null} exit.signal The signal that ended it.
 * @param {boolean} [exit.reported] Whether the game wrote a crash report.
 * @param {boolean} [exit.quitting] Whether the game logged that it was quitting.
 * @returns {boolean}
 */
exports.isCrash = function({ code, signal, reported = false, quitting = false }){
    if(reported){
        return true
    }
    if(signal != null){
        return !QUIT_SIGNALS.has(signal)
    }
    return code != null && code !== 0 && !quitting
}

/**
 * Known causes, matched against the report or the log: the first that
 * matches gives the player a hint (a key under js.landing.crash.hint).
 */
const HINTS = [
    { key: 'outOfMemory', test: /java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime/i },
    { key: 'heap', test: /Could not reserve enough space for (?:object heap|\d+KB object heap)|Invalid (?:maximum|initial) heap size|Initial heap size set to a larger value than the maximum/i },
    { key: 'javaVersion', test: /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|requires Java \d+|Unsupported Java detected|Unrecognized option: --add-opens/i },
    { key: 'graphics', test: /Pixel format not accelerated|GLFW error 6554[23]|WGL: The driver does not appear to support OpenGL|No OpenGL context found|OpenGL 3\.2 or later|Failed to create (?:the )?(?:OpenGL|GL) context|\[(?:atio6axx|atioglxx|amdxc64|nvoglv(?:32|64)|ig\d+icd(?:32|64)|ig7icd(?:32|64)|igxelpicd64)\.dll/i },
    { key: 'mods', test: /Missing or unsupported mandatory dependencies|Mod (?:resolution|loading) (?:failed|has failed)|ModResolutionException|Incompatible mods? found|incompatible mod set|DuplicateModsFoundException|Found a duplicate mod|Mixin apply(?: for mod \S+)? failed|MixinApplyError|InvalidMixinException/i }
]

/**
 * Pick the cause shown first: Minecraft's description and the exception that
 * crashed it, or the last error the log has.
 *
 * @param {string | null} report The crash report's text.
 * @param {Array.<string>} lines The end of the game's output.
 * @returns {{ reason: string | null, hint: string | null }}
 */
exports.summarize = function(report, lines){
    const text = (report || '') + '\n' + lines.join('\n')
    const hint = HINTS.find(h => h.test.test(text))?.key ?? null
    let reason = null
    if(report != null){
        const reportLines = report.split(/\r?\n/)
        const at = reportLines.findIndex(l => /^Description:/.test(l))
        if(at !== -1){
            const description = reportLines[at].replace(/^Description:\s*/, '').trim()
            const exception = reportLines.slice(at + 1).find(l => l.trim().length > 0)?.trim()
            reason = [description, exception].filter(Boolean).join('\n')
        } else {
            // A JVM report: "# EXCEPTION_ACCESS_VIOLATION ..." and the frame it died in.
            const jvm = reportLines.filter(l => /^#\s+(?:[A-Z_]{6,}|Problematic frame:|[CVJj]\s+\[)/.test(l)).slice(0, 3)
            reason = jvm.length > 0 ? jvm.map(l => l.replace(/^#\s+/, '')).join('\n') : null
        }
    }
    if(reason == null){
        const error = [...lines].reverse().find(l => /(?:Exception|Error)(?::|\s*$)|^\s*Caused by:|\bFATAL\b|\/ERROR\]/.test(l))
        reason = error != null ? error.trim() : null
    }
    if(reason != null && reason.length > 600){
        reason = reason.slice(0, 600) + '…'
    }
    return { reason, hint }
}

/**
 * Hide what a report must not carry: the access token and the home folder.
 *
 * @param {string} text The report.
 * @param {Array.<string>} secrets Values to hide (the access token).
 * @returns {string}
 */
exports.redact = function(text, secrets = []){
    let out = text
    for(const secret of secrets.filter(s => typeof s === 'string' && s.length >= 8)){
        out = out.split(secret).join('<hidden>')
    }
    const home = os.homedir()
    if(home && home.length > 1){
        out = out.split(home).join('~')
        if(path.sep === '\\'){
            out = out.split(home.replace(/\\/g, '/')).join('~')
        }
    }
    return out
}

/**
 * The report to copy or share: what ran where, then the crash report, then
 * the end of the game's output.
 *
 * @param {Object} info
 * @param {string} info.pack The pack's name and id.
 * @param {string} info.minecraft The Minecraft version.
 * @param {string} info.launcher The launcher's version.
 * @param {string} [info.java] The Java executable.
 * @param {number | null} info.code The exit code.
 * @param {string | null} info.signal The signal.
 * @param {string | null} info.reportFile The crash report's path.
 * @param {string | null} info.report The crash report's text.
 * @param {Array.<string>} info.lines The end of the game's output.
 * @param {Array.<string>} [info.secrets] Values to hide.
 * @returns {string}
 */
exports.buildReport = function(info){
    const exit = info.signal != null ? `signal ${info.signal}` : `code ${info.code}`
    const parts = [
        `Meridian ${info.launcher} · ${os.type()} ${os.release()} ${os.arch()}`,
        `Pack: ${info.pack} · Minecraft ${info.minecraft}`,
        info.java ? `Java: ${info.java}` : null,
        `Exit: ${exit}`
    ].filter(Boolean)
    if(info.report != null){
        parts.push('', `---- ${path.basename(info.reportFile || 'crash report')} ----`, info.report.trimEnd())
    }
    if(info.lines.length > 0){
        parts.push('', '---- Game output (last lines) ----', info.lines.join('\n'))
    }
    let text = exports.redact(parts.join('\n'), info.secrets)
    if(text.length > MAX_REPORT){
        text = text.slice(0, MAX_REPORT) + '\n…'
    }
    return text
}

/**
 * Upload a report to mclo.gs, the paste service for Minecraft logs, and get
 * its link. Only on the player's request: the log goes to a public site.
 *
 * @param {string} text The report.
 * @param {typeof fetch} [fetchImpl] fetch.
 * @returns {Promise.<string>} The link.
 */
exports.share = async function(text, fetchImpl = fetch){
    const res = await fetchImpl('https://api.mclo.gs/1/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ content: text }).toString(),
        signal: AbortSignal.timeout(20000)
    })
    let data = null
    try {
        data = await res.json()
    } catch {
        // Not JSON: reported below by status.
    }
    if(!res.ok || data?.success !== true || typeof data.url !== 'string'){
        throw new Error(data?.error || `HTTP ${res.status}`)
    }
    return data.url
}

/**
 * Read a crash report, or null.
 *
 * @param {string | null} file The report.
 * @returns {Promise.<string | null>}
 */
exports.readReport = async function(file){
    if(file == null){
        return null
    }
    try {
        const text = await fs.readFile(file, 'utf8')
        return text.length > MAX_REPORT ? text.slice(0, MAX_REPORT) : text
    } catch {
        return null
    }
}
