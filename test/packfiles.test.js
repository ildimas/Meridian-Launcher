const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { HeliosDistribution } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')
const LocalPacks = require('../app/assets/js/localpacks')
const PackFiles = require('../app/assets/js/packfiles')
const ServerList = require('../app/assets/js/serverlist')

const { TAG } = ServerList
const md5 = data => crypto.createHash('md5').update(data).digest('hex')
const str = value => ({ type: TAG.String, value })
const byte = value => ({ type: TAG.Byte, value })
const server = (name, ip, extra = []) => [['name', str(name)], ['ip', str(ip)], ...extra]
const serversDat = servers => ServerList.writeNbt({ name: '', tag: { type: TAG.Compound, value: [
    ['servers', { type: TAG.List, value: { type: TAG.Compound, items: servers } }]
] } })
const listed = buffer => ServerList.servers(ServerList.readNbt(buffer)).map(s => [
    s.find(([k]) => k === 'name')[1].value, s.find(([k]) => k === 'ip')[1].value
])

test('seed files are the player\'s settings, not the pack\'s rules', () => {
    for(const file of ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'optionsCLP.txt', 'smart_moving_options.txt',
        'Sinrel-options.txt', 'config/sodium-options.json', 'config/iris.properties', 'config/keybindbundles-client.toml',
        'config/Mekanism/client.toml', 'config/NoChatReports/NCR-Client.json', 'config\\jei-client.toml']){
        assert.equal(PackFiles.isSeedPath(file), true, file)
    }
    for(const file of ['config/fancymenu/options.txt', 'config/Mekanism/common.toml', 'config/jei-server.toml',
        'config/clientdetails.toml', 'mods/foo-client.jar', 'kubejs/assets/atm/buttons/options.json', 'servers.dat',
        'config/DistantHorizons.toml', 'resourcepacks/options.txt']){
        assert.equal(PackFiles.isSeedPath(file), false, file)
    }
})

test('a module can opt in or out, and servers.dat is merged', () => {
    const mod = raw => ({ rawModule: { type: 'File', artifact: { path: raw.path }, ...raw } })
    assert.equal(PackFiles.handling(mod({ path: 'options.txt' })), 'seed')
    assert.equal(PackFiles.handling(mod({ path: 'options.txt', meridianSeed: false })), 'sync')
    assert.equal(PackFiles.handling(mod({ path: 'config/rules.toml', meridianSeed: true })), 'seed')
    assert.equal(PackFiles.handling(mod({ path: 'servers.dat' })), 'serverList')
    assert.equal(PackFiles.handling(mod({ path: 'servers.dat', meridianSeed: true })), 'seed')
    assert.equal(PackFiles.handling({ rawModule: { type: 'ForgeMod', artifact: { path: 'options.txt' } } }), 'sync')
})

test('validation leaves seed files on disk alone and checks the pack\'s server list beside the player\'s', async () => {
    LocalPacks.patchIndexProcessor(DistributionIndexProcessor)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-packfiles-'))
    const common = path.join(root, 'common')
    const instances = path.join(root, 'instances')
    const pack = path.join(instances, 'pack')
    const shipped = { options: 'fov:70\n', mod: 'mod', client: 'a = 1\n', rules: 'b = 2\n', servers: serversDat([server('Pack', 'play.example')]) }
    const file = (id, p, data, extra = {}) => ({ id, type: 'File', artifact: { path: p, MD5: md5(data), size: Buffer.byteLength(data), url: `https://example.invalid/${p}` }, ...extra })
    const distro = new HeliosDistribution({ version: '1', servers: [{
        id: 'pack', name: 'Pack', address: 'play.example', minecraftVersion: '1.21.1', modules: [
            file('options', 'options.txt', shipped.options),
            file('missing', 'optionsof.txt', shipped.options),
            file('mod', 'mods/demo.jar', shipped.mod),
            file('client', 'config/demo-client.toml', shipped.client),
            file('forced', 'config/forced-client.toml', shipped.client, { meridianSeed: false }),
            file('rules', 'config/rules.toml', shipped.rules, { meridianSeed: true }),
            file('servers', 'servers.dat', shipped.servers)
        ]
    }] }, common, instances)
    // The player changed every file the pack shipped, and lacks optionsof.txt.
    for(const p of ['options.txt', 'mods/demo.jar', 'config/demo-client.toml', 'config/forced-client.toml', 'config/rules.toml', 'servers.dat']){
        await fs.outputFile(path.join(pack, p), 'changed by the player')
    }
    const processor = new DistributionIndexProcessor(common, distro, 'pack')
    const invalid = []
    await processor.validateModules(distro.getServerById('pack').modules, invalid)
    assert.deepEqual(invalid.map(a => a.id).sort(), ['forced', 'missing', 'mod', 'servers'])
    const servers = invalid.find(a => a.id === 'servers')
    assert.equal(servers.path, path.join(pack, PackFiles.PACK_SERVER_LIST))
    assert.equal(servers.hash, md5(shipped.servers))

    // Once the pack's copy is there, servers.dat no longer needs a download.
    await fs.writeFile(servers.path, shipped.servers)
    const again = []
    await processor.validateModules(distro.getServerById('pack').modules, again)
    assert.deepEqual(again.map(a => a.id).sort(), ['forced', 'missing', 'mod'])
    await fs.remove(root)
})

test('NBT keeps every field it reads', () => {
    const root = { name: '', tag: { type: TAG.Compound, value: [
        ['servers', { type: TAG.List, value: { type: TAG.Compound, items: [
            server('Привет', 'mc.example:25566', [['icon', str('iVBORw0KGgo=')], ['acceptTextures', byte(1)], ['hidden', byte(0)]])
        ] } }],
        ['numbers', { type: TAG.Compound, value: [
            ['s', { type: TAG.Short, value: -2 }], ['i', { type: TAG.Int, value: 70000 }],
            ['l', { type: TAG.Long, value: 1n << 40n }], ['f', { type: TAG.Float, value: 0.5 }],
            ['d', { type: TAG.Double, value: 0.1 }], ['b', { type: TAG.ByteArray, value: Buffer.from([1, 2]) }],
            ['ia', { type: TAG.IntArray, value: [1, -1] }], ['la', { type: TAG.LongArray, value: [2n] }],
            ['empty', { type: TAG.List, value: { type: TAG.End, items: [] } }]
        ] }]
    ] } }
    const written = ServerList.writeNbt(root)
    assert.deepEqual(ServerList.readNbt(written), root)
    assert.deepEqual(ServerList.writeNbt(ServerList.readNbt(written)), written)
    assert.throws(() => ServerList.readNbt(written.subarray(0, 10)), /ends too early/)
})

test('merge: the pack\'s servers lead and follow the pack, the player\'s own stay', () => {
    const player = [
        server('Мой сервер', 'friend.example'),
        server('Old name', 'PLAY.example ', [['icon', str('cached')], ['acceptTextures', byte(1)]]),
        server('Moved away', 'old.example')
    ]
    const pack = [server('Meridian', 'play.example', [['hidden', byte(0)]]), server('Creative', 'creative.example')]
    const merged = ServerList.merge(pack, player, ['play.example', 'old.example'])
    assert.deepEqual(merged.map(s => [s.find(([k]) => k === 'name')[1].value, ServerList.addressOf(s)]), [
        ['Meridian', 'play.example'],
        ['Creative', 'creative.example'],
        ['Мой сервер', 'friend.example']
    ])
    // The player's icon and resource pack choice stay; the pack's extra field joins.
    const main = new Map(merged[0])
    assert.equal(main.get('icon').value, 'cached')
    assert.equal(main.get('acceptTextures').value, 1)
    assert.equal(main.get('hidden').value, 0)
    assert.equal(main.get('ip').value, 'play.example')
})

test('syncPack merges servers.dat over launches and never throws', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-serverlist-'))
    const packDir = path.join(root, 'instances', 'pack')
    const make = data => new HeliosDistribution({ version: '1', servers: [{
        id: 'pack', name: 'Pack', address: 'play.example', minecraftVersion: '1.21.1', modules: [
            { id: 'servers', type: 'File', artifact: { path: 'servers.dat', MD5: md5(data), size: data.length, url: 'https://example.invalid/servers.dat' } }
        ]
    }] }, path.join(root, 'common'), path.join(root, 'instances')).getServerById('pack')
    const log = { info(){}, warn(){} }
    const target = path.join(packDir, 'servers.dat')
    const packCopy = path.join(packDir, PackFiles.PACK_SERVER_LIST)

    // No pack copy yet (offline first launch): nothing happens.
    const v1 = serversDat([server('Meridian', 'play.example')])
    assert.equal(await ServerList.syncPack(make(v1), packDir, log), false)

    // First launch: the pack's list becomes the player's.
    await fs.outputFile(packCopy, v1)
    assert.equal(await ServerList.syncPack(make(v1), packDir, log), true)
    assert.deepEqual(listed(await fs.readFile(target)), [['Meridian', 'play.example']])
    assert.equal(await ServerList.syncPack(make(v1), packDir, log), false, 'unchanged on the next launch')

    // The player adds a server in game; the pack moves to a new address.
    await fs.writeFile(target, serversDat([server('Meridian', 'play.example'), server('Friend', 'friend.example')]))
    const v2 = serversDat([server('Meridian', 'new.example')])
    await fs.writeFile(packCopy, v2)
    assert.equal(await ServerList.syncPack(make(v2), packDir, log), true)
    assert.deepEqual(listed(await fs.readFile(target)), [['Meridian', 'new.example'], ['Friend', 'friend.example']])

    // A broken servers.dat is replaced by the pack's list, not fatal.
    await fs.writeFile(target, 'not nbt')
    assert.equal(await ServerList.syncPack(make(v2), packDir, log), true)
    assert.deepEqual(listed(await fs.readFile(target)), [['Meridian', 'new.example']])

    // A broken pack copy leaves the player's file as it is.
    await fs.writeFile(packCopy, 'not nbt either')
    const before = await fs.readFile(target)
    assert.equal(await ServerList.syncPack(make(v2), packDir, log), false)
    assert.deepEqual(await fs.readFile(target), before)
    await fs.remove(root)
})
