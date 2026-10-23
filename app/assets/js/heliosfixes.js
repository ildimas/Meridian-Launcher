/**
 * Fixes to helios-core for Minecraft versions it doesn't expect, applied to
 * its classes at load time. Loaded in the renderer (distromanager.js) and in
 * helios-core's download process (localpackschild.js). No Electron here.
 */

/**
 * Versions before 1.7 don't log through Log4j, so their version manifest has
 * no logging config to download.
 *
 * @param {Function} MojangIndexProcessor helios-core's processor class.
 */
exports.patchMojangIndexProcessor = function(MojangIndexProcessor){
    const proto = MojangIndexProcessor.prototype
    if(proto.heliosFixesPatched){
        return
    }
    proto.heliosFixesPatched = true
    const original = proto.validateLogConfig
    proto.validateLogConfig = async function(versionJson, ...args){
        if(versionJson.logging?.client?.file == null){
            return []
        }
        return original.call(this, versionJson, ...args)
    }
}
