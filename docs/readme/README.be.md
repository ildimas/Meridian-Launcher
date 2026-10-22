<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <a href="README.ru.md">Русский</a> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <b>Беларуская</b> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <a href="README.kk.md">Қазақ тілі</a> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <a href="README.de.md">Deutsch</a> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <a href="README.fr.md">Français</a> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <a href="README.es.md">Español</a>
</p>

<p align="center"><b>Лаўнчар для Minecraft з модамі.</b> Абярыце сервер і націсніце «Гуляць»: Java, загрузчык модаў, моды і налады ўсталююцца і будуць абнаўляцца самі.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>


---

Meridian — форк [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) з новым інтэрфейсам, падтрымкай зборак і перакладамі. Спіс сервераў бярэцца з уласнага індэкса дыстрыбуцыі (`distribution.json`, ствараецца з дапамогай [Nebula](https://github.com/dscalzi/Nebula)), а гульцы могуць дадаваць да яго свае зборкі.

## Магчымасці

* 🔐 **Акаўнты**
  * Уваход праз Microsoft (OAuth 2.0) і Mojang, некалькі акаўнтаў з хуткім пераключэннем.
  * Гульня без уваходу пад любым нікам — для сервераў з выключаным `online-mode`.
* 🧭 **Серверы**
  * Пераключальнік сервераў на галоўным экране: версія Minecraft, версія зборкі і колькасць гульцоў анлайн.
  * Файлы правяраюцца перад кожным запускам; адсутныя і пашкоджаныя спампоўваюцца нанова.
  * Можна ўключыць аўтападключэнне да сервера пры запуску гульні.
* 📦 **Зборкі**
  * Пошук і ўсталёўка зборак з **Modrinth** і **CurseForge** (для CurseForge патрэбны бясплатны API-ключ).
  * Імпарт `.mrpack`, `.zip` ад CurseForge і экспартаў Prism / MultiMC перацягваннем.
  * Любая версія Minecraft з **Forge**, **NeoForge**, **Fabric** або **Quilt**.
* 🧩 **Моды і пакі**
  * Абавязковыя, неабавязковыя і drop-in моды.
  * Шэйдарпакі і рэсурспакі ўключаюцца і выключаюцца ў наладах.
* ☕ **Java**
  * Загадзя ставіць не трэба: калі прыдатнай Java няма, лаўнчар усталюе яе сам.
  * Паўзунок памяці, свой выканальны файл і аргументы JVM.
* 🖼️ **Афармленне**
  * У кожнай зборкі свае шпалеры, што змяняюцца: арт зборкі, вашы скрыншоты з гульні (F2) або кадры з галерэі Photon Shaders з указаннем аўтараў.
  * Наладжваюцца інтэрвал змены і плаўны рух; апаратнае паскарэнне можна адключыць.
* 🌍 **Мовы**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. Іншыя ў працы.
  * Пераключаюцца імгненна, могуць ісці за мовай сістэмы і выстаўляць тую ж мову ў Minecraft.
* 🌐 **Проксі** — HTTP або SOCKS5 для ўваходу і спамповак, па жаданні і для самой гульні.
* 🔄 **Аўтаабнаўленне** — калі выходзіць новая версія, лаўнчар пытаецца, спампаваць яе зараз ці пазней, сам усталёўвае і перазапускаецца з захаванымі наладамі. На macOS працуе, калі лаўнчар ляжыць у «Праграмах».
* 📰 Навіны, статус сэрвісаў Mojang і Discord Rich Presence.

## Спампаваць

Усталёўшчык для сваёй сістэмы бярыце ў [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest).

| Платформа | Файл |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Папярэднія версіі атрымліваюць толькі тыя, у каго ўключана **«Атрымліваць папярэднія версіі»** у Налады → Лаўнчар.

## Кансоль

Кансоль DevTools адкрываецца спалучэннем `Ctrl + Shift + I`. Каб захаваць лог, націсніце ў кансолі правай кнопкай і абярыце **Save as…**.

> [!WARNING]
> Нічога не ўстаўляйце ў кансоль, калі не ўпэўнены, што менавіта гэта зробіць: так можна аддаць доступ да свайго акаўнта.

## Распрацоўка

Патрэбны [Node.js](https://nodejs.org/) 22.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Зборка ўсталёўшчыкаў:

| Мэта | Каманда |
| --- | --- |
| Бягучая платформа | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

Для macOS звычайна патрэбны Mac. На Linux `./build.sh` адной камандай ставіць залежнасці і запускае лаўнчар (`--build` — распакаваная праграма, `--package` — пакеты).

Калі запушыць у `master` новую `version` у `package.json`, GitHub Actions збярэ ўсе платформы і апублікуе рэліз.

### Дакументацыя

* [Рэлізы, абнаўленні, навіны і зборкі](../releases-news-and-modpacks.md) (па-руску)
* [Індэкс дыстрыбуцыі](../distro.md) (па-англійску)
* [Аўтарызацыя Microsoft](../MicrosoftAuth.md) (па-англійску)
* [Як дадаць арт зборкі](../../app/assets/images/modpacks/README.md)

### Пераклады

Радкі ляжаць у [`app/assets/lang`](../../app/assets/lang): зыходны файл — `en_US.toml`, астатнія перавызначаюць толькі тое, што перакладзена (неперакладзеныя радкі паказваюцца па-англійску). Назва і спасылкі на сацсеткі — у `_custom.toml`.

## Падзякі

* [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) ад Daniel Scalzi, ліцэнзія MIT, гл. [LICENSE.txt](../../LICENSE.txt).
* Шпалеры з [галерэі Photon Shaders](https://modrinth.com/shader/photon-shader/gallery), аўтары пералічаны ў [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md).

Meridian не звязаны з Mojang AB і Microsoft.
