const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Folders = require('../app/assets/js/packfolders')

function fixture(t){
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-folders-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    return dir
}

const packs = [{ id: 'remote' }, { id: 'personal', local: { source: 'import' } }]

test('new installations have no folders and every pack remains unassigned', t => {
    const state = Folders.read(fixture(t))
    assert.deepEqual(state.folders, [])
    const groups = Folders.groups(state, packs)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].unassigned, true)
    assert.equal(groups[0].visible, true)
    assert.equal(groups[0].servers[0], packs[0])
    assert.equal(groups[0].servers[1], packs[1])
})

test('create, rename, assign, visibility and order survive a restart', t => {
    const dir = fixture(t)
    const state = Folders.read(dir)
    const folder = Folders.create(state, '  Friends  ')
    Folders.assign(state, 'remote', folder.id)
    Folders.assign(state, 'temporarily-unavailable', folder.id)
    Folders.rename(state, folder.id, 'Weekend')
    folder.visible = false
    state.folders.unshift(state.folders.pop())
    Folders.write(dir, state)
    const loaded = Folders.read(dir)
    assert.equal(loaded.folders[0].name, 'Weekend')
    assert.equal(loaded.folders[0].visible, false)
    assert.equal(loaded.assignments['temporarily-unavailable'], folder.id)
    const groups = Folders.groups(loaded, packs.map(rawServer => ({ rawServer })))
    assert.equal(groups[0].servers[0].rawServer.id, 'remote')
    assert.deepEqual(groups.filter(f => f.visible).flatMap(f => f.servers).map(s => s.rawServer.id), ['personal'])
    assert.equal(groups.flatMap(f => f.servers).length, 2)
})

test('deleting a folder returns packs to unassigned and preserves other assignments', t => {
    const state = Folders.read(fixture(t))
    const folder = Folders.create(state, 'Together')
    for(const pack of packs) Folders.assign(state, pack.id, folder.id)
    const other = Folders.create(state, 'Other')
    Folders.assign(state, 'other', other.id)
    Folders.remove(state, folder.id)
    assert.deepEqual(Folders.groups(state, packs).find(f => f.unassigned).servers.map(s => s.id), ['remote', 'personal'])
    assert.equal(state.assignments.other, other.id)
    assert.throws(() => Folders.remove(state, 'servers'), /unknownFolder/)
    assert.throws(() => Folders.rename(state, 'local', 'Changed'), /unknownFolder/)
})

test('names are trimmed, bounded, unique, and invalid edits leave state intact', t => {
    const state = Folders.read(fixture(t))
    const folder = Folders.create(state, 'Friends')
    for(const name of ['', '   ', 'a'.repeat(61)]) assert.throws(() => Folders.create(state, name), /invalidName/)
    assert.throws(() => Folders.create(state, ' friends '), /duplicateName/)
    assert.equal(state.folders.length, 1)
    assert.throws(() => Folders.assign(state, 'remote', 'missing'), /unknownFolder/)
    Folders.rename(state, folder.id, ' Friends ')
    assert.equal(folder.name, 'Friends')
})

test('malformed storage falls back safely, dangling assignments become unassigned', t => {
    const dir = fixture(t)
    const file = path.join(dir, 'packfolders.json')
    for(const data of ['invalid json', 'null', '{"folders":{}}']){
        fs.writeFileSync(file, data)
        assert.equal(Folders.read(dir).folders.length, 0)
    }
    fs.writeFileSync(file, JSON.stringify({ folders: [null, { id: 'custom', name: 'Custom' }, { id: 'custom', name: 'Duplicate' }], assignments: { remote: 'deleted' } }))
    const state = Folders.read(dir)
    assert.equal(state.folders.length, 1)
    assert.equal(Folders.groups(state, packs).find(f => f.unassigned).servers[0].id, 'remote')
})

test('pack IDs that are object property names round trip as data', t => {
    const dir = fixture(t)
    const state = Folders.read(dir)
    const folder = Folders.create(state, 'Safe')
    for(const id of ['__proto__', 'constructor', 'toString']) Folders.assign(state, id, folder.id)
    Folders.write(dir, state)
    const loaded = Folders.read(dir)
    assert.equal(Folders.groups(loaded, [{ id: '__proto__' }])[0].servers.length, 1)
    Folders.assign(loaded, '__proto__', null)
    assert.equal(Object.hasOwn(loaded.assignments, '__proto__'), false)
    assert.equal({}.polluted, undefined)
})

test('legacy system folders disappear without changing custom folders or their membership', t => {
    const dir = fixture(t)
    fs.writeFileSync(path.join(dir, 'packfolders.json'), JSON.stringify({
        folders: [{ id: 'servers', name: null, builtin: true, visible: false }, { id: 'custom', name: 'Friends', visible: false }, { id: 'local', name: null, builtin: true }],
        assignments: { remote: 'servers', personal: 'custom', oldLocal: 'local' }
    }))
    const state = Folders.read(dir)
    assert.deepEqual(state.folders, [{ id: 'custom', name: 'Friends', visible: false }])
    assert.equal(state.assignments.personal, 'custom')
    assert.equal(Object.hasOwn(state.assignments, 'remote'), false)
    assert.equal(Object.hasOwn(state.assignments, 'oldLocal'), false)
    assert.equal(Folders.groups(state, packs).find(f => f.unassigned).servers[0].id, 'remote')
    Folders.rename(state, 'custom', 'Renamed')
    Folders.assign(state, 'personal', null)
    assert.equal(Folders.groups(state, packs).find(f => f.unassigned).servers.length, 2)
    Folders.remove(state, 'custom')
    Folders.write(dir, state)
    assert.deepEqual(Folders.read(dir).folders, [])
})
