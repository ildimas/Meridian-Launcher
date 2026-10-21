const { DistributionAPI, HeliosDistribution } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')

const ConfigManager = require('./configmanager')
const LocalPacks    = require('./localpacks')

// Player-added modpacks are part of every distribution load (see localpacks.js).
LocalPacks.patchDistributionAPI(DistributionAPI)
LocalPacks.patchIndexProcessor(DistributionIndexProcessor)

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://helios-files.geekcorner.eu.org/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api

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