<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <b>Русский</b> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <a href="README.be.md">Беларуская</a> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="README.kk.md">Қазақ тілі</a> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <a href="README.de.md">Deutsch</a> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <a href="README.fr.md">Français</a> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <a href="README.es.md">Español</a>
</p>

<p align="center"><b>Лаунчер для Minecraft с модами.</b> Выберите сервер и нажмите «Играть»: Java, загрузчик модов, моды и настройки установятся и будут обновляться сами.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>


---

Meridian — форк [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) с новым интерфейсом, поддержкой сборок и переводами. Список серверов берётся из собственного индекса дистрибуции (`distribution.json`, создаётся с помощью [Nebula](https://github.com/dscalzi/Nebula)), а игроки могут добавлять к нему свои сборки.

## Возможности

* 🔐 **Аккаунты**
  * Вход через Microsoft (OAuth 2.0) и Mojang, несколько аккаунтов с быстрым переключением.
  * Игра без входа под любым ником — для серверов с выключенным `online-mode`.
* 🧭 **Серверы**
  * Переключатель серверов на главном экране: версия Minecraft, версия сборки и число игроков онлайн.
  * Файлы проверяются перед каждым запуском; недостающие и повреждённые скачиваются заново.
  * Можно включить автоподключение к серверу при запуске игры.
* 📦 **Сборки**
  * Поиск и установка сборок с **Modrinth** и **CurseForge** (для CurseForge нужен бесплатный API-ключ).
  * Импорт `.mrpack`, `.zip` от CurseForge и экспортов Prism / MultiMC перетаскиванием.
  * Любая версия Minecraft с **Forge**, **NeoForge**, **Fabric** или **Quilt**.
* 🧩 **Моды и паки**
  * Обязательные, необязательные и drop-in моды.
  * Шейдерпаки и ресурспаки включаются и выключаются в настройках.
* ☕ **Java**
  * Заранее ставить не нужно: если подходящей Java нет, лаунчер установит её сам.
  * Ползунок памяти, свой исполняемый файл и аргументы JVM.
* 🖼️ **Оформление**
  * У каждой сборки свои сменяющиеся обои: арт сборки, ваши скриншоты из игры (F2) или кадры из галереи Photon Shaders с указанием авторов.
  * Настраиваются интервал смены и плавное движение; аппаратное ускорение можно отключить.
* 🌍 **Языки**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. Другие в работе.
  * Переключаются мгновенно, могут следовать языку системы и выставлять тот же язык в Minecraft.
* 🌐 **Прокси** — HTTP или SOCKS5 для входа и загрузок, по желанию и для самой игры.
* 🔄 **Автообновление** — когда выходит новая версия, лаунчер спрашивает, скачать её сейчас или позже, сам ставит и перезапускается с сохранёнными настройками. На macOS работает, если лаунчер лежит в «Программах».
* 📰 Новости, статус сервисов Mojang и Discord Rich Presence.

## Скачать

Установщик для своей системы берите в [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest).

| Платформа | Файл |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Предварительные версии получают только те, у кого включено **«Получать предварительные версии»** в Настройки → Лаунчер.

## Консоль

Консоль DevTools открывается сочетанием `Ctrl + Shift + I`. Чтобы сохранить лог, нажмите в консоли правой кнопкой и выберите **Save as…**.

> [!WARNING]
> Ничего не вставляйте в консоль, если не уверены, что именно это сделает: так можно отдать доступ к своему аккаунту.

## Разработка

Нужен [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Сборка установщиков:

| Цель | Команда |
| --- | --- |
| Текущая платформа | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

Для macOS обычно нужен Mac. На Linux `./build.sh` одной командой ставит зависимости и запускает лаунчер (`--build` — распакованное приложение, `--package` — пакеты).

Если запушить в `master` новую `version` в `package.json`, GitHub Actions соберёт все платформы и опубликует релиз.

### Документация

* [Релизы, обновления, новости и сборки](../releases-news-and-modpacks.md)
* [Индекс дистрибуции](../distro.md) (на английском)
* [Авторизация Microsoft](../MicrosoftAuth.md) (на английском)
* [Как добавить арт сборки](../../app/assets/images/modpacks/README.md)

### Переводы

Строки лежат в [`app/assets/lang`](../../app/assets/lang): исходный файл — `en_US.toml`, остальные переопределяют только то, что переведено (непереведённые строки показываются по-английски). Название и ссылки на соцсети — в `_custom.toml`.

## Благодарности

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) от Daniel Scalzi, лицензия MIT, см. [LICENSE.txt](../../LICENSE.txt).
* Обои из [галереи Photon Shaders](https://modrinth.com/shader/photon-shader/gallery), авторы перечислены в [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md).

Meridian не связан с Mojang AB и Microsoft.
