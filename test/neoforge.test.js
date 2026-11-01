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
    getFullscreen: () => false
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
    await processor.postDownload()
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

test('local NeoForge imports retain the universal jar declared only in the installer profile', async t => {
    const commonDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-neo-import-'))
    t.after(() => fs.remove(commonDir))
    await fs.outputJson(path.join(commonDir, 'versions', '1.21.1', '1.21.1.json'), {})
    await fs.outputFile(path.join(commonDir, 'versions', '1.21.1', '1.21.1.jar'), 'vanilla')
    const universalPath = 'net/neoforged/neoforge/21.1.250/neoforge-21.1.250-universal.jar'
    const loaderPath = 'net/neoforged/fancymodloader/loader/4.0.44/loader-4.0.44.jar'
    const library = (name, path) => ({ name, downloads: { artifact: { path, url: `https://example.invalid/${path}` } } })
    const universal = library('net.neoforged:neoforge:21.1.250:universal', universalPath)
    const version = {
        id: 'neoforge-21.1.250',
        libraries: [library('net.neoforged.fancymodloader:loader:4.0.44', loaderPath)],
        arguments: { jvm: [], game: [] }
    }
    const zip = new AdmZip()
    zip.addFile('version.json', Buffer.from(JSON.stringify(version)))
    zip.addFile('install_profile.json', Buffer.from(JSON.stringify({ json: '/version.json', libraries: [universal], processors: [] })))
    zip.addFile(`maven/${universalPath}`, Buffer.from('universal jar'))
    zip.addFile(`maven/${loaderPath}`, Buffer.from('loader jar'))
    const result = await ForgeInstaller.install({ loader: 'neoforge', minecraft: '1.21.1', version: '21.1.250' }, {
        commonDir, onProgress(){},
        download: async (_urls, dest) => fs.outputFile(dest, zip.toBuffer()),
        runAll: async jobs => { for(const job of jobs) await job() }
    })
    const module = result.modules[0].subModules.find(m => m.id === universal.name)
    assert.ok(module, 'profile-only NeoForge universal must be retained for launches after import')
    assert.equal(module.classpath, false)
    assert.equal(module.artifact.path, universalPath)
    assert.match(module.artifact.MD5, /^[a-f0-9]{32}$/)
})
