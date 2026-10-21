const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')

const LANG_DIR = path.join(__dirname, '..', 'lang')

/**
 * Languages the launcher ships, in the order the settings list shows them.
 * `file` is the base translation; a `<id>_<country>.toml` next to it, when
 * present, is layered on top for that country's spelling.
 */
const LANGUAGES = [
    { id: 'ru', file: 'ru_RU', name: 'Русский', countries: [{ code: 'RU', name: 'Россия' }] },
    { id: 'en', file: 'en_US', name: 'English', countries: [{ code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }] },
    { id: 'uk', file: 'uk_UA', name: 'Українська', countries: [{ code: 'UA', name: 'Україна' }] },
    { id: 'be', file: 'be_BY', name: 'Беларуская', countries: [{ code: 'BY', name: 'Беларусь' }] },
    { id: 'kk', file: 'kk_KZ', name: 'Қазақ тілі', countries: [{ code: 'KZ', name: 'Қазақстан' }] },
    { id: 'de', file: 'de_DE', name: 'Deutsch', countries: [{ code: 'DE', name: 'Deutschland' }] },
    { id: 'fr', file: 'fr_FR', name: 'Français', countries: [{ code: 'FR', name: 'France' }] },
    { id: 'es', file: 'es_ES', name: 'Español', countries: [{ code: 'ES', name: 'España' }, { code: 'MX', name: 'México' }] },
    { id: 'pt', file: 'pt_BR', name: 'Português', countries: [{ code: 'BR', name: 'Brasil' }, { code: 'PT', name: 'Portugal' }] },
    { id: 'pl', file: 'pl_PL', name: 'Polski', countries: [{ code: 'PL', name: 'Polska' }] },
    { id: 'it', file: 'it_IT', name: 'Italiano', countries: [{ code: 'IT', name: 'Italia' }] },
    { id: 'tr', file: 'tr_TR', name: 'Türkçe', countries: [{ code: 'TR', name: 'Türkiye' }] },
    { id: 'ja', file: 'ja_JP', name: '日本語', countries: [{ code: 'JP', name: '日本' }] },
    { id: 'zh', file: 'zh_CN', name: '简体中文', countries: [{ code: 'CN', name: '中国' }] },
    { id: 'ko', file: 'ko_KR', name: '한국어', countries: [{ code: 'KR', name: '대한민국' }] }
]

const FALLBACK = { language: 'en', country: 'US' }

let lang
let current = { ...FALLBACK }

exports.LANGUAGES = LANGUAGES

/**
 * Whether a language has a translation yet. The rest are listed as in progress.
 *
 * @param {string} id The language id.
 */
exports.isAvailable = function(id){
    const def = LANGUAGES.find(l => l.id === id)
    return def != null && fs.existsSync(path.join(LANG_DIR, `${def.file}.toml`))
}

exports.loadLanguage = function(id){
    const file = path.join(LANG_DIR, `${id}.toml`)
    if(!fs.existsSync(file)){
        return
    }
    lang = merge(lang || {}, toml.parse(fs.readFileSync(file)) || {})
}

exports.query = function(id, placeHolders){
    let query = id.split('.')
    let res = lang
    for(let q of query){
        res = res != null ? res[q] : undefined
    }
    let text = res === lang || res == null ? '' : res
    if (placeHolders) {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, value)
        })
    }
    return text
}

exports.queryJS = function(id, placeHolders){
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function(id, placeHolders){
    return exports.query(`ejs.${id}`, placeHolders)
}

/**
 * The operating system's preferred locales, best first, e.g. ['ru-RU', 'en-US'].
 */
exports.systemLocales = function(){
    try {
        const electron = require('electron')
        const app = electron.app || require('@electron/remote').app
        const list = app.getPreferredSystemLanguages()
        if(list.length > 0) return list
        return [app.getLocale()]
    } catch {
        return typeof navigator !== 'undefined' ? [...navigator.languages] : []
    }
}

/**
 * The shipped language and country closest to a locale, or null.
 *
 * @param {string} locale A BCP 47 tag such as 'pt-BR', 'uk' or 'zh-Hans-CN'.
 */
exports.matchLocale = function(locale){
    const parts = String(locale).replace(/_/g, '-').split('-')
    const def = LANGUAGES.find(l => l.id === parts[0].toLowerCase())
    if(def == null || !exports.isAvailable(def.id)) return null
    const region = parts.slice(1).find(p => /^[A-Za-z]{2}$/.test(p))
    const country = def.countries.find(c => region != null && c.code === region.toUpperCase()) || def.countries[0]
    return { language: def.id, country: country.code }
}

/**
 * The language to show for a saved selection: the system's when asked to
 * follow it (or nothing was picked yet), otherwise the picked one.
 *
 * @param {Object} selection { system, language, country } from the config.
 * @returns {{language: string, country: string}}
 */
exports.resolve = function(selection){
    if(selection != null && !selection.system && selection.language != null){
        const def = LANGUAGES.find(l => l.id === selection.language)
        if(def != null && exports.isAvailable(def.id)){
            const country = def.countries.find(c => c.code === selection.country) || def.countries[0]
            return { language: def.id, country: country.code }
        }
    }
    for(const locale of exports.systemLocales()){
        const hit = exports.matchLocale(locale)
        if(hit != null) return hit
    }
    return { ...FALLBACK }
}

/**
 * Load the strings for a saved language selection. English is loaded first,
 * so any line a translation lacks stays readable.
 *
 * @param {Object} selection { system, language, country } from the config.
 */
exports.setupLanguage = function(selection = null){
    current = exports.resolve(selection)
    const def = LANGUAGES.find(l => l.id === current.language)

    lang = null
    exports.loadLanguage('en_US')
    // Brand strings for the Launcher Customizer, in English.
    exports.loadLanguage('_custom')
    if(def.file !== 'en_US'){
        exports.loadLanguage(def.file)
    }
    const regional = `${def.id}_${current.country}`
    if(regional !== def.file){
        exports.loadLanguage(regional)
    }
}

/**
 * The language in use.
 *
 * @returns {{language: string, country: string, tag: string, def: Object}}
 */
exports.getCurrent = function(){
    return {
        ...current,
        tag: `${current.language}-${current.country}`,
        def: LANGUAGES.find(l => l.id === current.language)
    }
}

/**
 * Minecraft's code for a language, e.g. ru_ru. Versions before 1.11 used ru_RU.
 *
 * @param {{language: string, country: string}} sel The language.
 * @param {string} mcVersion The Minecraft version.
 */
exports.minecraftCode = function(sel, mcVersion){
    const minor = /^1\.(\d+)/.exec(mcVersion || '')
    const code = `${sel.language}_${sel.country}`
    return minor != null && Number(minor[1]) < 11 ? `${sel.language}_${sel.country.toUpperCase()}` : code.toLowerCase()
}
