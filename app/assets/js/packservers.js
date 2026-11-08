/**
 * The servers a pack's game lists (its servers.dat: the pack's own and the
 * ones the player added), and what each says when asked: icon, message of
 * the day, version, players.
 *
 * The pack's server from distribution.json comes first even when the game
 * hasn't written servers.dat yet. Hidden entries (hidden: 1) are left out,
 * as the game leaves them out of its list.
 */
const fs = require('fs-extra')
const path = require('path')
const ServerList = require('./serverlist')

/** A server's address as host and port. */
exports.parseAddress = function(address){
    const text = String(address).trim()
    // [IPv6]:port
    const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
    if(bracket != null){
        return { host: bracket[1], port: bracket[2] != null ? Number(bracket[2]) : 25565 }
    }
    const colon = text.lastIndexOf(':')
    if(colon > 0 && text.indexOf(':') === colon && /^\d+$/.test(text.slice(colon + 1))){
        return { host: text.slice(0, colon), port: Number(text.slice(colon + 1)) }
    }
    return { host: text, port: 25565 }
}

/** The address written the way the game shows it: no default port. */
exports.formatAddress = function({ host, port }){
    const shown = host.includes(':') ? `[${host}]` : host
    return port === 25565 ? shown : `${shown}:${port}`
}

function key({ host, port }){
    return `${host.toLowerCase()}:${port}`
}

function field(server, name){
    return server.find(([k]) => k === name)?.[1]?.value
}

/**
 * The servers a pack lists.
 *
 * @param {string} packDir The pack folder.
 * @param {{ name: string, address: string } | null} packServer The pack's own server, if it has one.
 * @returns {Promise.<Array.<{ name: string, host: string, port: number, address: string, icon: string | null, pack: boolean }>>}
 */
exports.list = async function(packDir, packServer = null){
    let saved = []
    try {
        saved = ServerList.servers(ServerList.readNbt(await fs.readFile(path.join(packDir, 'servers.dat'))))
    } catch {
        // No list yet, or one the game can't read either.
    }
    const servers = []
    const seen = new Set()
    const add = (name, address, icon, pack) => {
        if(typeof address !== 'string' || address.trim() === '') return
        const parsed = exports.parseAddress(address)
        const k = key(parsed)
        if(seen.has(k)){
            if(pack) servers.find(s => key(s) === k).pack = true
            return
        }
        seen.add(k)
        servers.push({ name: name || exports.formatAddress(parsed), ...parsed, address: exports.formatAddress(parsed), icon: icon || null, pack })
    }
    if(packServer != null){
        const own = saved.find(s => typeof field(s, 'ip') === 'string' && key(exports.parseAddress(field(s, 'ip'))) === key(exports.parseAddress(packServer.address)))
        add(own != null ? field(own, 'name') : packServer.name, packServer.address, own != null ? field(own, 'icon') : null, true)
    }
    for(const server of saved){
        if(field(server, 'hidden') === 1) continue
        add(field(server, 'name'), field(server, 'ip'), field(server, 'icon'), false)
    }
    return servers
}

/**
 * The text of a message of the day: a string or a chat component with
 * nested extra parts, without the § formatting codes.
 *
 * @param {*} description The status's description.
 * @returns {string}
 */
exports.motdText = function(description){
    const flatten = part => {
        if(part == null) return ''
        if(typeof part === 'string') return part
        if(Array.isArray(part)) return part.map(flatten).join('')
        return (typeof part.text === 'string' ? part.text : typeof part.translate === 'string' ? part.translate : '') + (Array.isArray(part.extra) ? part.extra.map(flatten).join('') : '')
    }
    return flatten(description).replace(/§[0-9a-fk-orx]/gi, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

/**
 * Players named in a status: real names only (servers also fill the sample
 * with messages), with their UUID when it looks like one.
 *
 * @param {Object} status The server's status.
 * @returns {Array.<{ name: string, id: string | null }>}
 */
exports.players = function(status){
    const sample = Array.isArray(status?.players?.sample) ? status.players.sample : []
    const seen = new Set()
    const players = []
    for(const p of sample){
        const name = p?.name
        if(typeof name !== 'string' || !/^[.*]?\w{1,16}$/.test(name) || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        const id = typeof p.id === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(p.id) ? p.id.replace(/-/g, '').toLowerCase() : null
        players.push({ name, id })
    }
    return players.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * A player's face, from their skin. Offline-mode servers give made-up ids:
 * those show the default skin.
 *
 * @param {{ name: string, id: string | null }} player The player.
 * @param {number} size Pixels.
 * @returns {string}
 */
exports.avatarUrl = function(player, size = 32){
    return `https://mc-heads.net/avatar/${encodeURIComponent(player.id ?? player.name)}/${size}`
}

/**
 * A server icon as an image URL: the status's data URL, or servers.dat's
 * base64 PNG.
 */
exports.iconUrl = function(favicon, saved){
    if(typeof favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(favicon)) return favicon.replace(/\s/g, '')
    if(typeof saved === 'string' && /^[A-Za-z0-9+/=]+$/.test(saved)) return `data:image/png;base64,${saved}`
    return null
}

/**
 * Ask a server how it is.
 *
 * @param {{ host: string, port: number }} server The server.
 * @param {Function} getServerStatus helios-core's getServerStatus.
 * @returns {Promise.<Object | null>} { online, max, players, motd, version, favicon, latency }, or null when it didn't answer.
 */
exports.ping = async function(server, getServerStatus){
    const start = Date.now()
    try {
        const status = await getServerStatus(47, server.host, server.port)
        return {
            online: Number(status.players?.online) || 0,
            max: Number(status.players?.max) || 0,
            players: exports.players(status),
            motd: exports.motdText(status.description),
            version: typeof status.version?.name === 'string' ? status.version.name.replace(/§[0-9a-fk-orx]/gi, '') : null,
            favicon: status.favicon ?? null,
            latency: Date.now() - start,
            at: Date.now()
        }
    } catch {
        return null
    }
}
