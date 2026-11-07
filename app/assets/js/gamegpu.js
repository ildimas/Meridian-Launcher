/**
 * Which graphics card the game runs on, for machines with an integrated and a
 * discrete one. Linux picks it per launch through environment variables,
 * Windows keeps a per-executable preference in the registry (the one in its
 * graphics settings), macOS decides on its own.
 */
const child_process = require('child_process')
const fs            = require('fs')
const path          = require('path')

const VENDOR = { intel: '0x8086', nvidia: '0x10de' }

const DRM_ROOT = '/sys/class/drm'
const MESA_EGL = '/usr/share/glvnd/egl_vendor.d/50_mesa.json'
const WIN_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const WIN_PREFERENCE = { integrated: 1, discrete: 2 }

/**
 * @param {string} root The folder of DRM devices.
 * @returns {{vendor: string, pci: string, driver: string, bootVga: boolean}[]} The cards Linux sees.
 */
exports.linuxGpus = function(root = DRM_ROOT){
    let cards
    try {
        cards = fs.readdirSync(root).filter(name => /^card\d+$/.test(name))
    } catch {
        return []
    }
    return cards.flatMap(card => {
        try {
            const device = fs.realpathSync(path.join(root, card, 'device'))
            const read = file => fs.readFileSync(path.join(device, file), 'utf8').trim()
            return [{
                vendor: read('vendor'),
                pci: path.basename(device),
                driver: path.basename(fs.realpathSync(path.join(device, 'driver'))),
                bootVga: fs.existsSync(path.join(device, 'boot_vga')) && read('boot_vga') === '1'
            }]
        } catch {
            // Not a physical card.
            return []
        }
    })
}

/**
 * Tell the cards apart. Intel's integrated graphics sit on the first PCI bus;
 * Windows doesn't say the bus, so there every Intel card counts as integrated.
 * An AMD card is the integrated one next to an NVIDIA card, or next to another
 * AMD card when it's the one the machine boots on.
 *
 * @param {{vendor: string, pci?: string, bootVga?: boolean}[]} gpus The cards.
 * @returns {{integrated: Object, discrete: Object} | null} The two cards, null without a choice between them.
 */
exports.classify = function(gpus){
    const isIntelIntegrated = gpu => gpu.vendor === VENDOR.intel && (gpu.pci == null || gpu.pci.startsWith('0000:00:'))
    const hasIntelIntegrated = gpus.some(isIntelIntegrated)
    const hasNvidia = gpus.some(gpu => gpu.vendor === VENDOR.nvidia)
    const isIntegrated = gpu => {
        if(gpu.vendor === VENDOR.nvidia) return false
        if(gpu.vendor === VENDOR.intel) return isIntelIntegrated(gpu)
        return !hasIntelIntegrated && (hasNvidia || gpu.bootVga === true)
    }
    const integrated = gpus.find(isIntegrated)
    const discrete = gpus.find(gpu => !isIntegrated(gpu))
    return integrated != null && discrete != null ? { integrated, discrete } : null
}

/**
 * @returns {Promise<{integrated: Object, discrete: Object} | null>} This machine's two cards, null without a choice between them.
 */
exports.detect = async function(){
    if(process.platform === 'linux'){
        return exports.classify(exports.linuxGpus())
    }
    if(process.platform === 'win32'){
        const { app } = require('@electron/remote')
        const info = await app.getGPUInfo('basic')
        return exports.classify(info.gpuDevice.map(gpu => ({ vendor: `0x${gpu.vendorId.toString(16).padStart(4, '0')}` })))
    }
    return null
}

/**
 * @param {'auto' | 'integrated' | 'discrete'} choice The card to use.
 * @param {{integrated: Object, discrete: Object} | null} gpus The machine's cards.
 * @returns {Object} The environment that selects the card on Linux.
 */
exports.linuxEnv = function(choice, gpus){
    const gpu = gpus?.[choice]
    if(gpu == null){
        return {}
    }
    // NVIDIA's own driver offloads; everything else goes through Mesa.
    if(gpu.driver === 'nvidia'){
        return { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' }
    }
    return {
        DRI_PRIME: `pci-${gpu.pci.replace(/[:.]/g, '_')}`,
        __GLX_VENDOR_LIBRARY_NAME: 'mesa',
        __NV_PRIME_RENDER_OFFLOAD: '0',
        __VK_LAYER_NV_optimus: 'non_NVIDIA_only',
        ...(fs.existsSync(MESA_EGL) ? { __EGL_VENDOR_LIBRARY_FILENAMES: MESA_EGL } : {})
    }
}

/**
 * @param {'auto' | 'integrated' | 'discrete'} choice The card to use.
 * @param {string} javaExe The executable the game runs in.
 * @returns {string[]} Arguments for reg.exe to store the choice; auto removes it.
 */
exports.windowsRegArgs = function(choice, javaExe){
    if(WIN_PREFERENCE[choice] == null){
        return ['delete', WIN_KEY, '/v', javaExe, '/f']
    }
    return ['add', WIN_KEY, '/v', javaExe, '/t', 'REG_SZ', '/d', `GpuPreference=${WIN_PREFERENCE[choice]};`, '/f']
}

/**
 * Prepare the choice for a launch.
 *
 * @param {'auto' | 'integrated' | 'discrete'} choice The card to use.
 * @param {string} javaExe The executable the game runs in.
 * @returns {Object} Environment variables the game needs.
 */
exports.applyChoice = function(choice, javaExe){
    if(process.platform === 'linux'){
        return exports.linuxEnv(choice, exports.classify(exports.linuxGpus()))
    }
    if(process.platform === 'win32'){
        // Removing a value that isn't there only fails quietly.
        child_process.spawnSync('reg', exports.windowsRegArgs(choice, javaExe), { windowsHide: true, timeout: 5000 })
    }
    return {}
}
