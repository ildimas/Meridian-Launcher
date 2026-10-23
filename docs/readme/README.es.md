<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <a href="README.ru.md">Русский</a> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <a href="README.be.md">Беларуская</a> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="README.kk.md">Қазақ тілі</a> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <a href="README.de.md">Deutsch</a> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <a href="README.fr.md">Français</a> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <b>Español</b>
</p>

<p align="center"><b>Launcher de Minecraft con mods.</b> Elige un servidor y pulsa Jugar: Java, el cargador de mods, los mods y las configuraciones se instalan y se mantienen al día por ti.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>

<p align="center"><img src="../../docs/images/demo.gif" width="800" alt="Meridian: inicio y cambio de servidor"></p>


---

Meridian es un fork de [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) con una interfaz nueva, soporte para modpacks y traducciones. Los servidores vienen de un índice de distribución propio (`distribution.json`, generado con [Nebula](https://github.com/dscalzi/Nebula)), y los jugadores pueden añadir sus propios modpacks.

## Funciones

* 🔐 **Cuentas**
  * Inicio de sesión con Microsoft (OAuth 2.0) y Mojang, varias cuentas con cambio rápido.
  * Juego sin conexión con cualquier nombre, para servidores con `online-mode` desactivado.
* 🧭 **Servidores**
  * Selector de servidores en la pantalla principal con la versión de Minecraft, la versión del paquete y los jugadores conectados.
  * Los archivos se comprueban antes de cada inicio; los que faltan o están dañados se vuelven a descargar.
  * Conexión automática al servidor al iniciar el juego, si quieres.
* 📦 **Modpacks**
  * Busca e instala paquetes de **Modrinth** y **CurseForge** (CurseForge necesita una clave de API gratuita).
  * Importa `.mrpack`, `.zip` de CurseForge y exportaciones de Prism / MultiMC arrastrándolos.
  * Cualquier versión de Minecraft con **Forge**, **NeoForge**, **Fabric** o **Quilt**.
* 🧩 **Mods y paquetes**
  * Mods obligatorios, opcionales y drop-in.
  * Shaderpacks y paquetes de recursos que se activan y desactivan desde los ajustes.
* ☕ **Java**
  * No hace falta instalarlo antes: si no encuentra una versión adecuada, el launcher la instala.
  * Control de memoria, ejecutable propio y argumentos de la JVM.
* 🖼️ **Apariencia**
  * Cada modpack tiene sus propios fondos que van cambiando: imágenes del paquete, tus capturas del juego (F2) o imágenes de la galería de Photon Shaders, con el nombre de sus autores.
  * El intervalo y el movimiento lento se pueden ajustar; la aceleración por hardware se puede desactivar.
* 🌍 **Idiomas**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. Hay más en curso.
  * Cambian al instante, pueden seguir el idioma del sistema y poner el mismo idioma en Minecraft.
* 🌐 **Proxy**: HTTP o SOCKS5 para el inicio de sesión y las descargas, y también para el juego si quieres.
* 🔄 **Actualizaciones automáticas**: cuando sale una versión nueva, el launcher pregunta si descargarla ahora o más tarde, la instala y se reinicia conservando tus ajustes. En macOS funciona si el launcher está en Aplicaciones.
* 📰 Noticias, estado de los servicios de Mojang y Discord Rich Presence.

## Descarga

Descarga el instalador para tu sistema en [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest).

| Plataforma | Archivo |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Las versiones preliminares solo llegan a quienes activan **Recibir versiones preliminares** en Ajustes → Launcher.

## Consola

Abre la consola de DevTools con `Ctrl + Shift + I`. Haz clic derecho en la consola y elige **Save as…** para exportar el registro.

> [!WARNING]
> No pegues nada en la consola si no sabes exactamente qué hace: podrías dar acceso a tu cuenta.

## Desarrollo

Necesita [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Compilar los instaladores:

| Destino | Comando |
| --- | --- |
| Plataforma actual | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

Para compilar para macOS normalmente hace falta un Mac. En Linux, `./build.sh` instala las dependencias y ejecuta el launcher con un solo comando (`--build` para una aplicación sin empaquetar, `--package` para los paquetes).

Al subir a `master` una nueva `version` en `package.json`, GitHub Actions compila todas las plataformas y publica la versión.

### Documentación

* [Versiones, actualizaciones, noticias y modpacks](../releases-news-and-modpacks.md) (en ruso)
* [Índice de distribución](../distro.md) (en inglés)
* [Autenticación de Microsoft](../MicrosoftAuth.md) (en inglés)
* [Añadir imágenes de un modpack](../../app/assets/images/modpacks/README.md)

### Traducciones

Los textos están en [`app/assets/lang`](../../app/assets/lang): `en_US.toml` es el original y cada archivo solo reemplaza lo que traduce (las líneas que faltan se muestran en inglés). El nombre y los enlaces a redes sociales están en `_custom.toml`.

## Créditos

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) de Daniel Scalzi, licencia MIT, consulta [LICENSE.txt](../../LICENSE.txt).
* Fondos de la [galería de Photon Shaders](https://modrinth.com/shader/photon-shader/gallery); sus autores aparecen en [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md).

Meridian no está afiliado a Mojang AB ni a Microsoft.
