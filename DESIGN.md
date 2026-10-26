---
name: Meridian
description: Tinted Glass Geode — basalt ground, violet-tinted frosted glass, one amethyst accent, calcite type.
colors:
  amethyst-900: "#24133a"
  amethyst-800: "#3b1d5c"
  amethyst-700: "#5a2f8a"
  amethyst-600: "#7d4fbf"
  amethyst-500: "#a07ae0"
  amethyst-300: "#c9b0f5"
  amethyst-100: "#ece2ff"
  accent-ink: "#160c26"
  basalt-0: "#07060a"
  basalt-1: "#0f0d14"
  basalt-2: "#19161f"
  glass: "rgba(24, 19, 33, 0.58)"
  glass-strong: "rgba(18, 14, 25, 0.82)"
  glass-sunk: "rgba(6, 5, 9, 0.38)"
  line: "rgba(236, 226, 255, 0.11)"
  line-strong: "rgba(236, 226, 255, 0.2)"
  text-1: "#f4f0fa"
  text-2: "rgba(236, 230, 248, 0.74)"
  text-3: "rgba(236, 230, 248, 0.56)"
  ok: "#63d69e"
  warn: "#f2c46b"
  danger: "#f2727a"
typography:
  hero:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 650
    letterSpacing: "0.08em"
rounded:
  s: "8px"
  m: "12px"
  l: "18px"
spacing:
  gutter: "32px"
  dock-gap: "12px"
components:
  button-crystal:
    backgroundColor: "{colors.amethyst-500}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.m}"
    height: "50px"
    padding: "0 30px"
  button-ghost:
    textColor: "{colors.text-2}"
    rounded: "{rounded.s}"
    padding: "8px 14px"
  glass-pod:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.l}"
    height: "64px"
  chip:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.text-1}"
    height: "26px"
---

# Design System: Meridian

## Overview

**Tinted Glass Geode.** The launcher is drawn from Minecraft's own tinted glass and amethyst geodes. The background art is the cave and the UI is glass held up in front of it. Panels are violet-tinted frosted glass over a near-black basalt ground. One amethyst accent marks the primary action and the current selection. Text is calcite white in three strengths.

This is an Operate surface. A friend opens it, checks the selected server, and presses Play. Expression lives in the materials (the glass, the faceted Play slab, the amethyst progress bar, the diamond selection marker). Layout and controls stay familiar.

The source of truth is the `:root` block at the top of `app/assets/css/launcher.css`. To rebrand, change the `--amethyst-*` ramp there and in `branding/generate.mjs`.

## Colors

- **Amethyst ramp (`--amethyst-900` … `--amethyst-100`):** the only hue. `--accent` (500) fills primary buttons, toggles, the slider and progress. `--accent-hi` (300) is for accent text and links. `--accent-soft` tints selected rows and nav items.
- **Basalt (`--basalt-*`):** the ground behind everything, and the window background.
- **Glass (`--glass`, `--glass-strong`, `--glass-sunk`):** `glass` for floating pods and chips, `glass-strong` for dialogs, sheets and the news panel, `glass-sunk` for rows and inputs set into a surface.
- **Calcite text:** `--text-1` for content, `--text-2` for descriptions, `--text-3` for labels and inactive navigation. Never use a pure gray.
- **Status:** `--ok`, `--warn` and `--danger` appear only for real states (update available, main-server star, errors).

**Rule: one hue.** Any new colour must come from the amethyst ramp or a status token. Brand colours for social icons appear only on hover.

## Typography

Hanken Grotesk (variable, OFL, bundled in `app/assets/fonts/`) is the only family.

- **Hero (44 / 800 / -0.035em):** the selected server's name only.
- **Title (19–22 / 700):** dialog, sheet and settings-tab headings.
- **Body (13.5 / 400 / 1.55):** descriptions and article text. Keep the measure ≤ 68ch.
- **Label (10.5 / 650 / +0.08em / uppercase):** dock labels such as "Server" and "Mojang". Labels sit above their value, never beside it.
- **Numbers** (player count, percent, page counter) use `font-variant-numeric: tabular-nums`.

## Layout

The landing view at the default 980×552:

- **Upper area:** a grid. The brand block (logo and name) sits top-left. The selected-server hero is anchored bottom-left. The account pill and icon rail sit top-right.
- **Dock:** 96px tall, 32px left gutter, 24px right gutter, 12px gaps. It holds three pods: status (left), news (centre, borderless) and server + Play (right).
- **News:** the news panel slides up into the space above the dock. The news button stays in the dock and its arrow flips to "close".
- **Settings:** a 210px glass sidebar plus a content column. Rows span 88% of the column.

The layout scales by growing the gaps; nothing reflows. It has been checked at 980×552 and 1280×760.

## Elevation & Depth

Two layers sit above the ground.

1. **Glass:** `backdrop-filter: blur(20px) saturate(150%)`, a 1px `--line` border, a top sheen (`inset 0 1px 0 rgba(255,255,255,.07)`) and `--shadow-float`.
2. **Dialogs and sheets:** a dimmed scrim, with the `#main` content blurred 6px behind.

Shadows always have an offset and a soft blur. There are no glows and no text-shadow halos. The only coloured shadow sits under the crystal button.

## Shapes

- **Radii:** 8px for small controls and nav items, 12px for buttons, rows and avatars, 18px for pods, dialogs and sheets.
- **Pills:** reserved for chips and toggles.
- **The diamond:** a 7px square rotated 45°, in `--accent`. It marks the current selection (settings nav, "Selected server") and nothing else.

## Components

- **Crystal button** (`.crystalButton`, Play, Continue, Select, Done, dialog acknowledge): a vertical amethyst gradient with a hard 118° facet highlight and dark `--accent-ink` uppercase label. On hover it lifts 1px and brightens. When pressed it darkens slightly. When disabled it is desaturated at 60% opacity. Use one per view.
- **Ghost button** (`.ghostButton`, Cancel, Dismiss): `--text-2` text that gains a `--glass-hover` fill on hover.
- **Glass pod** (`.glass`, dock pods, account pill, icon rail): see Elevation.
- **Rows** (server and account listings, login options): `--glass-sunk` with a `--line` border. When selected they take `--accent-soft` and `--accent-line`.
- **Chips** (`.heroChip`, server version): 26px pills. They hide themselves when empty.
- **Progress:** a 6px track whose value fills with an amethyst gradient. Faceted stripes drift across it while it is downloading.
- **Status dot:** a 9px circle with a ring. JS sets its colour and an `Online` / `Degraded` / `Down` / `Unknown` label.
- **Focus:** a 2px `--accent-hi` outline, offset 3px, on every control (`:focus-visible`).

## Do's and Don'ts

- **Do** keep new screens on glass over the background. Never paint an opaque full-screen fill.
- **Do** put brand-specific copy in `app/assets/lang/_custom.toml` and brand art in `branding/`.
- **Don't** add a second accent hue, gradient text, glow halos, or coloured side borders on cards.
- **Don't** use unicode bullets or emoji as icons. Draw them with CSS or SVG.
- **Don't** animate layout properties. Motion is 150–250ms (`--ease-out`), conveys state only, and respects `prefers-reduced-motion`.


## Pack folders

Folders are created entirely by the user; a new installation has no folders.
The legacy “Servers” and “My packs” system folders are removed when loading old
settings. Custom folders, their order and their assignments are preserved.
Packs from removed folders become unassigned; their files and IDs stay in place.
All user folders can be renamed, reordered and deleted.

Folder names and the position within the folder appear only in the bottom
caption below the selected pack. Group boundary strokes follow the dial arc.
There are no floating folder labels above the tiles. “Show” controls
only the arc. The Play dropdown and switch dialog retain every folder, respecting
existing per-pack hiding. The Play dropdown groups its existing pack rows under
folder headings with icons and no pack counters, in the configured folder order. Empty
groups are omitted. Keyboard navigation and status updates operate on pack rows
only. The dropdown includes a shortcut to folder management.
Folder management has its own settings tab, with packs listed under each folder
and a “Move” menu beside each pack. Headers contain order arrows, a folder icon,
the visibility switch and a collapse action.
Names are edited through the pencil action; pack rows include their icon,
Minecraft version, loader and source. Empty folders show a dashed explanation.
Inputs reserve space for focus outlines inside the scroll area.

Names may contain up to 60 characters. The bottom folder caption stays on one
line, truncates long names and exposes its full text in a tooltip. Covered
neighbouring tiles are hidden. Resizing and showing the dial recalculate tile
positions. Empty folders take no space on the dial.

Names, order, assignments and visibility persist in `packfolders.json` in the
launcher user-data directory, separately from distribution and pack files.

Unassigned packs appear as plain rows after the custom folders in the Play menu,
and under “Packs without a folder” in settings. This is a presentation section,
not a persisted folder. The move menu can assign a pack to a user folder or
return it to “No folder”. When no folders exist, settings explains how to create
the first one. Per-folder pack counters are omitted in the settings cards too.


Studio may supply a versioned `meridian.folders` layout as distribution defaults.
Clients without a local folder file follow those defaults on each distribution
refresh. The first folder edit saves a complete local override; subsequent Studio
updates cannot merge into or replace it. Preexisting files, including empty ones,
are already user-owned. The folder settings explain the current source. See
`docs/studio-folders.md` for the contract and compatibility rules.
