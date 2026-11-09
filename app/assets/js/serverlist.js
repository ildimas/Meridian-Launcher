/**
 * The in-game server list (servers.dat) of a server pack, merged rather than
 * replaced: the servers the pack ships are always in it and follow the pack,
 * the servers the player added stay.
 *
 * The pack's copy is kept next to the player's file (packfiles.js validates
 * and downloads it there). Each launch merges it in, and remembers which
 * addresses came from the pack, so a server the pack drops or moves leaves
 * the player's list too instead of staying behind as if the player added it.
 *
 * servers.dat is uncompressed NBT: a compound with a "servers" list of
 * compounds (name, ip and optional fields such as icon or acceptTextures).
 * The NBT below reads and writes every tag type, so fields this file doesn't
 * know about are kept as they are.
 */
const fs = require('fs-extra')
const path = require('path')
const zlib = require('zlib')
const PackFiles = require('./packfiles')

/** Addresses the pack's list had at the last merge. */
exports.PACK_ADDRESSES = '.meridian-servers.json'

const TAG = { End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12 }

// --- NBT --------------------------------------------------------------------

/**
 * Read NBT. A tag is { type, value }: a compound's value is an array of
 * [name, tag] in file order, a list's is { type, items }.
 *
 * @param {Buffer} buffer The file, gzipped or not.
 * @returns {{ name: string, tag: Object }} The root tag.
 */
exports.readNbt = function(buffer){
    const data = buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer
    let pos = 0
    const need = n => {
        if(pos + n > data.length) throw new Error('servers.dat ends too early')
    }
    const string = () => {
        need(2)
        const length = data.readUInt16BE(pos)
        pos += 2
        need(length)
        const value = data.toString('utf8', pos, pos + length)
        pos += length
        return value
    }
    const payload = type => {
        switch(type){
            case TAG.Byte: need(1); pos += 1; return data.readInt8(pos - 1)
            case TAG.Short: need(2); pos += 2; return data.readInt16BE(pos - 2)
            case TAG.Int: need(4); pos += 4; return data.readInt32BE(pos - 4)
            case TAG.Long: need(8); pos += 8; return data.readBigInt64BE(pos - 8)
            case TAG.Float: need(4); pos += 4; return data.readFloatBE(pos - 4)
            case TAG.Double: need(8); pos += 8; return data.readDoubleBE(pos - 8)
            case TAG.ByteArray: {
                const length = payload(TAG.Int)
                need(length)
                pos += length
                return Buffer.from(data.subarray(pos - length, pos))
            }
            case TAG.String: return string()
            case TAG.List: {
                need(1)
                const itemType = data.readUInt8(pos++)
                const length = payload(TAG.Int)
                const items = []
                for(let i = 0; i < length; i++) items.push(payload(itemType))
                return { type: itemType, items }
            }
            case TAG.Compound: {
                const entries = []
                for(;;){
                    need(1)
                    const childType = data.readUInt8(pos++)
                    if(childType === TAG.End) return entries
                    const name = string()
                    entries.push([name, { type: childType, value: payload(childType) }])
                }
            }
            case TAG.IntArray: case TAG.LongArray: {
                const length = payload(TAG.Int)
                const items = []
                for(let i = 0; i < length; i++) items.push(payload(type === TAG.IntArray ? TAG.Int : TAG.Long))
                return items
            }
            default: throw new Error(`Unknown NBT tag ${type}`)
        }
    }
    need(1)
    const type = data.readUInt8(pos++)
    if(type !== TAG.Compound) throw new Error('servers.dat does not start with a compound')
    const name = string()
    return { name, tag: { type, value: payload(type) } }
}

/**
 * Write NBT read by readNbt, uncompressed, as Minecraft writes servers.dat.
 *
 * @param {{ name: string, tag: Object }} root The root tag.
 * @returns {Buffer}
 */
exports.writeNbt = function(root){
    const parts = []
    const number = (size, write) => {
        const b = Buffer.alloc(size)
        write(b)
        parts.push(b)
    }
    const string = value => {
        const b = Buffer.from(value, 'utf8')
        number(2, x => x.writeUInt16BE(b.length))
        parts.push(b)
    }
    const payload = (type, value) => {
        switch(type){
            case TAG.Byte: return number(1, b => b.writeInt8(value))
            case TAG.Short: return number(2, b => b.writeInt16BE(value))
            case TAG.Int: return number(4, b => b.writeInt32BE(value))
            case TAG.Long: return number(8, b => b.writeBigInt64BE(BigInt(value)))
            case TAG.Float: return number(4, b => b.writeFloatBE(value))
            case TAG.Double: return number(8, b => b.writeDoubleBE(value))
            case TAG.ByteArray: payload(TAG.Int, value.length); parts.push(Buffer.from(value)); return
            case TAG.String: return string(value)
            case TAG.List:
                number(1, b => b.writeUInt8(value.items.length > 0 ? value.type : TAG.End))
                payload(TAG.Int, value.items.length)
                for(const item of value.items) payload(value.type, item)
                return
            case TAG.Compound:
                for(const [name, tag] of value){
                    number(1, b => b.writeUInt8(tag.type))
                    string(name)
                    payload(tag.type, tag.value)
                }
                return number(1, b => b.writeUInt8(TAG.End))
            case TAG.IntArray: case TAG.LongArray:
                payload(TAG.Int, value.length)
                for(const item of value) payload(type === TAG.IntArray ? TAG.Int : TAG.Long, item)
                return
            default: throw new Error(`Unknown NBT tag ${type}`)
        }
    }
    number(1, b => b.writeUInt8(TAG.Compound))
    string(root.name)
    payload(TAG.Compound, root.tag.value)
    return Buffer.concat(parts)
}

// --- Server list ------------------------------------------------------------

/**
 * The servers in a servers.dat, as compounds (arrays of [name, tag]).
 *
 * @param {{ name: string, tag: Object }} root servers.dat read by readNbt.
 * @returns {Array.<Array>}
 */
exports.servers = function(root){
    const list = root.tag.value.find(([name]) => name === 'servers')?.[1]
    return list?.type === TAG.List && list.value.type === TAG.Compound ? list.value.items : []
}

/**
 * Build a servers.dat holding these servers, keeping the rest of a root.
 *
 * @param {{ name: string, tag: Object } | null} root The file to start from.
 * @param {Array.<Array>} servers The servers, as compounds.
 * @returns {{ name: string, tag: Object }}
 */
function withServers(root, servers){
    const entries = (root?.tag.value || []).filter(([name]) => name !== 'servers')
    entries.push(['servers', { type: TAG.List, value: { type: TAG.Compound, items: servers } }])
    return { name: root?.name ?? '', tag: { type: TAG.Compound, value: entries } }
}

function field(server, name){
    return server.find(([key]) => key === name)?.[1]?.value
}

/**
 * The key a server is matched by: its address, without case or spaces.
 *
 * @param {Array} server A server compound.
 * @returns {string}
 */
exports.addressOf = function(server){
    const ip = field(server, 'ip')
    return typeof ip === 'string' ? ip.trim().toLowerCase() : ''
}

/**
 * Merge the pack's server list into the player's.
 *
 * The pack's servers come first, in the pack's order, with the pack's name
 * and address; what the player's entry for the same address holds besides
 * (icon, resource pack choice...) stays. The player's other servers follow,
 * except those the pack shipped last time and no longer does.
 *
 * @param {Array.<Array>} packServers The pack's servers.
 * @param {Array.<Array>} playerServers The player's servers.
 * @param {Array.<string>} previousPackAddresses The pack's addresses at the last merge.
 * @returns {Array.<Array>} The merged list.
 */
exports.merge = function(packServers, playerServers, previousPackAddresses = []){
    const packAddresses = new Set(packServers.map(exports.addressOf))
    const dropped = new Set(previousPackAddresses.filter(a => !packAddresses.has(a)))
    const players = new Map()
    for(const server of playerServers){
        const address = exports.addressOf(server)
        if(!players.has(address)) players.set(address, server)
    }
    const merged = []
    const used = new Set()
    for(const packServer of packServers){
        const address = exports.addressOf(packServer)
        if(used.has(address)) continue
        used.add(address)
        const own = players.get(address)
        if(own == null){
            merged.push(packServer)
            continue
        }
        const fromPack = new Map(packServer)
        const server = own.map(([name, tag]) => (name === 'name' || name === 'ip') && fromPack.has(name) ? [name, fromPack.get(name)] : [name, tag])
        for(const [name, tag] of packServer){
            if(!server.some(([key]) => key === name)) server.push([name, tag])
        }
        merged.push(server)
    }
    for(const server of playerServers){
        const address = exports.addressOf(server)
        if(packAddresses.has(address) || dropped.has(address)) continue
        merged.push(server)
    }
    return merged
}

/**
 * Bring a pack folder's servers.dat in line with the pack's copy, if the pack
 * ships one. Never fails the launch: a problem is logged and the player's
 * file stays as it is.
 *
 * @param {Object} server The HeliosServer being launched.
 * @param {string} packDir The pack folder (instance directory / server id).
 * @param {Object} logger A logger with info and warn.
 * @returns {Promise.<boolean>} Whether servers.dat was written.
 */
exports.syncPack = async function(server, packDir, logger = console){
    const module = PackFiles.findServerList(server.modules)
    if(module == null){
        return false
    }
    const target = module.getPath()
    const packCopy = PackFiles.packServerListPath(target)
    const record = path.join(packDir, exports.PACK_ADDRESSES)
    try {
        if(!await fs.pathExists(packCopy)){
            return false
        }
        const pack = exports.readNbt(await fs.readFile(packCopy))
        let player = null
        let current = null
        if(await fs.pathExists(target)){
            current = await fs.readFile(target)
            try {
                player = exports.readNbt(current)
            } catch(err) {
                logger.warn(`Unreadable servers.dat, replacing it with the pack's: ${err.message}`)
            }
        }
        let previous = []
        try {
            const saved = await fs.readJson(record)
            if(Array.isArray(saved.addresses)) previous = saved.addresses
        } catch {
            // First merge: nothing from the pack yet.
        }
        const packServers = exports.servers(pack)
        const merged = exports.merge(packServers, player != null ? exports.servers(player) : [], previous)
        const output = exports.writeNbt(withServers(player ?? pack, merged))
        const written = current == null || !output.equals(current)
        if(written){
            await fs.ensureDir(path.dirname(target))
            await fs.writeFile(target, output)
            logger.info(`Merged the pack's server list into servers.dat (${merged.length} servers).`)
        }
        await fs.writeJson(record, { addresses: packServers.map(exports.addressOf) })
        return written
    } catch(err) {
        logger.warn('Unable to merge the pack\'s server list.', err)
        return false
    }
}

exports.TAG = TAG
