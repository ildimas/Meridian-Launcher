const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const WorldBackups = require('../app/assets/js/worldbackups')

async function setup(){
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-backups-'))
    const packDir = path.join(root, 'instances', 'pack')
    const backupsDir = WorldBackups.backupsDir(path.join(root), 'pack')
    const world = async (name, content) => {
        await fs.outputFile(path.join(packDir, 'saves', name, 'level.dat'), content)
        await fs.outputFile(path.join(packDir, 'saves', name, 'region', 'r.0.0.mca'), content.repeat(10))
        await fs.outputFile(path.join(packDir, 'saves', name, 'session.lock'), 'lock')
    }
    return { root, packDir, backupsDir, world }
}

test('worlds are the folders in saves/ with a level.dat', async () => {
    const { root, packDir, world } = await setup()
    assert.deepEqual(await WorldBackups.worlds(packDir), [])
    await world('Мир', 'a')
    await world('Creative', 'b')
    await fs.ensureDir(path.join(packDir, 'saves', 'not a world'))
    assert.deepEqual(await WorldBackups.worlds(packDir), ['Creative', 'Мир'])
    await fs.remove(root)
})

test('a backup copies every world, reports progress and is listed newest first', async () => {
    const { root, packDir, backupsDir, world } = await setup()
    assert.equal(await WorldBackups.create({ packDir, backupsDir, reason: 'manual' }), null, 'no worlds, no backup')
    await world('Мир', 'first')
    const progress = []
    const first = await WorldBackups.create({ packDir, backupsDir, reason: 'update', from: '1.0.0', to: '1.0.1',
        onProgress: p => progress.push(p), now: new Date(2026, 10, 9, 10, 0, 0) })
    assert.equal(first.id, '2026-11-09_10-00-00')
    assert.deepEqual(first.worlds, ['Мир'])
    assert.equal(first.size, 'first'.length * 11)
    assert.equal(progress.at(-1), 100)
    const copied = path.join(backupsDir, first.id, 'saves', 'Мир')
    assert.equal(await fs.readFile(path.join(copied, 'region', 'r.0.0.mca'), 'utf8'), 'first'.repeat(10))
    assert.equal(await fs.pathExists(path.join(copied, 'session.lock')), false)

    const second = await WorldBackups.create({ packDir, backupsDir, reason: 'manual', now: new Date(2026, 10, 9, 10, 0, 0) })
    assert.equal(second.id, '2026-11-09_10-00-00_2', 'same second, another name')
    const list = await WorldBackups.list(backupsDir)
    assert.deepEqual(list.map(b => b.id), ['2026-11-09_10-00-00_2', '2026-11-09_10-00-00'])
    assert.equal(await WorldBackups.hasUpdateBackup(backupsDir, '1.0.0', '1.0.1'), true)
    assert.equal(await WorldBackups.hasUpdateBackup(backupsDir, '1.0.1', '1.0.2'), false)
    await fs.remove(root)
})

test('a backup cut short leaves nothing listed, and prune clears it', async () => {
    const { root, backupsDir, world } = await setup()
    await world('Мир', 'x')
    await fs.outputFile(path.join(backupsDir, '2026-01-01_00-00-00.partial', 'saves', 'Мир', 'level.dat'), 'half')
    await fs.outputFile(path.join(backupsDir, 'stray', 'file'), 'not a backup')
    assert.deepEqual(await WorldBackups.list(backupsDir), [])
    await WorldBackups.prune(backupsDir)
    assert.equal(await fs.pathExists(path.join(backupsDir, '2026-01-01_00-00-00.partial')), false)
    await fs.remove(root)
})

test('prune keeps the newest update backups and every manual one', async () => {
    const { root, packDir, backupsDir, world } = await setup()
    await world('Мир', 'x')
    for(let i = 0; i < 4; i++){
        await WorldBackups.create({ packDir, backupsDir, reason: 'update', from: `1.${i}`, to: `1.${i + 1}`, now: new Date(2026, 0, 1 + i) })
    }
    await WorldBackups.create({ packDir, backupsDir, reason: 'manual', now: new Date(2025, 0, 1) })
    const removed = await WorldBackups.prune(backupsDir, 2)
    assert.equal(removed.length, 2)
    const left = await WorldBackups.list(backupsDir)
    assert.deepEqual(left.map(b => `${b.reason}:${b.to ?? ''}`), ['update:1.4', 'update:1.3', 'manual:'])
    await fs.remove(root)
})

test('restore puts worlds back and sets the current ones aside, never deleting', async () => {
    const { root, packDir, backupsDir, world } = await setup()
    await world('Мир', 'before')
    await world('Other', 'other')
    const backup = await WorldBackups.create({ packDir, backupsDir, reason: 'manual' })
    // The update ruined the world; Other was deleted by the player.
    await fs.writeFile(path.join(packDir, 'saves', 'Мир', 'level.dat'), 'after')
    await fs.remove(path.join(packDir, 'saves', 'Other'))
    const progress = []
    const result = await WorldBackups.restore({ backupsDir, id: backup.id, packDir, onProgress: p => progress.push(p), now: new Date(2026, 10, 9, 12, 30, 0) })
    assert.deepEqual(result, { restored: ['Other', 'Мир'], setAside: ['Мир-before-restore-2026-11-09_12-30-00'] })
    assert.equal(await fs.readFile(path.join(packDir, 'saves', 'Мир', 'level.dat'), 'utf8'), 'before')
    assert.equal(await fs.readFile(path.join(packDir, 'saves', 'Other', 'level.dat'), 'utf8'), 'other')
    assert.equal(await fs.readFile(path.join(packDir, 'saves', 'Мир-before-restore-2026-11-09_12-30-00', 'level.dat'), 'utf8'), 'after')
    assert.equal(progress.at(-1), 100)
    // The backup itself is untouched and still listed.
    assert.deepEqual((await WorldBackups.list(backupsDir)).map(b => b.id), [backup.id])
    await fs.remove(root)
})

test('remove and restore only take a backup\'s own name', async () => {
    const { root, packDir, backupsDir, world } = await setup()
    await world('Мир', 'x')
    const backup = await WorldBackups.create({ packDir, backupsDir, reason: 'manual' })
    await assert.rejects(WorldBackups.remove(backupsDir, '../pack'), /Not a backup/)
    await assert.rejects(WorldBackups.restore({ backupsDir, id: '../../instances', packDir }), /Not a backup/)
    await WorldBackups.remove(backupsDir, backup.id)
    assert.deepEqual(await WorldBackups.list(backupsDir), [])
    await fs.remove(root)
})

test('a backup the disk can\'t hold isn\'t started', async (t) => {
    const { root, packDir, backupsDir, world } = await setup()
    await world('Мир', 'x')
    t.mock.method(fs, 'statfs', async () => ({ bavail: 10, bsize: 4096 }))
    await assert.rejects(WorldBackups.create({ packDir, backupsDir, reason: 'manual' }), { name: 'NoSpaceError' })
    t.mock.restoreAll()
    assert.deepEqual(await WorldBackups.list(backupsDir), [])
    await fs.remove(root)
})
