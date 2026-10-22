<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <a href="README.ru.md">Русский</a> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <a href="README.be.md">Беларуская</a> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="README.kk.md">Қазақ тілі</a> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <b>Deutsch</b> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <a href="README.fr.md">Français</a> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <a href="README.es.md">Español</a>
</p>

<p align="center"><b>Launcher für Minecraft mit Mods.</b> Server wählen, auf „Spielen“ drücken: Java, Mod-Loader, Mods und Konfigurationen werden für dich installiert und aktuell gehalten.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>


---

Meridian ist ein Fork von [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) mit neuer Oberfläche, Modpack-Unterstützung und Übersetzungen. Die Server stammen aus einem selbst gehosteten Distributionsindex (`distribution.json`, erstellt mit [Nebula](https://github.com/dscalzi/Nebula)), und Spieler können eigene Modpacks hinzufügen.

## Funktionen

* 🔐 **Konten**
  * Anmeldung mit Microsoft (OAuth 2.0) und Mojang, mehrere Konten mit schnellem Wechsel.
  * Offline spielen unter beliebigem Namen, für Server mit deaktiviertem `online-mode`.
* 🧭 **Server**
  * Server-Auswahl auf dem Startbildschirm mit Minecraft-Version, Pack-Version und aktueller Spielerzahl.
  * Dateien werden vor jedem Start geprüft; fehlende oder beschädigte werden neu heruntergeladen.
  * Optional automatisch mit dem Server verbinden, sobald das Spiel startet.
* 📦 **Modpacks**
  * Packs von **Modrinth** und **CurseForge** suchen und installieren (CurseForge braucht einen kostenlosen API-Schlüssel).
  * `.mrpack`, CurseForge-`.zip` und Prism-/MultiMC-Exporte per Drag & Drop importieren.
  * Jede Minecraft-Version mit **Forge**, **NeoForge**, **Fabric** oder **Quilt**.
* 🧩 **Mods und Packs**
  * Pflicht-, optionale und Drop-in-Mods.
  * Shaderpacks und Ressourcenpakete lassen sich in den Einstellungen an- und ausschalten.
* ☕ **Java**
  * Muss nicht vorab installiert sein: Fehlt eine passende Java-Version, installiert der Launcher sie.
  * RAM-Regler, eigene Java-Datei und JVM-Argumente.
* 🖼️ **Darstellung**
  * Jedes Modpack hat eigene wechselnde Hintergründe: Pack-Bilder, deine Screenshots aus dem Spiel (F2) oder Bilder aus der Photon-Shaders-Galerie mit Nennung der Urheber.
  * Wechselintervall und sanfte Bewegung sind einstellbar; Hardwarebeschleunigung lässt sich abschalten.
* 🌍 **Sprachen**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. Weitere sind in Arbeit.
  * Wechsel ohne Neustart, kann der Systemsprache folgen und dieselbe Sprache in Minecraft setzen.
* 🌐 **Proxy** — HTTP oder SOCKS5 für Anmeldung und Downloads, auf Wunsch auch für das Spiel.
* 🔄 **Automatische Updates** — erscheint eine neue Version, fragt der Launcher, ob sie jetzt oder später heruntergeladen werden soll, installiert sie und startet mit deinen Einstellungen neu. Unter macOS klappt das, wenn der Launcher im Ordner „Programme“ liegt.
* 📰 News, Status der Mojang-Dienste und Discord Rich Presence.

## Download

Lade den Installer für dein System unter [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest) herunter.

| Plattform | Datei |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Vorabversionen erhalten nur Spieler, die **Vorabversionen erlauben** unter Einstellungen → Launcher aktiviert haben.

## Konsole

Die DevTools-Konsole öffnest du mit `Strg + Umschalt + I`. Rechtsklick in die Konsole und **Save as…** speichert das Log.

> [!WARNING]
> Füge nichts in die Konsole ein, wenn du nicht genau weißt, was es tut: Damit kann man Zugriff auf dein Konto preisgeben.

## Entwicklung

Benötigt [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Installer bauen:

| Ziel | Befehl |
| --- | --- |
| Aktuelle Plattform | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

Für macOS-Builds braucht man in der Regel einen Mac. Unter Linux installiert `./build.sh` die Abhängigkeiten und startet den Launcher mit einem Befehl (`--build` für eine entpackte App, `--package` für Pakete).

Wird eine neue `version` in `package.json` nach `master` gepusht, baut GitHub Actions alle Plattformen und veröffentlicht das Release.

### Dokumentation

* [Releases, Updates, News und Modpacks](../releases-news-and-modpacks.md) (auf Russisch)
* [Distributionsindex](../distro.md) (auf Englisch)
* [Microsoft-Anmeldung](../MicrosoftAuth.md) (auf Englisch)
* [Modpack-Bilder hinzufügen](../../app/assets/images/modpacks/README.md)

### Übersetzungen

Die Texte liegen in [`app/assets/lang`](../../app/assets/lang): `en_US.toml` ist die Vorlage, alle anderen Dateien überschreiben nur, was übersetzt ist (fehlende Zeilen erscheinen auf Englisch). Name und Social-Media-Links stehen in `_custom.toml`.

## Danksagungen

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) von Daniel Scalzi, MIT-Lizenz, siehe [LICENSE.txt](../../LICENSE.txt).
* Hintergründe aus der [Photon-Shaders-Galerie](https://modrinth.com/shader/photon-shader/gallery), Urheber in [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md).

Meridian steht in keiner Verbindung zu Mojang AB oder Microsoft.
