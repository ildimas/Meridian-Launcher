const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ConfigManager asks Electron for its folder: point it at a scratch one.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-packsettings-'))
require.cache[require.resolve('@electron/remote')] = { exports: { app: { getPath: () => userData } } }
const ConfigManager = require('../app/assets/js/configmanager')

const JAVA_21 = { suggestedMajor: 21 }
const RAM = { recommended: 4096, minimum: 2048 }
const G1 = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M']

/**
 * Load a config from before the shared defaults: pack "changed" had its
 * memory raised, pack "untouched" kept what it recommends.
 */
function loadOldConfig(){
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
        settings: { game: { resWidth: 1280, resHeight: 720, fullscreen: false, autoConnect: true, launchDetached: true }, launcher: {} },
        javaConfig: {
            changed: { minRAM: '6G', maxRAM: '6G', executable: '/usr/bin/java', jvmOptions: G1 },
            untouched: { minRAM: '4096M', maxRAM: '4096M', executable: null, jvmOptions: G1 }
        }
    }))
    ConfigManager.load()
    ConfigManager.ensureJavaConfig('changed', JAVA_21, RAM)
    ConfigManager.ensureJavaConfig('untouched', JAVA_21, RAM)
}

beforeEach(loadOldConfig)
after(() => fs.rmSync(userData, { recursive: true, force: true }))

test('an old config keeps what was changed on a pack', () => {
    assert.equal(ConfigManager.getPackOwn('changed', 'memory'), true)
    assert.equal(ConfigManager.getPackOwn('changed', 'jvm'), false)
    assert.equal(ConfigManager.getPackOwn('untouched', 'memory'), false)
    assert.equal(ConfigManager.getMaxRAM('changed'), '6G')
    assert.equal(ConfigManager.getMaxRAM('untouched'), '4096M')
    assert.equal(ConfigManager.getJavaExecutable('changed'), '/usr/bin/java')
})

test('shared memory reaches packs without their own, above their minimum', () => {
    ConfigManager.ensureJavaConfig('big', JAVA_21, { recommended: 6144, minimum: 3072 })
    ConfigManager.setDefaultMemory({ minRAM: '2G', maxRAM: '2560M' })
    assert.equal(ConfigManager.getMaxRAM('changed'), '6G')
    assert.deepEqual([ConfigManager.getMinRAM('untouched'), ConfigManager.getMaxRAM('untouched')], ['2G', '2560M'])
    assert.deepEqual([ConfigManager.getMinRAM('big'), ConfigManager.getMaxRAM('big')], ['3G', '3G'])
    ConfigManager.setDefaultMemory(null)
    assert.equal(ConfigManager.getMaxRAM('big'), '6144M')
})

test('JVM options and the window come from the pack only while it sets them', () => {
    ConfigManager.setDefaultJVMOptions(['-Dshared=1'])
    assert.deepEqual(ConfigManager.getJVMOptions('untouched'), ['-Dshared=1'])
    ConfigManager.setPackOwn('untouched', 'jvm', true)
    ConfigManager.setJVMOptions('untouched', ['-Down=1'])
    assert.deepEqual(ConfigManager.getJVMOptions('untouched'), ['-Down=1'])

    assert.deepEqual(ConfigManager.getGameWindow('untouched'), { resWidth: 1280, resHeight: 720, fullscreen: false })
    ConfigManager.setPackOwn('untouched', 'window', true)
    ConfigManager.setOwnGameWindow('untouched', { resWidth: 800, resHeight: 600, fullscreen: true })
    assert.deepEqual(ConfigManager.getGameWindow('untouched'), { resWidth: 800, resHeight: 600, fullscreen: true })
    assert.deepEqual(ConfigManager.getGameWindow('changed'), { resWidth: 1280, resHeight: 720, fullscreen: false })
})

test('the graphics card comes from the pack only while it sets one', () => {
    assert.equal(ConfigManager.getGameGpu('untouched'), 'auto')
    ConfigManager.setDefaultGpu('discrete')
    assert.equal(ConfigManager.getGameGpu('untouched'), 'discrete')
    ConfigManager.setPackOwn('untouched', 'gpu', true)
    ConfigManager.setOwnGameGpu('untouched', 'integrated')
    assert.equal(ConfigManager.getGameGpu('untouched'), 'integrated')
    assert.equal(ConfigManager.getGameGpu('changed'), 'discrete')
})

test('the choices survive a reload without being migrated again', () => {
    ConfigManager.setPackOwn('changed', 'memory', false)
    ConfigManager.save()
    ConfigManager.load()
    ConfigManager.ensureJavaConfig('changed', JAVA_21, RAM)
    assert.equal(ConfigManager.getPackOwn('changed', 'memory'), false)
    assert.equal(ConfigManager.getMaxRAM('changed'), '4096M')
})
