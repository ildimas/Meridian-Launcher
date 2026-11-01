const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')

const MODULE = require.resolve('../app/assets/js/tilingwm')
const CLEAN = ['HYPRLAND_INSTANCE_SIGNATURE', 'SWAYSOCK', 'I3SOCK', 'NIRI_SOCKET', 'XDG_CURRENT_DESKTOP']

// The module reads the environment once, on load: ask a fresh process.
function detect(env){
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CLEAN.includes(k)))
    return execFileSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(MODULE)}))`], { env: { ...base, ...env } }).toString().trim() === 'true'
}

test('tiling compositors are detected', { skip: process.platform !== 'linux' }, () => {
    assert.equal(detect({ HYPRLAND_INSTANCE_SIGNATURE: 'x' }), true)
    assert.equal(detect({ SWAYSOCK: '/run/sway.sock' }), true)
    assert.equal(detect({ NIRI_SOCKET: '/run/niri.sock' }), true)
    assert.equal(detect({ XDG_CURRENT_DESKTOP: 'river' }), true)
    assert.equal(detect({ XDG_CURRENT_DESKTOP: 'Hyprland:wlroots' }), true)
})

test('desktops with their own window decorations are not', { skip: process.platform !== 'linux' }, () => {
    assert.equal(detect({ XDG_CURRENT_DESKTOP: 'GNOME' }), false)
    assert.equal(detect({ XDG_CURRENT_DESKTOP: 'KDE' }), false)
    assert.equal(detect({}), false)
})
