<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <a href="README.ru.md">Русский</a> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <a href="README.be.md">Беларуская</a> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="README.kk.md">Қазақ тілі</a> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <a href="README.de.md">Deutsch</a> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <b>Français</b> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <a href="README.es.md">Español</a>
</p>

<p align="center"><b>Launcher Minecraft moddé.</b> Choisissez un serveur, appuyez sur « Jouer » : Java, le chargeur de mods, les mods et les configurations sont installés et tenus à jour pour vous.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>


---

Meridian est un fork de [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) avec une nouvelle interface, la prise en charge des modpacks et des traductions. Les serveurs proviennent d'un index de distribution auto-hébergé (`distribution.json`, généré avec [Nebula](https://github.com/dscalzi/Nebula)), et les joueurs peuvent y ajouter leurs propres modpacks.

## Fonctionnalités

* 🔐 **Comptes**
  * Connexion Microsoft (OAuth 2.0) et Mojang, plusieurs comptes avec changement rapide.
  * Jeu hors ligne sous n'importe quel pseudo, pour les serveurs avec `online-mode` désactivé.
* 🧭 **Serveurs**
  * Sélecteur de serveurs sur l'écran principal avec version de Minecraft, version du pack et nombre de joueurs en ligne.
  * Les fichiers sont vérifiés avant chaque lancement ; ceux qui manquent ou sont corrompus sont retéléchargés.
  * Connexion automatique au serveur au démarrage du jeu, en option.
* 📦 **Modpacks**
  * Recherche et installation de packs depuis **Modrinth** et **CurseForge** (CurseForge demande une clé API gratuite).
  * Import de `.mrpack`, de `.zip` CurseForge et d'exports Prism / MultiMC par glisser-déposer.
  * N'importe quelle version de Minecraft avec **Forge**, **NeoForge**, **Fabric** ou **Quilt**.
* 🧩 **Mods et packs**
  * Mods obligatoires, optionnels et drop-in.
  * Shaderpacks et packs de ressources activés ou désactivés depuis les paramètres.
* ☕ **Java**
  * Pas besoin de l'installer à l'avance : si aucune version adaptée n'est trouvée, le launcher l'installe.
  * Curseur de mémoire, exécutable personnalisé et arguments JVM.
* 🖼️ **Apparence**
  * Chaque modpack a ses propres fonds d'écran qui défilent : images du pack, vos captures en jeu (F2) ou images de la galerie Photon Shaders, avec le nom des auteurs.
  * Intervalle et mouvement lent réglables ; l'accélération matérielle peut être désactivée.
* 🌍 **Langues**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. D'autres sont en cours.
  * Changement instantané, peut suivre la langue du système et appliquer la même langue dans Minecraft.
* 🌐 **Proxy** — HTTP ou SOCKS5 pour la connexion et les téléchargements, et pour le jeu si vous le souhaitez.
* 🔄 **Mises à jour automatiques** — quand une nouvelle version sort, le launcher demande s'il faut la télécharger maintenant ou plus tard, l'installe et redémarre en gardant vos paramètres. Sous macOS, cela fonctionne si le launcher est dans Applications.
* 📰 Actualités, état des services Mojang et Discord Rich Presence.

## Téléchargement

Récupérez l'installateur pour votre système dans les [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest).

| Plateforme | Fichier |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Les préversions ne sont proposées qu'aux joueurs qui activent **Autoriser les préversions** dans Paramètres → Launcher.

## Console

Ouvrez la console DevTools avec `Ctrl + Maj + I`. Clic droit dans la console puis **Save as…** pour exporter le journal.

> [!WARNING]
> Ne collez rien dans la console sans savoir exactement ce que cela fait : vous pourriez donner accès à votre compte.

## Développement

Nécessite [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Construire les installateurs :

| Cible | Commande |
| --- | --- |
| Plateforme actuelle | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

Les builds macOS demandent en général un Mac. Sous Linux, `./build.sh` installe les dépendances et lance le launcher en une commande (`--build` pour une application décompressée, `--package` pour les paquets).

Pousser une nouvelle `version` de `package.json` sur `master` déclenche la construction de toutes les plateformes par GitHub Actions et la publication de la release.

### Documentation

* [Releases, mises à jour, actualités et modpacks](../releases-news-and-modpacks.md) (en russe)
* [Index de distribution](../distro.md) (en anglais)
* [Authentification Microsoft](../MicrosoftAuth.md) (en anglais)
* [Ajouter des images de modpack](../../app/assets/images/modpacks/README.md)

### Traductions

Les textes se trouvent dans [`app/assets/lang`](../../app/assets/lang) : `en_US.toml` est la source, les autres fichiers ne remplacent que ce qui est traduit (les lignes manquantes s'affichent en anglais). Le nom et les liens vers les réseaux sociaux sont dans `_custom.toml`.

## Remerciements

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) par Daniel Scalzi, licence MIT, voir [LICENSE.txt](../../LICENSE.txt).
* Fonds d'écran issus de la [galerie Photon Shaders](https://modrinth.com/shader/photon-shader/gallery), auteurs listés dans [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md).

Meridian n'est affilié ni à Mojang AB ni à Microsoft.
