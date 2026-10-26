const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Folders = require('../app/assets/js/packfolders')

function fixture(t){
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-remote-folders-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    return dir
}
function distro(name = 'From Studio'){
    return {
        version: '1.0.0',
        servers: [{ id: 'remote', name: 'Remote', address: 'example.invalid:25565', minecraftVersion: '1.20.4', version: '1', modules: [] }],
        meridian: { folders: { version: 1, folders: [{ id: 'studio-group', name, visible: true }], assignments: { remote: 'studio-group' } } }
    }
}

test('untouched clients follow Studio changes and removal without creating a local override', t => {
    const dir = fixture(t)
    assert.equal(Folders.read(dir, distro()).folders[0].name, 'From Studio')
    assert.equal(Folders.read(dir, distro('Updated')).folders[0].name, 'Updated')
    const removed = distro()
    removed.meridian.folders = { version: 1, folders: [], assignments: {} }
    assert.deepEqual(Folders.read(dir, removed).folders, [])
    assert.equal(Folders.read(dir, removed).overridden, false)
    assert.equal(fs.existsSync(path.join(dir, 'packfolders.json')), false)
})

test('first edit freezes the full layout and later Studio revisions cannot overwrite it', t => {
    const dir = fixture(t)
    const local = Folders.read(dir, distro())
    Folders.rename(local, 'studio-group', 'My name')
    local.folders[0].visible = false
    const second = Folders.create(local, 'Personal')
    Folders.assign(local, 'remote', second.id)
    local.folders.reverse()
    Folders.write(dir, local)
    const before = fs.readFileSync(path.join(dir, 'packfolders.json'), 'utf8')
    const updated = distro('Renamed remotely')
    updated.meridian.folders.assignments = {}
    updated.servers.push({ id: 'new-pack' })
    const loaded = Folders.read(dir, updated)
    assert.equal(loaded.overridden, true)
    assert.equal(loaded.folders[0].id, second.id)
    assert.equal(loaded.folders[1].name, 'My name')
    assert.equal(loaded.folders[1].visible, false)
    assert.equal(loaded.assignments.remote, second.id)
    assert.equal(Folders.groups(loaded, updated.servers).find(f => f.unassigned).servers[0].id, 'new-pack')
    assert.equal(fs.readFileSync(path.join(dir, 'packfolders.json'), 'utf8'), before)
})

test('deleting every inherited folder or explicitly unassigning a pack stays user-owned', t => {
    const dir = fixture(t)
    const local = Folders.read(dir, distro())
    Folders.assign(local, 'remote', null)
    Folders.write(dir, local)
    assert.equal(Object.hasOwn(Folders.read(dir, distro()).assignments, 'remote'), false)
    Folders.remove(local, 'studio-group')
    Folders.write(dir, local)
    assert.deepEqual(Folders.read(dir, distro()).folders, [])
})

test('preexisting empty and malformed local files are never replaced by Studio', t => {
    const dir = fixture(t)
    for(const data of ['{"folders":[],"assignments":{}}', 'null', 'broken json']){
        fs.writeFileSync(path.join(dir, 'packfolders.json'), data)
        const loaded = Folders.read(dir, distro())
        assert.deepEqual(loaded.folders, [])
        assert.equal(loaded.overridden, true)
        assert.equal(fs.readFileSync(path.join(dir, 'packfolders.json'), 'utf8'), data)
    }
})

test('old distributions and unknown extension versions keep a flat list', t => {
    const dir = fixture(t)
    for(const raw of [{ servers: [] }, { meridian: { folders: { version: 2, folders: [{ id: 'future', name: 'Future' }] } } }]){
        assert.deepEqual(Folders.read(dir, raw).folders, [])
    }
})

test('Studio cannot place a local pack into a remote folder or assign unknown pack IDs', t => {
    const dir = fixture(t)
    const raw = distro()
    raw.servers.push({ id: 'personal', local: {} })
    raw.meridian.folders.assignments.personal = 'studio-group'
    raw.meridian.folders.assignments.missing = 'studio-group'
    const state = Folders.read(dir, raw)
    assert.equal(Object.hasOwn(state.assignments, 'personal'), false)
    assert.equal(Object.hasOwn(state.assignments, 'missing'), false)
    assert.equal(state.assignments.remote, 'studio-group')
})

test('the Helios distribution parser used before folder support ignores the additive extension', () => {
    const { HeliosDistribution } = require('helios-core/common')
    const raw = distro()
    const parsed = new HeliosDistribution(raw, '/tmp/common', '/tmp/instances')
    assert.equal(parsed.servers.length, 1)
    assert.equal(parsed.getServerById('remote').rawServer.name, 'Remote')
    assert.deepEqual(parsed.servers[0].modules, [])
})
