<p align="center"><img src="../../build/icon.png" width="140" height="140" alt="Meridian"></p>

<h1 align="center">Meridian</h1>

<p align="center">
  <img src="../../app/assets/images/flags/GB.svg" height="12" alt=""> <a href="../../README.md">English</a> ·
  <img src="../../app/assets/images/flags/RU.svg" height="12" alt=""> <a href="README.ru.md">Русский</a> ·
  <img src="../../app/assets/images/flags/UA.svg" height="12" alt=""> <a href="README.uk.md">Українська</a> ·
  <img src="../../app/assets/images/flags/BY.svg" height="12" alt=""> <a href="README.be.md">Беларуская</a> ·
  <img src="../../app/assets/images/flags/KZ.svg" height="12" alt=""> <b>Қазақ тілі</b> ·
  <img src="../../app/assets/images/flags/DE.svg" height="12" alt=""> <a href="README.de.md">Deutsch</a> ·
  <img src="../../app/assets/images/flags/FR.svg" height="12" alt=""> <a href="README.fr.md">Français</a> ·
  <img src="../../app/assets/images/flags/ES.svg" height="12" alt=""> <a href="README.es.md">Español</a>
</p>

<p align="center"><b>Модтары бар Minecraft лаунчері.</b> Серверді таңдап, «Ойнау» батырмасын басыңыз: Java, мод жүктегіші, модтар мен баптаулар өздігінен орнатылып, жаңартылып отырады.</p>

<p align="center">
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases/latest"><img src="https://img.shields.io/github/v/release/ildimas/Helios-Custom-Worlds?style=for-the-badge&color=004477&label=release" alt="release"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/ildimas/Helios-Custom-Worlds/build.yml?branch=master&style=for-the-badge" alt="build"></a>
  <a href="https://github.com/ildimas/Helios-Custom-Worlds/releases"><img src="https://img.shields.io/github/downloads/ildimas/Helios-Custom-Worlds/total?style=for-the-badge&color=0a508a" alt="downloads"></a>
</p>

<p align="center"><img src="../../docs/images/demo.gif" width="800" alt="Meridian: іске қосу және серверлерді ауыстыру"></p>


---

Meridian — жаңа интерфейсі, жинақтарды қолдауы және аудармалары бар [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) форкы. Серверлер тізімі өз дистрибуция индексінен алынады (`distribution.json`, [Nebula](https://github.com/dscalzi/Nebula) арқылы жасалады), ал ойыншылар оған өз жинақтарын қоса алады.

## Мүмкіндіктер

* 🔐 **Аккаунттар**
  * Microsoft (OAuth 2.0) және Mojang арқылы кіру, бірнеше аккаунт және олардың арасында жылдам ауысу.
  * Кірмей-ақ кез келген атпен ойнау — `online-mode` өшірілген серверлер үшін.
* 🧭 **Серверлер**
  * Басты экрандағы сервер таңдағышы: Minecraft нұсқасы, жинақ нұсқасы және онлайн ойыншылар саны.
  * Әр іске қосу алдында файлдар тексеріледі; жоқ немесе бүлінген файлдар қайта жүктеледі.
  * Ойын басталғанда серверге автоматты түрде қосылуды қосуға болады.
* 📦 **Жинақтар**
  * **Modrinth** және **CurseForge** жинақтарын іздеу және орнату (CurseForge үшін тегін API кілті қажет).
  * `.mrpack`, CurseForge `.zip` және Prism / MultiMC экспорттарын сүйреп әкеліп импорттау.
  * **Forge**, **NeoForge**, **Fabric** немесе **Quilt** бар кез келген Minecraft нұсқасы.
* 🧩 **Модтар мен пактар**
  * Міндетті, қосымша және drop-in модтар.
  * Шейдерпактар мен ресурс-пактар баптауларда қосылып-өшіріледі.
* ☕ **Java**
  * Алдын ала орнатудың қажеті жоқ: сәйкес Java табылмаса, лаунчер оны өзі орнатады.
  * Жад жүгірткісі, өз орындалатын файлыңыз және JVM аргументтері.
* 🖼️ **Безендіру**
  * Әр жинақтың ауысып тұратын өз тұсқағаздары бар: жинақ арты, ойыннан түсірген скриншоттарыңыз (F2) немесе авторлары көрсетілген Photon Shaders галереясының кадрлары.
  * Ауысу аралығы мен баяу қозғалыс бапталады; аппараттық жеделдетуді өшіруге болады.
* 🌍 **Тілдер**
  * Русский, English, Українська, Беларуская, Қазақ тілі, Deutsch, Français, Español. Басқалары дайындалуда.
  * Бірден ауысады, жүйе тіліне ілесе алады және Minecraft-та да сол тілді орната алады.
* 🌐 **Прокси** — кіру мен жүктеулер үшін HTTP немесе SOCKS5, қаласаңыз ойынның өзі үшін де.
* 🔄 **Автожаңарту** — жаңа нұсқа шыққанда лаунчер оны қазір немесе кейінірек жүктеуді сұрайды, өзі орнатып, баптауларды сақтай отырып қайта іске қосылады. macOS-та лаунчер «Бағдарламалар» қалтасында тұрса жұмыс істейді.
* 📰 Жаңалықтар, Mojang қызметтерінің күйі және Discord Rich Presence.

## Жүктеу

Жүйеңізге арналған орнатқышты [Releases](https://github.com/ildimas/Helios-Custom-Worlds/releases/latest) бөлімінен алыңыз.

| Платформа | Файл |
| --- | --- |
| Windows x64 | `Meridian-setup-VERSION.exe` |
| macOS Intel | `Meridian-setup-VERSION-x64.dmg` |
| macOS Apple Silicon | `Meridian-setup-VERSION-arm64.dmg` |
| Linux x64 | `Meridian-setup-VERSION.AppImage` |
| Debian / Ubuntu | `Meridian-setup-VERSION.deb` |
| Arch Linux | `Meridian-setup-VERSION.pacman` |

Алдын ала нұсқаларды тек Баптаулар → Лаунчер бөлімінде **«Алдын ала нұсқаларды алу»** қосулы ойыншылар алады.

## Консоль

DevTools консолі `Ctrl + Shift + I` пернелерімен ашылады. Логты сақтау үшін консольде тінтуірдің оң жақ батырмасын басып, **Save as…** таңдаңыз.

> [!WARNING]
> Не істейтінін нақты білмесеңіз, консольге ештеңе қоймаңыз: осылайша аккаунтыңызға қол жеткізуді беріп қоюыңыз мүмкін.

## Әзірлеу

[Node.js](https://nodejs.org/) 22 қажет.

```console
git clone https://github.com/ildimas/Helios-Custom-Worlds.git
cd Helios-Custom-Worlds
npm install
npm start
```

Орнатқыштарды жинау:

| Мақсат | Пәрмен |
| --- | --- |
| Ағымдағы платформа | `npm run dist` |
| Windows x64 | `npm run dist:win` |
| macOS | `npm run dist:mac` |
| Linux x64 | `npm run dist:linux` |

macOS үшін әдетте Mac қажет. Linux-та `./build.sh` бір пәрменмен тәуелділіктерді орнатып, лаунчерді іске қосады (`--build` — орамнан шығарылған қолданба, `--package` — пакеттер).

`package.json` ішіндегі жаңа `version` мәнін `master` тармағына жіберсеңіз, GitHub Actions барлық платформаларды жинап, релизді жариялайды.

### Құжаттама

* [Релиздер, жаңартулар, жаңалықтар және жинақтар](../releases-news-and-modpacks.md) (орысша)
* [Дистрибуция индексі](../distro.md) (ағылшынша)
* [Microsoft авторизациясы](../MicrosoftAuth.md) (ағылшынша)
* [Жинақ артын қосу](../../app/assets/images/modpacks/README.md)

### Аудармалар

Жолдар [`app/assets/lang`](../../app/assets/lang) ішінде: бастапқы файл — `en_US.toml`, қалғандары тек аударылғанын ғана алмастырады (аударылмаған жолдар ағылшынша көрсетіледі). Атауы мен әлеуметтік желі сілтемелері — `_custom.toml` ішінде.

## Алғыс

* Daniel Scalzi әзірлеген [Helios Launcher](https://github.com/dscalzi/HeliosLauncher), MIT лицензиясы, [LICENSE.txt](../../LICENSE.txt) қараңыз.
* [Photon Shaders галереясынан](https://modrinth.com/shader/photon-shader/gallery) алынған тұсқағаздар, авторлары [CREDITS.md](../../app/assets/images/wallpapers/CREDITS.md) файлында.

Meridian Mojang AB және Microsoft компанияларымен байланысты емес.
