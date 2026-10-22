<p align="center"><img src="build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="app/assets/images/flags/GB.svg" height="12" alt=""> <b>English</b> ·
  <img src="app/assets/images/flags/RU.svg" height="12" alt=""> <a href="docs/readme/README.ru.md">Русский</a> ·
  <img src="app/assets/images/flags/UA.svg" height="12" alt=""> <a href="docs/readme/README.uk.md">Українська</a> ·
  <img src="app/assets/images/flags/BY.svg" height="12" alt=""> <a href="docs/readme/README.be.md">Беларуская</a> ·
  <img src="app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="docs/readme/README.kk.md">Қазақ тілі</a> ·
  <img src="app/assets/images/flags/DE.svg" height="12" alt=""> <a href="docs/readme/README.de.md">Deutsch</a> ·
  <img src="app/assets/images/flags/FR.svg" height="12" alt=""> <a href="docs/readme/README.fr.md">Français</a> ·
  <img src="app/assets/images/flags/ES.svg" height="12" alt=""> <a href="docs/readme/README.es.md">Español</a>
</p>

<p align="center"><b>Modded Minecraft launcher.</b> Pick a server, press Play: Java, the mod loader, mods and configs are installed and kept up to date for you.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>

<p align="center"><img src="docs/images/demo.gif" width="800" alt="Meridian: startup and switching servers with the dial"></p>


---

Meridian is a fork of [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) with a new interface, modpack support and translations. Servers come from a self-hosted distribution index (`distribution.json`, generated with [Nebula](https://github.com/dscalzi/Nebula)), and players can add their own modpacks on top of them.

## Features

* 🔐 **Accounts**
  * Microsoft (OAuth 2.0) and Mojang sign-in, several accounts with quick switching.
  * Offline play under any name, for servers with `online-mode` off.
* 🧭 **Servers**
  * Server dial on the main screen with Minecraft version, pack version and live player count.
  * Files are verified before every launch; missing or corrupted ones are downloaded again.
  * Optional auto-connect to the server once the game starts.
* 📦 **Modpacks**
  * Search and install packs from **Modrinth** and **CurseForge** (CurseForge needs a free API key).
  * Import `.mrpack`, CurseForge `.zip` and Prism / MultiMC exports by drag and drop.
  * Any Minecraft version with **Forge**, **NeoForge**, **Fabric** or **Quilt**.
* 🧩 **Mods and packs**
  * Required, optional and drop-in mods.
  * Shaderpacks and resource packs, switched on and off from settings.
* ☕ **Java**
  * Not required in advance: if a suitable Java isn't found, the launcher installs it.
  * Memory slider, custom executable and JVM arguments.
* 🖼️ **Appearance**
  * Each modpack has its own rotating wallpapers: pack art, your in-game screenshots (F2) or shots from the Photon Shaders gallery, with author credits.
  * Interval and slow motion are configurable; hardware acceleration can be turned off.
* 🌍 **Languages**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. More are in progress.
  * Switches instantly, can follow the system language and set the same language in Minecraft.
* 🌐 **Proxy** — HTTP or SOCKS5 for sign-in and downloads, optionally for the game too.
* 🔄 **Auto-updates** — when a new version is out, the launcher asks whether to download it now or later, installs it and restarts with your settings kept. On macOS this works when the launcher is in Applications.
* 📰 News feed, Mojang service status and Discord Rich Presence.

## Download

Get the installer for your system from [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest).

| Platform | File |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Pre-releases are only offered to players who turn on **Allow Pre-Release Updates** in Settings → Launcher.

## Console

Open the DevTools console with `Ctrl + Shift + I`. Right-click the console and choose **Save as…** to export the log.

> [!WARNING]
> Don't paste anything into the console unless you know exactly what it does: it can expose your account.

## Development

Requires [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Build installers:

| Target | Command |
| --- | --- |
| Current platform | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

macOS builds generally need a Mac. On Linux, `./build.sh` installs dependencies and runs the launcher in one command (`--build` for an unpacked app, `--package` for packages).

Pushing a new `version` in `package.json` to `master` makes GitHub Actions build every platform and publish the release.

### Documentation

* [Releases, updates, news and modpacks](docs/releases-news-and-modpacks.md) (in Russian)
* [Distribution index](docs/distro.md)
* [Microsoft authentication](docs/MicrosoftAuth.md)
* [Adding modpack art](app/assets/images/modpacks/README.md)

### Translations

Strings live in [`app/assets/lang`](app/assets/lang): `en_US.toml` is the source, and every other file only overrides what it translates (missing lines fall back to English). Brand name and social links are in `_custom.toml`.

## Credits

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) by Daniel Scalzi, MIT License, see [LICENSE.txt](LICENSE.txt).
* Wallpapers from the [Photon Shaders gallery](https://modrinth.com/shader/photon-shader/gallery), authors listed in [CREDITS.md](app/assets/images/wallpapers/CREDITS.md).

Meridian is not affiliated with Mojang AB or Microsoft.
