# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app rendering EJS/HTML/CSS; ships to Windows, macOS x64/arm64, and Linux incl. Arch.)

## Users

A small private group of friends who play modded Minecraft on the owner's servers. They open the launcher, sign in with Microsoft once, pick a server, and press Play. Most sessions are a few seconds of launcher time before the game takes over; the longest dwell is watching download/verify progress after a modpack update.

## Product Purpose

A fork of Helios Launcher that installs and keeps in sync the exact Minecraft version, mod loader (Forge/Fabric), mods, and configs for each of the owner's servers, then joins that server directly. Success: a friend installs once and never has to manage mods by hand.

## Positioning

Private, curated: it lists only this group's 1–3 servers, defined by a self-hosted distribution index (`distribution.json`, generated with Nebula). Not a general-purpose launcher.

## Operating Context

- Desktop window, typically 980×552 default, frameless with custom titlebar (Windows/Linux buttons; macOS traffic lights).
- Screens: welcome (first run), login options / Microsoft login, landing (play), server selection overlay, settings (account, Minecraft, Java, launcher, about, updates), news panel.
- Players usually launch it in the evening alongside Discord.

## Capabilities and Constraints

- Keep all upstream functionality: Microsoft auth, server selection, launch progress, Java management, settings, auto-update, news (RSS), social links, Mojang/Microsoft service status, server player count.
- DOM IDs are bound by `app/assets/js/scripts/*.js`; restyling must preserve IDs and structure the scripts query.
- Strings live in `app/assets/lang/*.toml`.
- Name: Meridian. Logo: compass rose on a navy tile (`branding/logo.svg`). Palette: navy #004477, face #0a508a, mid #6a9ccd, light #b9d3ec, text-on-dark #7db4e6, night ground #021a30. Type: Inter.

## Brand Commitments

- Owner pinned the aesthetic: modern dark UI with glass (blurred translucent) panels, accent colour, rounded cards, smooth transitions.
- Branding is placeholder and must be swappable in one place (name in config/lang, logo/background as files, accent as a CSS token).

## Evidence on Hand

- Upstream Helios backgrounds in `app/assets/images/backgrounds/` (to be replaced by owner art).
- No logo, screenshots, or community content yet; do not invent server names, player counts, or news.

## Product Principles

1. Play is one click away; everything else is secondary.
2. Progress and errors must be legible at a glance during long downloads.
3. Branding is a swap, not a rewrite.
