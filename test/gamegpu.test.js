const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const GameGpu = require('../app/assets/js/gamegpu')

const INTEL = { vendor: '0x8086', pci: '0000:00:02.0', driver: 'i915', bootVga: true }
const ARC = { vendor: '0x8086', pci: '0000:03:00.0', driver: 'xe', bootVga: false }
const NVIDIA = { vendor: '0x10de', pci: '0000:01:00.0', driver: 'nvidia', bootVga: false }
const NOUVEAU = { ...NVIDIA, driver: 'nouveau' }
const AMD_APU = { vendor: '0x1002', pci: '0000:06:00.0', driver: 'amdgpu', bootVga: true }
const AMD_CARD = { vendor: '0x1002', pci: '0000:03:00.0', driver: 'amdgpu', bootVga: false }

test('a choice needs one integrated and one discrete card', () => {
    assert.equal(GameGpu.classify([]), null)
    assert.equal(GameGpu.classify([INTEL]), null)
    assert.equal(GameGpu.classify([NVIDIA]), null)
    assert.equal(GameGpu.classify([NVIDIA, { ...NVIDIA, pci: '0000:02:00.0' }]), null)
})

test('cards are told apart by vendor and position', () => {
    assert.deepEqual(GameGpu.classify([NVIDIA, INTEL]), { integrated: INTEL, discrete: NVIDIA })
    assert.deepEqual(GameGpu.classify([INTEL, ARC]), { integrated: INTEL, discrete: ARC })
    assert.deepEqual(GameGpu.classify([INTEL, AMD_CARD]), { integrated: INTEL, discrete: AMD_CARD })
    assert.deepEqual(GameGpu.classify([{ ...AMD_APU, bootVga: false }, { ...NVIDIA, bootVga: true }]).discrete, { ...NVIDIA, bootVga: true })
    assert.deepEqual(GameGpu.classify([AMD_CARD, AMD_APU]), { integrated: AMD_APU, discrete: AMD_CARD })
})

test('Windows lists cards without a bus: two AMD cards stay unknown', () => {
    const intel = { vendor: '0x8086' }
    const amd = { vendor: '0x1002' }
    assert.deepEqual(GameGpu.classify([intel, amd]), { integrated: intel, discrete: amd })
    assert.equal(GameGpu.classify([amd, amd]), null)
})

test('Linux reads the cards from sysfs and skips the rest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-gpu-'))
    const device = path.join(root, 'pci', '0000:00:02.0')
    fs.mkdirSync(device, { recursive: true })
    fs.mkdirSync(path.join(root, 'drivers', 'i915'), { recursive: true })
    fs.writeFileSync(path.join(device, 'vendor'), '0x8086\n')
    fs.writeFileSync(path.join(device, 'boot_vga'), '1\n')
    fs.symlinkSync(path.join(root, 'drivers', 'i915'), path.join(device, 'driver'))
    const drm = path.join(root, 'drm')
    fs.mkdirSync(path.join(drm, 'card0'), { recursive: true })
    fs.symlinkSync(device, path.join(drm, 'card0', 'device'))
    fs.mkdirSync(path.join(drm, 'card0-eDP-1'))
    fs.mkdirSync(path.join(drm, 'card1'))
    assert.deepEqual(GameGpu.linuxGpus(drm), [{ vendor: '0x8086', pci: '0000:00:02.0', driver: 'i915', bootVga: true }])
    assert.deepEqual(GameGpu.linuxGpus(path.join(root, 'missing')), [])
    fs.rmSync(root, { recursive: true, force: true })
})

test('Linux environment follows the driver of the chosen card', () => {
    const gpus = { integrated: INTEL, discrete: NVIDIA }
    assert.deepEqual(GameGpu.linuxEnv('auto', gpus), {})
    assert.deepEqual(GameGpu.linuxEnv('discrete', null), {})
    assert.deepEqual(GameGpu.linuxEnv('discrete', gpus), { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' })
    const integrated = GameGpu.linuxEnv('integrated', gpus)
    assert.equal(integrated.DRI_PRIME, 'pci-0000_00_02_0')
    assert.equal(integrated.__GLX_VENDOR_LIBRARY_NAME, 'mesa')
    assert.equal(integrated.__NV_PRIME_RENDER_OFFLOAD, '0')
    assert.equal(GameGpu.linuxEnv('discrete', { integrated: INTEL, discrete: NOUVEAU }).DRI_PRIME, 'pci-0000_01_00_0')
})

test('Windows stores the choice for the Java executable and auto removes it', () => {
    const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
    const java = 'C:\\Java\\bin\\javaw.exe'
    assert.deepEqual(GameGpu.windowsRegArgs('discrete', java), ['add', key, '/v', java, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'])
    assert.deepEqual(GameGpu.windowsRegArgs('integrated', java).slice(-2), ['GpuPreference=1;', '/f'])
    assert.deepEqual(GameGpu.windowsRegArgs('auto', java), ['delete', key, '/v', java, '/f'])
})
