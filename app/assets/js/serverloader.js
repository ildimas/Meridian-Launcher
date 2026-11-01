const { Type } = require('helios-distribution-types')

const NAMES = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', quilt: 'Quilt' }

/** Resolve the loader label without confusing its bootstrap library with its version. */
exports.getLabel = function(server, vanillaLabel){
    const local = server.rawServer.local
    if(local?.loader){
        if(local.loader === 'vanilla') return vanillaLabel
        const name = NAMES[local.loader] || local.loader
        return local.loaderVersion ? `${name} ${local.loaderVersion}` : name
    }
    const loader = server.modules.find(m => [Type.ForgeHosted, Type.Forge, Type.Fabric].includes(m.rawModule.type))
    if(!loader) return vanillaLabel

    const { group, artifact, version } = loader.getMavenComponents()
    const manifest = loader.subModules.find(m => m.rawModule.type === Type.VersionManifest)
    const neoVersion = /^neoforge-(.+)$/i.exec(manifest?.rawModule.id || '')?.[1]
    if(neoVersion || group === 'net.neoforged' || group.startsWith('net.neoforged.')){
        // Studio may use net.neoforged.fancymodloader:loader as the main jar.
        const v = neoVersion || (group === 'net.neoforged' && ['forge', 'neoforge'].includes(artifact) ? version : null)
        return v ? `NeoForge ${stripMinecraft(v, server)}` : 'NeoForge'
    }
    const name = { 'net.minecraftforge': 'Forge', 'net.fabricmc': 'Fabric', 'org.quiltmc': 'Quilt' }[group]
        || (loader.rawModule.type === Type.Fabric ? 'Fabric' : 'Forge')
    return `${name} ${stripMinecraft(version, server)}`
}

function stripMinecraft(version, server){
    const prefix = `${server.rawServer.minecraftVersion}-`
    return version.startsWith(prefix) ? version.substring(prefix.length) : version
}
