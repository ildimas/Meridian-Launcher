'use strict'
// Whether a tiling compositor manages the window. It moves, sizes and closes
// windows itself (keybindings), so the frame's minimize, maximize and close
// buttons have nothing to do there.
//
// Hyprland sets HYPRLAND_INSTANCE_SIGNATURE for every program it starts;
// XDG_CURRENT_DESKTOP also covers programs started through a session manager.
const desktops = (process.env.XDG_CURRENT_DESKTOP || '').split(':')

module.exports = process.platform === 'linux'
    && (process.env.HYPRLAND_INSTANCE_SIGNATURE != null || desktops.includes('Hyprland'))
