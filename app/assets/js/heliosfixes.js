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

// Java 8 for Apple Silicon. helios-core installs Corretto there, and Corretto 8
// for macOS aarch64 turns its JIT off seconds into every pre-1.13 version
// ("CodeCache is full. Compiler has been disabled." with the cache nearly
// empty), leaving the game interpreted and slow for the rest of the session.
// Azul Zulu 8 and Liberica 8 run the same packs without it; Zulu is also what
// Prism Launcher suggests for Java 8 on these Macs.
const ZULU_API = 'https://api.azul.com/metadata/v1/zulu/packages/'
// Used when the Azul API can't be reached.
const ZULU8_ARM64 = {
    name: 'zulu8.96.0.205-ca-jre8.0.504-macosx_aarch64.tar.gz',
    download_url: 'https://cdn.azul.com/zulu/bin/zulu8.96.0.205-ca-jre8.0.504-macosx_aarch64.tar.gz',
    size: 40158500,
    sha256_hash: '2bf60d7d93268a4f37b3ec5e8b710ccab240e7217966e557939d4c39fc72a9cd'
}

function isAppleSilicon(){
    return process.platform === 'darwin' && process.arch === 'arm64'
}

/**
 * @param {Object} details A JVM as filterApplicableJavaPaths describes it.
 * @returns {boolean} Whether it's a Corretto 8 on Apple Silicon.
 */
function isBrokenJava8(details){
    return isAppleSilicon() && details.semver.major === 8 && /amazon/i.test(details.vendor ?? '')
}

/**
 * The latest Zulu 8 JRE for Apple Silicon, as helios-core's latestOpenJDK
 * describes a download.
 *
 * @param {Object} JavaGuard helios-core's JavaGuard module.
 * @param {string} dataDir The launcher's data directory.
 */
async function latestZulu8(JavaGuard, dataDir){
    const { join } = require('path')
    const got = require('got')
    const { LoggerUtil } = require('helios-core')
    const query = new URLSearchParams({
        java_version: '8',
        os: 'macos',
        arch: 'aarch64',
        archive_type: 'tar.gz',
        java_package_type: 'jre',
        javafx_bundled: 'false',
        crac_supported: 'false',
        latest: 'true',
        release_status: 'ga',
        availability_types: 'CA',
        certifications: 'tck',
        page_size: '1'
    })
    let pkg = ZULU8_ARM64
    try {
        const [found] = await got(`${ZULU_API}?${query}`, { timeout: { request: 15000 } }).json()
        if(found != null){
            pkg = await got(ZULU_API + found.package_uuid, { timeout: { request: 15000 } }).json()
        }
    } catch(err) {
        LoggerUtil.getLogger('HeliosFixes').warn(`Azul API unavailable, using ${pkg.name}.`, err)
    }
    return {
        url: pkg.download_url,
        size: pkg.size,
        id: pkg.name,
        hash: pkg.sha256_hash,
        algo: 'sha256',
        path: join(JavaGuard.getLauncherRuntimeDir(dataDir), pkg.name)
    }
}

/**
 * On Apple Silicon, install Zulu instead of Corretto for Java 8, and don't
 * pick or keep a Corretto 8: an already selected one fails validation, so
 * the launcher scans again and offers to install Zulu.
 *
 * Patch before anything destructures helios-core/java: its exports read
 * through to these.
 *
 * @param {Object} JavaGuard helios-core's JavaGuard module.
 */
exports.patchJavaGuard = function(JavaGuard){
    if(JavaGuard.heliosFixesPatched){
        return
    }
    JavaGuard.heliosFixesPatched = true

    // helios-core's own, but without the Corretto 8s.
    JavaGuard.discoverBestJvmInstallation = async function(dataDir, semverRange){
        const paths = await JavaGuard.getValidatableJavaPaths(dataDir)
        const details = JavaGuard.filterApplicableJavaPaths(await JavaGuard.resolveJvmSettings(paths), semverRange)
            .filter(d => !isBrokenJava8(d))
        JavaGuard.rankApplicableJvms(details)
        return details.length > 0 ? details[0] : null
    }

    const validateSelectedJvm = JavaGuard.validateSelectedJvm
    JavaGuard.validateSelectedJvm = async function(...args){
        const details = await validateSelectedJvm.apply(this, args)
        return details != null && isBrokenJava8(details) ? null : details
    }

    const latestOpenJDK = JavaGuard.latestOpenJDK
    JavaGuard.latestOpenJDK = async function(major, dataDir, distribution){
        if(isAppleSilicon() && Number(major) === 8){
            return latestZulu8(JavaGuard, dataDir)
        }
        return latestOpenJDK.call(this, major, dataDir, distribution)
    }
}
