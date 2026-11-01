const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const policyPath = require.resolve('../app/assets/js/updatepolicy')
const isDevPath = require.resolve('../app/assets/js/isdev')

let resources
const savedEnv = { ...process.env }

// Both modules read the environment once, on load.
function load(){
    delete require.cache[policyPath]
    delete require.cache[isDevPath]
    return require(policyPath)
}

beforeEach(() => {
    resources = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-resources-'))
    process.resourcesPath = resources
    process.env.ELECTRON_IS_DEV = '0'
    delete process.env.MERIDIAN_DISABLE_UPDATES
})

afterEach(() => {
    fs.removeSync(resources)
    delete process.resourcesPath
    process.env = { ...savedEnv }
})

test('an electron-builder build updates itself', () => {
    fs.writeFileSync(path.join(resources, 'app-update.yml'), 'provider: github\n')
    assert.equal(load().isManagedExternally(), false)
})

test('the system Electron (no app-update.yml) leaves updates to the package manager', () => {
    assert.equal(load().isManagedExternally(), true)
})

test('MERIDIAN_DISABLE_UPDATES=1 turns updates off', () => {
    fs.writeFileSync(path.join(resources, 'app-update.yml'), 'provider: github\n')
    process.env.MERIDIAN_DISABLE_UPDATES = '1'
    assert.equal(load().isManagedExternally(), true)
})

test('development runs keep their own updater handling', () => {
    process.env.ELECTRON_IS_DEV = '1'
    assert.equal(load().isManagedExternally(), false)
})
