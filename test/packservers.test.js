const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const PackServers = require('../app/assets/js/packservers')
const ServerList = require('../app/assets/js/serverlist')

const { TAG } = ServerList
const str = value => ({ type: TAG.String, value })
const entry = (name, ip, extra = []) => [['name', str(name)], ['ip', str(ip)], ...extra]
const serversDat = servers => ServerList.writeNbt({ name: '', tag: { type: TAG.Compound, value: [
    ['servers', { type: TAG.List, value: { type: TAG.Compound, items: servers } }]
] } })

test('addresses split into host and port, and print as the game shows them', () => {
    assert.deepEqual(PackServers.parseAddress('play.example'), { host: 'play.example', port: 25565 })
    assert.deepEqual(PackServers.parseAddress(' play.example:25570 '), { host: 'play.example', port: 25570 })
    assert.deepEqual(PackServers.parseAddress('[2001:db8::1]:25570'), { host: '2001:db8::1', port: 25570 })
    assert.deepEqual(PackServers.parseAddress('2001:db8::1'), { host: '2001:db8::1', port: 25565 })
    assert.equal(PackServers.formatAddress({ host: 'play.example', port: 25565 }), 'play.example')
    assert.equal(PackServers.formatAddress({ host: '2001:db8::1', port: 25570 }), '[2001:db8::1]:25570')
})

test('the list: the pack\'s server first, then the game\'s list without repeats or hidden ones', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-packservers-'))
    const own = { name: 'Aero', address: 'aero.example' }
    assert.deepEqual(await PackServers.list(dir, own), [
        { name: 'Aero', host: 'aero.example', port: 25565, address: 'aero.example', icon: null, pack: true }
    ], 'no servers.dat yet')
    await fs.writeFile(path.join(dir, 'servers.dat'), serversDat([
        entry('Friends', 'friends.example:25570'),
        entry('Aeronautics', 'AERO.example:25565', [['icon', str('aWNvbg==')]]),
        entry('Realms', 'hidden.example', [['hidden', { type: TAG.Byte, value: 1 }]]),
        entry('Again', 'friends.example:25570'),
        entry('', '')
    ]))
    const list = await PackServers.list(dir, own)
    assert.deepEqual(list.map(s => [s.name, s.address, s.icon, s.pack]), [
        ['Aeronautics', 'aero.example', 'aWNvbg==', true],
        ['Friends', 'friends.example:25570', null, false]
    ])
    assert.deepEqual((await PackServers.list(dir, null)).map(s => s.name), ['Friends', 'Aeronautics'])
    await fs.writeFile(path.join(dir, 'servers.dat'), 'broken')
    assert.deepEqual((await PackServers.list(dir, null)), [])
    await fs.remove(dir)
})

test('a message of the day loses its formatting and keeps its lines', () => {
    assert.equal(PackServers.motdText('§aWelcome §lhome\n  §7second line '), 'Welcome home\nsecond line')
    assert.equal(PackServers.motdText({ text: '', extra: [{ text: 'Meridian', color: 'gold' }, ' · ', { text: 'Aero', extra: [{ text: '!' }] }] }), 'Meridian · Aero!')
    assert.equal(PackServers.motdText({ translate: 'multiplayer.status.unknown' }), 'multiplayer.status.unknown')
    assert.equal(PackServers.motdText(null), '')
})

test('players: real names with their ids, sorted, messages left out', () => {
    assert.deepEqual(PackServers.players({ players: { sample: [
        { name: 'm1ghtyymc', id: '069a79f4-44e9-4726-a5be-fca90e38aaf5' },
        { name: '§6Join our Discord!', id: '00000000-0000-0000-0000-000000000000' },
        { name: 'Alex', id: 'not-a-uuid' },
        { name: '.BedrockSteve', id: '00000000-0000-0000-0009-01f3b9e1d6a4' },
        { name: 'alex', id: 'whatever' }
    ] } }), [
        { name: '.BedrockSteve', id: '0000000000000000000901f3b9e1d6a4' },
        { name: 'Alex', id: null },
        { name: 'm1ghtyymc', id: '069a79f444e94726a5befca90e38aaf5' }
    ])
    assert.deepEqual(PackServers.players({}), [])
    assert.equal(PackServers.avatarUrl({ name: 'Alex', id: null }, 56), 'https://mc-heads.net/avatar/Alex/56')
    assert.equal(PackServers.avatarUrl({ name: 'x', id: 'abc' }), 'https://mc-heads.net/avatar/abc/32')
})

test('icons: the server\'s own, else the one the game saved', () => {
    assert.equal(PackServers.iconUrl('data:image/png;base64,QUJD\n', null), 'data:image/png;base64,QUJD')
    assert.equal(PackServers.iconUrl('javascript:alert(1)', 'QUJD'), 'data:image/png;base64,QUJD')
    assert.equal(PackServers.iconUrl(null, 'not base64!'), null)
    assert.equal(PackServers.iconUrl(undefined, undefined), null)
})

test('ping reports what the server says, or null', async () => {
    const answer = async (protocol, host, port) => {
        assert.deepEqual([protocol, host, port], [47, 'aero.example', 25570])
        return { players: { online: 2, max: 20, sample: [{ name: 'Alex', id: '069a79f444e94726a5befca90e38aaf5' }] },
            description: { text: '§bAero' }, version: { name: '§fNeoForge 1.21.1' }, favicon: 'data:image/png;base64,QUJD' }
    }
    const status = await PackServers.ping({ host: 'aero.example', port: 25570 }, answer)
    assert.equal(status.online, 2)
    assert.equal(status.max, 20)
    assert.deepEqual(status.players, [{ name: 'Alex', id: '069a79f444e94726a5befca90e38aaf5' }])
    assert.equal(status.motd, 'Aero')
    assert.equal(status.version, 'NeoForge 1.21.1')
    assert.equal(status.favicon, 'data:image/png;base64,QUJD')
    assert.ok(status.latency >= 0)
    assert.equal(await PackServers.ping({ host: 'x', port: 1 }, async () => { throw new Error('refused') }), null)
})
