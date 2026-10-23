/**
 * Fixes to helios-core for Minecraft versions it doesn't expect, applied to
 * its classes at load time. Loaded in the renderer (distromanager.js) and in
 * helios-core's download process (localpackschild.js). No Electron here.
 */

// LWJGL 2 for Apple Silicon, as Prism Launcher ships it: Mojang's natives for
// macOS are Intel only, and helios-core runs an arm64 Java on these Macs, so
// every version before 1.13 failed to load liblwjgl. The arm64 natives are
// built for 2.9.4-nightly-20150209, hence the matching jars.
const LWJGL2_ARM64 = '2.9.4-nightly-20150209'
const LWJGL2_ARM64_LIBS = {
    'org.lwjgl.lwjgl:lwjgl': {
        name: `org.lwjgl.lwjgl:lwjgl:${LWJGL2_ARM64}`,
        downloads: { artifact: {
            path: `org/lwjgl/lwjgl/lwjgl/${LWJGL2_ARM64}/lwjgl-${LWJGL2_ARM64}.jar`,
            sha1: '697517568c68e78ae0b4544145af031c81082dfe',
            size: 1047168,
            url: `https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl/${LWJGL2_ARM64}/lwjgl-${LWJGL2_ARM64}.jar`
        } }
    },
    'org.lwjgl.lwjgl:lwjgl_util': {
        name: `org.lwjgl.lwjgl:lwjgl_util:${LWJGL2_ARM64}`,
        downloads: { artifact: {
            path: `org/lwjgl/lwjgl/lwjgl_util/${LWJGL2_ARM64}/lwjgl_util-${LWJGL2_ARM64}.jar`,
            sha1: 'd51a7c040a721d13efdfbd34f8b257b2df882ad0',
            size: 173887,
            url: `https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl_util/${LWJGL2_ARM64}/lwjgl_util-${LWJGL2_ARM64}.jar`
        } }
    },
    'org.lwjgl.lwjgl:lwjgl-platform': {
        name: `org.lwjgl.lwjgl:lwjgl-platform:${LWJGL2_ARM64}`,
        natives: { osx: 'natives-osx' },
        extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-osx': {
            path: `org/lwjgl/lwjgl/lwjgl-platform/${LWJGL2_ARM64}/lwjgl-platform-${LWJGL2_ARM64}-natives-osx-arm64.jar`,
            sha1: 'eff546c0b319d6ffc7a835652124c18089c67f36',
            size: 488316,
            url: `https://github.com/MinecraftMachina/lwjgl/releases/download/2.9.4-20150209-mmachina.2/lwjgl-platform-${LWJGL2_ARM64}-natives-osx.jar`
        } } }
    },
    'net.java.jinput:jinput-platform': {
        name: 'net.java.jinput:jinput-platform:2.0.5',
        natives: { osx: 'natives-osx' },
        extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-osx': {
            path: 'net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-osx-arm64.jar',
            sha1: '5189eb40db3087fb11ca063b68fa4f4c20b199dd',
            size: 10031,
            url: 'https://github.com/r58Playz/jinput-m1/raw/main/plugins/OSX/bin/jinput-platform-2.0.5.jar'
        } } }
    }
}

/**
 * On Apple Silicon, swap a version's LWJGL 2 for the arm64 build. Versions
 * with LWJGL 3 (1.13+) have arm64 natives of their own and are left alone.
 *
 * @param {Object} versionJson A Mojang version manifest.
 * @returns {Object} The manifest, changed in place.
 */
function useArm64Lwjgl2(versionJson){
    if(process.platform !== 'darwin' || process.arch !== 'arm64' || !Array.isArray(versionJson?.libraries)){
        return versionJson
    }
    const ids = versionJson.libraries.map(l => l.name.split(':').slice(0, 2).join(':'))
    const lwjgl = versionJson.libraries.find(l => l.name.startsWith('org.lwjgl.lwjgl:lwjgl:'))
    if(lwjgl == null || !lwjgl.name.split(':')[2].startsWith('2.')){
        return versionJson
    }
    const seen = new Set()
    versionJson.libraries = versionJson.libraries.flatMap((lib, i) => {
        const swap = LWJGL2_ARM64_LIBS[ids[i]]
        if(swap == null){
            return [lib]
        }
        // 1.4.7 and the like list lwjgl-platform twice, by macOS version.
        if(seen.has(ids[i])){
            return []
        }
        seen.add(ids[i])
        return [structuredClone(swap)]
    })
    return versionJson
}

/**
 * Versions before 1.7 don't log through Log4j, so their version manifest has
 * no logging config to download.
 *
 * Also swaps LWJGL 2 for its arm64 build on Apple Silicon (useArm64Lwjgl2),
 * in the manifest both the download check and the launch read.
 *
 * @param {Function} MojangIndexProcessor helios-core's processor class.
 */
exports.patchMojangIndexProcessor = function(MojangIndexProcessor){
    const proto = MojangIndexProcessor.prototype
    if(proto.heliosFixesPatched){
        return
    }
    proto.heliosFixesPatched = true
    const loadVersionJson = proto.loadVersionJson
    proto.loadVersionJson = async function(...args){
        return useArm64Lwjgl2(await loadVersionJson.apply(this, args))
    }
    const original = proto.validateLogConfig
    proto.validateLogConfig = async function(versionJson, ...args){
        if(versionJson.logging?.client?.file == null){
            return []
        }
        return original.call(this, versionJson, ...args)
    }
}

exports.useArm64Lwjgl2 = useArm64Lwjgl2
