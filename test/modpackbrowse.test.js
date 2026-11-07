const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ConfigManager asks Electron for its folder: point it at a scratch one.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-modpackbrowse-'))
require.cache[require.resolve('@electron/remote')] = { exports: { app: { getPath: () => userData } } }
const { browseUrl } = require('../app/assets/js/modpackmanager')

after(() => fs.rmSync(userData, { recursive: true, force: true }))

test('the Modrinth link carries the search and the category', () => {
    assert.equal(browseUrl('modrinth'), 'https://modrinth.com/modpacks')
    assert.equal(browseUrl('modrinth', 'all the mods'), 'https://modrinth.com/modpacks?q=all+the+mods')
    assert.equal(browseUrl('modrinth', '', 'technology'), 'https://modrinth.com/modpacks?g=categories%3Atechnology')
})

test('the CurseForge link carries the search', () => {
    assert.equal(browseUrl('curseforge'), 'https://www.curseforge.com/minecraft/modpacks')
    assert.equal(browseUrl('curseforge', 'atm 10', 4471), 'https://www.curseforge.com/minecraft/search?class=modpacks&search=atm+10')
})
