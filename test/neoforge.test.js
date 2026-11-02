const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { HeliosDistribution } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')
const LocalPacks = require('../app/assets/js/localpacks')
const ServerLoader = require('../app/assets/js/serverloader')
const ForgeInstaller = require('../app/assets/js/forgeinstaller')
const LoaderRuntime = require('../app/assets/js/loaderruntime')
const AdmZip = require('adm-zip')

// ProcessBuilder's settings and proxy live in Electron; exercise command
// construction in Node with only those two application boundaries replaced.
const configPath = require.resolve('../app/assets/js/configmanager')
const proxyPath = require.resolve('../app/assets/js/proxymanager')
const config = {
    getInstanceDirectory: () => path.join(os.tmpdir(), 'meridian-test', 'instances'),
    getCommonDirectory: () => path.join(os.tmpdir(), 'meridian-test', 'common'),
    getMaxRAM: () => '4G', getMinRAM: () => '2G', getJVMOptions: () => [],
    getAutoConnect: () => false, getProxy: () => ({ enabled: false }),
    // The game window of the pack being launched (configmanager.getGameWindow).
    getGameWindow: () => ({ resWidth: 1280, resHeight: 720, fullscreen: false })
}
const savedConfig = require.cache[configPath]
const savedProxy = require.cache[proxyPath]
require.cache[configPath] = { exports: config }
require.cache[proxyPath] = { exports: { getGameArgs: () => [] } }
const ProcessBuilder = require('../app/assets/js/processbuilder')
if(savedConfig) require.cache[configPath] = savedConfig
else delete require.cache[configPath]
if(savedProxy) require.cache[proxyPath] = savedProxy
else delete require.cache[proxyPath]

function distribution(common = config.getCommonDirectory(), instances = config.getInstanceDirectory()){
    return new HeliosDistribution({ version: '1', servers: [{
        id: 'neo', name: 'Neo', address: 'localhost:25565', minecraftVersion: '1.21.1',
        javaOptions: { supported: '>=21.x', suggestedMajor: 21 },
        modules: [{
            id: 'net.neoforged.fancymodloader:loader:4.0.44', name: 'NeoForge Loader', type: 'ForgeHosted',
            artifact: { path: 'net/neoforged/fancymodloader/loader/4.0.44/loader-4.0.44.jar' },
            subModules: [
                { id: 'neoforge-21.1.250', type: 'VersionManifest', artifact: {} },
                { id: 'net.neoforged:neoforge:21.1.250:client', type: 'Library', classpath: false, artifact: {} },
                { id: 'cpw.mods:bootstraplauncher:2.0.2', type: 'Library', artifact: {} }
            ]
        },
        { id: 'demo', type: 'File', artifact: { path: 'mods/demo.jar' } },
        { id: 'optional', type: 'File', artifact: { path: 'mods/optional.jar.disabled' } }]
    }] }, common, instances)
}

function builder(mainClass = 'cpw.mods.bootstraplauncher.BootstrapLauncher'){
    const server = distribution().servers[0]
    return new ProcessBuilder(server, {
        id: '1.21.1', assets: '17', type: 'release', libraries: [],
        arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}'] }
    }, {
        id: 'neoforge-21.1.250', mainClass,
        arguments: {
            jvm: ['-DlibraryDirectory=${library_directory}', '-DlegacyClassPath=${library_directory}/a.jar${classpath_separator}${library_directory}/b.jar', '-DignoreList=${version_name}'],
            game: ['--fml.neoForgeVersion', '21.1.250']
        }
    }, { displayName: 'Player', uuid: 'uuid', accessToken: 'token', type: 'offline' }, '1.1.0')
}

test('Studio bootstrap library is labeled with the NeoForge version manifest', () => {
    const server = distribution().servers[0]
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'NeoForge 21.1.250')
    server.modules[0].subModules[0].rawModule.id = 'neoforge-21.1.251-beta'
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'NeoForge 21.1.251-beta')
    server.modules[0].subModules = []
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'NeoForge')
})

test('loader labels preserve Forge, legacy NeoForge, Fabric, Quilt, local and vanilla packs', () => {
    for(const [id, type, mc, expected] of [
        ['net.minecraftforge:forge:1.20.1-47.2.0', 'ForgeHosted', '1.20.1', 'Forge 47.2.0'],
        ['net.neoforged:forge:1.20.1-47.1.106', 'ForgeHosted', '1.20.1', 'NeoForge 47.1.106'],
        ['net.neoforged:neoforge:21.1.250', 'ForgeHosted', '1.21.1', 'NeoForge 21.1.250'],
        ['net.fabricmc:fabric-loader:0.16.0', 'Fabric', '1.21.1', 'Fabric 0.16.0'],
        ['org.quiltmc:quilt-loader:0.26.0-beta.1', 'Fabric', '1.21.1', 'Quilt 0.26.0-beta.1']
    ]){
        const server = distribution().servers[0]
        const module = server.modules[0]
        module.rawModule.type = type
        module.rawModule.id = id
        module.mavenComponents = module.resolveMavenComponents()
        module.subModules = []
        server.rawServer.minecraftVersion = mc
        assert.equal(ServerLoader.getLabel(server, 'Vanilla'), expected)
    }
    const server = distribution().servers[0]
    server.rawServer.local = { loader: 'neoforge', loaderVersion: '21.1.250' }
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'NeoForge 21.1.250')
    server.rawServer.local = { loader: 'vanilla' }
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'Vanilla')
    delete server.rawServer.local
    server.modules = []
    assert.equal(ServerLoader.getLabel(server, 'Vanilla'), 'Vanilla')
})

test('Studio files validate to the shared runtime and instance mods paths and load the hosted manifest', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-neo-'))
    t.after(() => fs.remove(root))
    const common = path.join(root, 'common')
    const distro = distribution(common, path.join(root, 'instances'))
    const server = distro.servers[0]
    assert.equal(LocalPacks.isVanilla(server), false)
    assert.equal(server.effectiveJavaOptions.suggestedMajor, 21)
    assert.equal(server.effectiveJavaOptions.supported, '>=21.x')
    const manifestModule = server.modules[0].subModules[0]
    const manifest = builder().modManifest
    const body = JSON.stringify(manifest)
    manifestModule.rawModule.artifact.MD5 = crypto.createHash('md5').update(body).digest('hex')
    await fs.outputFile(manifestModule.getPath(), body)
    LocalPacks.patchIndexProcessor(DistributionIndexProcessor)
    const processor = new DistributionIndexProcessor(common, distro, 'neo')
    const missing = (await processor.validate(async () => {})).distribution
    assert.ok(missing.some(m => m.path === server.modules[0].getPath()))
    assert.ok(missing.some(m => m.path === path.join(root, 'instances', 'neo', 'mods', 'demo.jar')))
    assert.ok(missing.some(m => m.path.endsWith('optional.jar.disabled')))
    assert.ok(!missing.some(m => m.path === manifestModule.getPath()))
    assert.deepEqual(await processor.loadModLoaderVersionJson(), manifest)
    for(const asset of missing) await fs.outputFile(asset.path, 'downloaded')
    await processor.postDownload()
    await fs.remove(server.modules[0].getPath())
    await assert.rejects(processor.postDownload(), /files failed verification/)
})

test('NeoForge BootstrapLauncher keeps Minecraft and processor outputs off the classpath', () => {
    const pb = builder()
    const cp = pb.classpathArg([], os.tmpdir())
    assert.ok(cp.includes(pb.server.modules[0].getPath()))
    assert.ok(cp.includes(pb.server.modules[0].subModules[2].getPath()))
    assert.ok(!cp.includes(pb.server.modules[0].subModules[1].getPath()))
    assert.ok(!cp.includes(path.join(pb.commonDir, 'versions', '1.21.1', '1.21.1.jar')))
    const mods = pb.resolveModConfiguration({}, pb.server.modules)
    assert.deepEqual(mods.fMods, [])
    assert.deepEqual(pb.constructModList(mods.fMods), [])
})

test('hosted NeoForge distributions download a missing universal jar without adding it to the classpath', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-neo-repair-'))
    t.after(() => fs.remove(root))
    const raw = structuredClone(distribution().rawDistribution)
    const repaired = LocalPacks.mergeInto(raw, root)
    LocalPacks.mergeInto(repaired, root)
    const modules = repaired.servers[0].modules[0].subModules
    const id = 'net.neoforged:neoforge:21.1.250:universal'
    assert.equal(modules.filter(m => m.id === id).length, 1)
    const universal = modules.find(m => m.id === id)
    assert.equal(universal.classpath, false)
    assert.equal(universal.artifact.url, 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.250/neoforge-21.1.250-universal.jar')
    const content = 'downloaded'
    await fs.outputJson(path.join(root, 'common', 'loader-metadata', universal.artifact.path + '.json'), {
        url: universal.artifact.url, size: Buffer.byteLength(content),
        MD5: crypto.createHash('md5').update(content).digest('hex')
    })
    const distro = new HeliosDistribution(repaired, path.join(root, 'common'), path.join(root, 'instances'))
    const processor = new DistributionIndexProcessor(path.join(root, 'common'), distro, 'neo')
    const missing = (await processor.validate(async () => {})).distribution
    const asset = missing.find(m => m.id === id)
    assert.ok(asset)
    assert.equal(asset.path, path.join(root, 'common', 'libraries', universal.artifact.path))
    assert.equal(asset.size, Buffer.byteLength(content))
    assert.match(asset.hash, /^[a-f0-9]{32}$/)
    await fs.outputFile(asset.path, content)
    assert.ok(!(await processor.validate(async () => {})).distribution.some(m => m.id === id))
    await fs.outputFile(asset.path, 'corrupt')
    assert.ok((await processor.validate(async () => {})).distribution.some(m => m.id === id))
    const pb = builder()
    pb.server = distro.servers[0]
    assert.ok(!pb.classpathArg([], os.tmpdir()).includes(asset.path))
    LocalPacks.mergeInto(repaired, root)
    assert.equal(modules.filter(m => m.id === id).length, 1)
})

test('NeoForge direct Client entrypoint receives the Minecraft jar in its classpath', () => {
    const pb = builder('net.neoforged.fml.startup.Client')
    pb.server.rawServer.minecraftVersion = '26.1.2'
    pb.vanillaManifest.id = '26.1.2'
    const minecraftJar = path.join(pb.commonDir, 'versions', '26.1.2', '26.1.2.jar')
    const args = pb.constructJVMArguments([], os.tmpdir())
    assert.ok(args[args.indexOf('-cp') + 1].split(path.delimiter).includes(minecraftJar))
    assert.ok(args.includes('net.neoforged.fml.startup.Client'))
    const forge = builder()
    assert.ok(!forge.classpathArg([], os.tmpdir()).includes(path.join(forge.commonDir, 'versions', '1.21.1', '1.21.1.jar')))
})

test('NeoForge runtime completion supports multiple versions and manifest-only Studio loaders', () => {
    for(const version of ['20.4.251', '21.1.250', '21.11.38-beta', '26.1.2.75']){
        for(const declaration of [
            { id: `neoforge-${version}`, type: 'VersionManifest' },
            { id: `net.neoforged:neoforge:${version}:client`, type: 'Library' },
            { id: `net.neoforged:neoforge:${version}`, type: 'ForgeHosted' }
        ]){
            const server = { modules: [{ id: 'net.neoforged.fancymodloader:loader:4.0.44', type: 'ForgeHosted', subModules: [declaration] }] }
            LoaderRuntime.complete(server)
            LoaderRuntime.complete(server)
            const deps = server.modules[0].subModules.filter(m => m.id.endsWith(':universal'))
            assert.equal(deps.length, 1)
            assert.equal(deps[0].id, `net.neoforged:neoforge:${version}:universal`)
            assert.equal(deps[0].classpath, false)
        }
    }
    for(const type of ['Fabric', 'Library', 'File']){
        const server = { modules: [{ id: 'neoforge-21.1.250', type }] }
        const before = structuredClone(server)
        LoaderRuntime.complete(server)
        assert.deepEqual(server, before)
    }
    const supplied = { id: 'net.neoforged:neoforge:21.1.250:universal', type: 'Library', artifact: { url: 'https://example.invalid/publisher.jar', MD5: 'publisher-checksum' } }
    const server = { modules: [{ id: 'net.neoforged:neoforge:21.1.250:client', type: 'ForgeHosted' }, supplied] }
    const before = structuredClone(server)
    LoaderRuntime.complete(server)
    assert.deepEqual(server, before)
})

test('runtime metadata is checked, cached for offline launches, and network failures stop verification', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-runtime-'))
    t.after(() => fs.remove(root))
    const raw = LoaderRuntime.complete({ modules: [{ id: 'net.neoforged:neoforge:21.1.250:client', type: 'ForgeHosted', artifact: {} }] })
    const distro = new HeliosDistribution({ version: '1', servers: [{ ...raw, id: 'neo', address: 'localhost:25565', minecraftVersion: '1.21.1' }] }, root, root)
    const modules = distro.servers[0].modules
    let requests = 0
    const http = {
        get: () => ({ text: async () => { requests++; return '0123456789abcdef0123456789abcdef\n' } }),
        head: async () => { requests++; return { headers: { 'content-length': '1234' } } }
    }
    await LoaderRuntime.prepare(modules, root, http)
    assert.equal(requests, 2)
    const artifact = modules[0].subModules[0].rawModule.artifact
    assert.equal(artifact.size, 1234)
    assert.equal(artifact.MD5, '0123456789abcdef0123456789abcdef')
    const offline = { get: () => { throw new Error('offline') }, head: () => { throw new Error('offline') } }
    await LoaderRuntime.prepare(modules, root, offline)
    await fs.remove(path.join(root, 'loader-metadata'))
    await assert.rejects(LoaderRuntime.prepare(modules, root, offline), /offline/)
    await assert.rejects(LoaderRuntime.prepare(modules, root, {
        get: () => ({ text: async () => '<html>not a checksum</html>' }),
        head: http.head
    }), /Invalid runtime library metadata/)
})

test('NeoForge launch expands manifest JVM paths and repeated launches do not accumulate arguments', () => {
    const pb = builder()
    const original = structuredClone(pb.vanillaManifest)
    const first = pb._constructJVMArguments113([], os.tmpdir())
    const second = pb._constructJVMArguments113([], os.tmpdir())
    assert.deepEqual(second, first)
    assert.deepEqual(pb.vanillaManifest, original)
    assert.ok(first.includes(`-DlibraryDirectory=${pb.libPath}`))
    assert.ok(first.includes(`-DlegacyClassPath=${pb.libPath}/a.jar${path.delimiter}${pb.libPath}/b.jar`))
    assert.ok(first.includes('-DignoreList=neoforge-21.1.250'))
    assert.ok(first.includes(pb.modManifest.mainClass))
    assert.ok(first.includes('--fml.neoForgeVersion'))
    assert.ok(!first.some(arg => typeof arg === 'string' && arg.includes('${')))
    assert.ok(!first.includes('--fml.modLists'))
})

test('Nebula NeoForge conditional arguments resolve on Windows, macOS and Linux without mutating manifests', t => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    t.after(() => Object.defineProperty(process, 'platform', platform))
    for(const [host, mojang, separator] of [['win32', 'windows', ';'], ['darwin', 'osx', ':'], ['linux', 'linux', ':']]){
        Object.defineProperty(process, 'platform', { ...platform, value: host })
        const pb = builder()
        pb.modManifest.arguments.jvm.push(
            { rules: [{ action: 'allow', os: { name: mojang } }], value: ['-p', '${library_directory}/a.jar${classpath_separator}${library_directory}/b.jar'] },
            { rules: [{ action: 'allow', os: { name: 'other' } }], value: '-DwrongOS=true' },
            { rules: [{ action: 'allow' }, { action: 'disallow', os: { name: mojang } }], value: '-Dexcluded=true' },
            { rules: [{ action: 'disallow', os: { name: mojang } }, { action: 'allow' }], value: '-DlastRule=true' }
        )
        pb.modManifest.arguments.game.push(
            { rules: [{ action: 'allow', os: { name: mojang } }], value: ['--loader-version', '${version_name}'] },
            '--libraries', '${library_directory}'
        )
        pb.vanillaManifest.arguments.jvm.push('-Dpaths=${natives_directory}/one${classpath_separator}${natives_directory}/two')
        pb.vanillaManifest.arguments.game.push('--version', '${version_name}')
        pb.vanillaManifest.arguments.game.push({ rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}'] })
        const original = structuredClone({ vanilla: pb.vanillaManifest, loader: pb.modManifest })
        const fullscreen = t.mock.method(config, 'getGameWindow', () => ({ resWidth: 1280, resHeight: 720, fullscreen: true }))
        const nativeDir = path.join(os.tmpdir(), 'neo natives')
        const args = pb.constructJVMArguments([], nativeDir)
        assert.ok(args.includes(`${pb.libPath}/a.jar${separator}${pb.libPath}/b.jar`))
        assert.ok(args.includes(`-Dpaths=${nativeDir}/one${separator}${nativeDir}/two`))
        assert.ok(args.includes('-DlastRule=true'))
        assert.ok(!args.includes('-DwrongOS=true'))
        assert.ok(!args.includes('-Dexcluded=true'))
        assert.equal(args[args.indexOf('--loader-version') + 1], pb.modManifest.id)
        assert.equal(args[args.indexOf('--version') + 1], pb.server.rawServer.id)
        assert.equal(args[args.indexOf('--libraries') + 1], pb.libPath)
        assert.ok(args.includes('--fullscreen'))
        assert.ok(args.every(arg => typeof arg === 'string' && !arg.includes('${')))
        assert.ok(args[args.indexOf('-cp') + 1].includes(separator))
        assert.deepEqual({ vanilla: pb.vanillaManifest, loader: pb.modManifest }, original)
        assert.deepEqual(pb.constructJVMArguments([], nativeDir), args)
        fullscreen.mock.restore()
    }
})

test('NeoForge argument rules match OS version, architecture and disabled features', t => {
    const release = os.release()
    const pb = builder()
    pb.modManifest.arguments.jvm.push(
        { rules: [{ action: 'allow', os: { version: `^${release.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, arch: `^${process.arch}$` } }], value: '-DmatchingHost=true' },
        { rules: [{ action: 'allow', os: { version: '^not-this-release$' } }], value: '-DwrongVersion=true' },
        { rules: [{ action: 'allow', os: { arch: '^not-this-arch$' } }], value: '-DwrongArch=true' },
        { rules: [{ action: 'allow', features: { is_demo_user: false } }], value: '-DfullGame=true' },
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '-Ddemo=true' }
    )
    t.mock.method(config, 'getGameWindow', () => ({ resWidth: 1280, resHeight: 720, fullscreen: false }))
    const args = pb.constructJVMArguments([], os.tmpdir())
    assert.ok(args.includes('-DmatchingHost=true'))
    assert.ok(args.includes('-DfullGame=true'))
    for(const excluded of ['-DwrongVersion=true', '-DwrongArch=true', '-Ddemo=true']) assert.ok(!args.includes(excluded))
})

test('Forge and NeoForge imports retain profile-only runtime jars and replace corrupt cached libraries', async t => {
    for(const [loader, mc, version, group] of [
        ['neoforge', '1.21.1', '21.1.250', 'net.neoforged'],
        ['forge', '1.20.1', '47.2.0', 'net.minecraftforge']
    ]){
        await t.test(loader, async t => {
            const commonDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-loader-import-'))
            t.after(() => fs.remove(commonDir))
            await fs.outputJson(path.join(commonDir, 'versions', mc, `${mc}.json`), {})
            await fs.outputFile(path.join(commonDir, 'versions', mc, `${mc}.jar`), 'vanilla')
            const fullVersion = loader === 'forge' ? `${mc}-${version}` : version
            const universalPath = `${group.replaceAll('.', '/')}/${loader}/${fullVersion}/${loader}-${fullVersion}-universal.jar`
            const loaderPath = 'net/neoforged/fancymodloader/loader/4.0.44/loader-4.0.44.jar'
            const content = Buffer.from('universal jar')
            const library = (name, path) => ({ name, downloads: { artifact: { path, url: `https://example.invalid/${path}` } } })
            const universal = library(`${group}:${loader}:${fullVersion}:universal`, universalPath)
            universal.downloads.artifact.sha1 = crypto.createHash('sha1').update(content).digest('hex')
            const manifest = {
                id: `${loader}-${fullVersion}`,
                libraries: [library('net.neoforged.fancymodloader:loader:4.0.44', loaderPath)],
                arguments: { jvm: [], game: [] }
            }
            const zip = new AdmZip()
            zip.addFile('version.json', Buffer.from(JSON.stringify(manifest)))
            zip.addFile('install_profile.json', Buffer.from(JSON.stringify({ json: '/version.json', libraries: [universal], processors: [] })))
            zip.addFile(`maven/${universalPath}`, content)
            zip.addFile(`maven/${loaderPath}`, Buffer.from('loader jar'))
            await fs.outputFile(path.join(commonDir, 'libraries', universalPath), 'corrupt cached jar')
            const result = await ForgeInstaller.install({ loader, minecraft: mc, version }, {
                commonDir, onProgress(){},
                download: async (_urls, dest) => fs.outputFile(dest, zip.toBuffer()),
                runAll: async jobs => { for(const job of jobs) await job() }
            })
            const module = result.modules[0].subModules.find(m => m.id === universal.name)
            assert.ok(module, 'profile-only universal must be retained for launches after import')
            assert.equal(module.classpath, false)
            assert.equal(module.artifact.path, universalPath)
            assert.match(module.artifact.MD5, /^[a-f0-9]{32}$/)
            assert.deepEqual(await fs.readFile(path.join(commonDir, 'libraries', universalPath)), content)
        })
    }
})
