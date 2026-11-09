const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const GameCrash = require('../app/assets/js/gamecrash')

const REPORT = `---- Minecraft Crash Report ----
// Who set us up the TNT?

Time: 2026-11-08 21:14:03
Description: Rendering overlay

java.lang.NullPointerException: Cannot invoke "net.minecraft.class_310.method_1551()" because "client" is null
\tat com.example.mod.Overlay.render(Overlay.java:42)

A detailed walkthrough of the error, its code path and all known details is as follows:
`

const HS_ERR = `#
# A fatal error has been detected by the Java Runtime Environment:
#
#  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb1c2d3e4f, pid=1234, tid=5678
#
# JRE version: OpenJDK Runtime Environment (17.0.8+7) (build 17.0.8+7)
# Problematic frame:
# C  [atio6axx.dll+0x1a3e4f]
#
`

function fakeChild(){
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    return child
}

test('tail keeps whole lines from both streams, the newest last', () => {
    const child = fakeChild()
    const tail = GameCrash.tail(child, 3)
    child.stdout.emit('data', 'one\ntw')
    child.stderr.emit('data', 'err 1\r\n')
    child.stdout.emit('data', 'o\nthree\nfour\nunfinished')
    assert.deepEqual(tail.lines(), ['three', 'four', 'unfinished'])
})

test('a non-zero exit is a crash unless the game was quitting; a report always is', () => {
    assert.equal(GameCrash.isCrash({ code: 0, signal: null }), false)
    assert.equal(GameCrash.isCrash({ code: 1, signal: null }), true)
    assert.equal(GameCrash.isCrash({ code: -1, signal: null }), true)
    assert.equal(GameCrash.isCrash({ code: 1, signal: null, quitting: true }), false)
    assert.equal(GameCrash.isCrash({ code: 0, signal: null, reported: true }), true)
    assert.equal(GameCrash.isCrash({ code: null, signal: 'SIGKILL' }), true)
    assert.equal(GameCrash.isCrash({ code: null, signal: 'SIGTERM' }), false)
    assert.equal(GameCrash.quitting(['[21:00:00] [Render thread/INFO]: Stopping!']), true)
    assert.equal(GameCrash.quitting(['2026-11-08 21:00:00 [INFO] Stopping!']), true)
    assert.equal(GameCrash.quitting(['Stopping!']), true)
    assert.equal(GameCrash.quitting(['[INFO]: Stopping! the server soon']), false)
})

test('findReport takes the newest report written since the game started', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-crash-'))
    const started = Date.now()
    const old = path.join(dir, 'crash-reports', 'crash-2026-01-01_00.00.00-client.txt')
    await fs.outputFile(old, REPORT)
    await fs.utimes(old, new Date(started - 3600e3), new Date(started - 3600e3))
    assert.equal(await GameCrash.findReport(dir, started), null)
    assert.equal(await GameCrash.findReport(path.join(dir, 'missing'), started), null)

    const fresh = path.join(dir, 'crash-reports', 'crash-2026-11-08_21.14.03-client.txt')
    await fs.outputFile(fresh, REPORT)
    assert.deepEqual(await GameCrash.findReport(dir, started), { file: fresh, kind: 'game' })

    const jvm = path.join(dir, 'hs_err_pid1234.log')
    await fs.outputFile(jvm, HS_ERR)
    await fs.utimes(jvm, new Date(started + 5000), new Date(started + 5000))
    assert.deepEqual(await GameCrash.findReport(dir, started), { file: jvm, kind: 'jvm' })
    await fs.remove(dir)
})

test('summarize: the report\'s description and exception, else the log\'s last error', () => {
    assert.deepEqual(GameCrash.summarize(REPORT, []), {
        reason: 'Rendering overlay\njava.lang.NullPointerException: Cannot invoke "net.minecraft.class_310.method_1551()" because "client" is null',
        hint: null
    })
    assert.deepEqual(GameCrash.summarize(HS_ERR, []), {
        reason: 'EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb1c2d3e4f, pid=1234, tid=5678\nProblematic frame:\nC  [atio6axx.dll+0x1a3e4f]',
        hint: 'graphics'
    })
    const log = ['[main/INFO]: Loading', '[main/ERROR]: Failed to load something', 'java.lang.IllegalStateException: boom', '\tat a.b(C.java:1)']
    assert.equal(GameCrash.summarize(null, log).reason, 'java.lang.IllegalStateException: boom')
    assert.deepEqual(GameCrash.summarize(null, ['nothing here']), { reason: null, hint: null })
})

test('summarize recognises the usual causes', () => {
    const hint = line => GameCrash.summarize(null, [line]).hint
    assert.equal(hint('java.lang.OutOfMemoryError: Java heap space'), 'outOfMemory')
    assert.equal(hint('Error occurred during initialization of VM'), null)
    assert.equal(hint('Could not reserve enough space for 8388608KB object heap'), 'heap')
    assert.equal(hint('Invalid maximum heap size: -Xmx99G'), 'heap')
    assert.equal(hint('java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime'), 'javaVersion')
    assert.equal(hint('GLFW error 65542: WGL: The driver does not appear to support OpenGL'), 'graphics')
    assert.equal(hint('org.lwjgl.LWJGLException: Pixel format not accelerated'), 'graphics')
    assert.equal(hint('net.fabricmc.loader.impl.FormattedException: Mod resolution encountered an incompatible mod set!'), 'mods')
    assert.equal(hint('Missing or unsupported mandatory dependencies:'), 'mods')
    assert.equal(hint('org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: Mixin apply for mod foo failed'), 'mods')
})

test('reports hide the access token and the home folder', () => {
    const home = os.homedir()
    const token = 'eyJhbGciOiJIUzI1NiJ9.secret-token-value'
    const text = GameCrash.buildReport({
        pack: 'Meridian (meridian-1.21.1)', minecraft: '1.21.1', launcher: '1.2.0', java: path.join(home, 'java', 'bin', 'java'),
        code: 1, signal: null,
        reportFile: path.join(home, 'pack', 'crash-reports', 'crash.txt'), report: REPORT,
        lines: [`--accessToken ${token}`, `Loading from ${path.join(home, 'pack')}`],
        secrets: [token, undefined, 'short']
    })
    assert.ok(!text.includes(token))
    assert.ok(!text.includes(home))
    assert.match(text, /^Meridian 1\.2\.0 · /)
    assert.match(text, /Pack: Meridian \(meridian-1\.21\.1\) · Minecraft 1\.21\.1/)
    assert.match(text, /Exit: code 1/)
    assert.match(text, /---- crash\.txt ----\n---- Minecraft Crash Report ----/)
    assert.match(text, /--accessToken <hidden>/)
    assert.match(text, /Loading from ~/)
})

test('share posts the report to mclo.gs and returns its link', async () => {
    let request
    const ok = async (url, init) => {
        request = { url, init }
        return { ok: true, status: 200, json: async () => ({ success: true, id: 'abc', url: 'https://mclo.gs/abc' }) }
    }
    assert.equal(await GameCrash.share('a & b', ok), 'https://mclo.gs/abc')
    assert.equal(request.url, 'https://api.mclo.gs/1/log')
    assert.equal(request.init.method, 'POST')
    assert.equal(new URLSearchParams(request.init.body).get('content'), 'a & b')

    const refused = async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: 'Required POST argument \'content\' is empty.' }) })
    await assert.rejects(GameCrash.share('', refused), /content' is empty/)
    const broken = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('not json') } })
    await assert.rejects(GameCrash.share('x', broken), /HTTP 502/)
})
