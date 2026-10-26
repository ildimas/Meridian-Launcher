// Virtual folders only: moving a pack never moves its files or changes its ID.
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

// Legacy system folders are removed on load; their packs become unassigned.
const LEGACY_FOLDERS = ['servers', 'local']
const own = (obj, key) => Object.hasOwn(obj, key)

function normalize(data){
    const folders = []
    const ids = new Set()
    if(Array.isArray(data?.folders)){
        for(const f of data.folders){
            if(!f || typeof f.id !== 'string' || ids.has(f.id)) continue
            if(LEGACY_FOLDERS.includes(f.id) || typeof f.name !== 'string' || !f.name.trim()) continue
            folders.push({ id: f.id, name: f.name.trim().slice(0, 60), visible: f.visible !== false })
            ids.add(f.id)
        }
    }
    const assignments = Object.create(null)
    if(data?.assignments && typeof data.assignments === 'object'){
        for(const [id, folder] of Object.entries(data.assignments)){
            if(ids.has(folder)) assignments[id] = folder
        }
    }
    return { folders, assignments }
}

exports.read = function(dir){
    try {
        return normalize(JSON.parse(fs.readFileSync(path.join(dir, 'packfolders.json'), 'utf8')))
    } catch {
        return normalize(null)
    }
}

exports.write = function(dir, state){
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'packfolders.json')
    fs.writeFileSync(file + '.tmp', JSON.stringify(normalize(state), null, 4), 'utf8')
    fs.renameSync(file + '.tmp', file)
}

function validName(state, value, except){
    const name = String(value ?? '').trim()
    if(!name || name.length > 60) throw new Error('invalidName')
    if(state.folders.some(f => f.id !== except && f.name?.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('duplicateName')
    return name
}

exports.create = function(state, name){
    const folder = { id: randomUUID(), name: validName(state, name), visible: true }
    state.folders.push(folder)
    return folder
}

exports.rename = function(state, id, name){
    const f = state.folders.find(f => f.id === id)
    if(!f) throw new Error('unknownFolder')
    f.name = validName(state, name, id)
}

exports.remove = function(state, id){
    if(!state.folders.some(f => f.id === id)) throw new Error('unknownFolder')
    state.folders = state.folders.filter(f => f.id !== id)
    for(const pack of Object.keys(state.assignments)){
        if(state.assignments[pack] === id) delete state.assignments[pack]
    }
}

exports.assign = function(state, pack, folder){
    if(folder == null){
        delete state.assignments[pack]
    } else {
        if(!state.folders.some(f => f.id === folder)) throw new Error('unknownFolder')
        Object.defineProperty(state.assignments, pack, { value: folder, enumerable: true, writable: true, configurable: true })
    }
}

exports.groups = function(state, servers){
    const groups = state.folders.map(f => ({ ...f, servers: [] }))
    const unassigned = { id: null, name: null, visible: true, unassigned: true, servers: [] }
    for(const server of servers){
        const raw = server.rawServer || server
        const id = own(state.assignments, raw.id) ? state.assignments[raw.id] : null
        const group = groups.find(f => f.id === id) || unassigned
        group.servers.push(server)
    }
    if(unassigned.servers.length > 0) groups.push(unassigned)
    return groups
}
