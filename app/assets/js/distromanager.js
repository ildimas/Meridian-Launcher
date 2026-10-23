const { DistributionAPI, HeliosDistribution, HeliosModule } = require('helios-core/common')
const { DistributionIndexProcessor, MojangIndexProcessor } = require('helios-core/dl')
const path = require('path')

const ConfigManager = require('./configmanager')
const HeliosFixes   = require('./heliosfixes')
const LocalPacks    = require('./localpacks')

// Player-added modpacks are part of every distribution load (see localpacks.js).
LocalPacks.patchDistributionAPI(DistributionAPI)
LocalPacks.patchIndexProcessor(DistributionIndexProcessor)
HeliosFixes.patchMojangIndexProcessor(MojangIndexProcessor)
HeliosFixes.patchHeliosModule(HeliosModule)
// Before landing.js and modpackmanager.js take their functions from helios-core/java.
HeliosFixes.patchJavaGuard(require(path.join(path.dirname(require.resolve('helios-core')), 'java', 'JavaGuard.js')))

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://files.ilcloud.net/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api

/**
 * @returns {string} The distribution.json url in use: the player's or the built-in one.
 */
exports.getRemoteDistroUrl = function(){
    return ConfigManager.getDistributionURL() || exports.REMOTE_DISTRO_URL
}

/**
 * Rebuild the loaded distribution after the local modpacks changed, without
 * fetching the remote one again.
 *
 * @returns {Promise.<HeliosDistribution>} The updated distribution.
 */
exports.reloadLocalPacks = async function(){
    if(api.rawDistribution == null){
        return await api.getDistribution()
    }
    api.rawDistribution = LocalPacks.mergeInto(api.rawDistribution, api.launcherDirectory)
    api.distribution = new HeliosDistribution(api.rawDistribution, api.commonDir, api.instanceDir)
    return api.distribution
}