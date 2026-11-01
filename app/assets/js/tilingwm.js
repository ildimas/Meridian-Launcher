'use strict'
// Whether a tiling compositor manages the window. It moves, sizes and closes
// windows itself (keybindings), so the frame's minimize, maximize and close
// buttons have nothing to do there.
//
// Each sets its socket variable for the programs it starts; XDG_CURRENT_DESKTOP
// also covers programs started through a session manager.
const SOCKETS = ['HYPRLAND_INSTANCE_SIGNATURE', 'SWAYSOCK', 'I3SOCK', 'NIRI_SOCKET']
const DESKTOPS = ['Hyprland', 'sway', 'i3', 'niri', 'river']

const desktops = (process.env.XDG_CURRENT_DESKTOP || '').split(':')

module.exports = process.platform === 'linux'
    && (SOCKETS.some(name => process.env[name] != null) || desktops.some(d => DESKTOPS.includes(d)))
