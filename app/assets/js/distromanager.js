const got  = require('got')
const { DistributionAPI, HeliosDistribution, HeliosModule, RestResponseStatus, handleGotError } = require('helios-core/common')
const { DistributionIndexProcessor, MojangIndexProcessor } = require('helios-core/dl')
const { LoggerUtil } = require('helios-core')
const path = require('path')

const ConfigManager = require('./configmanager')
const { REQUEST_TIMEOUT } = require('./proxyagent')
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

// helios-core fetches distribution.json with no timeout: on a network that
// drops the connection without an answer, the request hangs for minutes.
// Give up like a stalled download does; the saved copy is used meanwhile.
const logger = LoggerUtil.getLogger('DistroManager')
api.pullRemote = async function(){
    try {
        const res = await got.get(this.remoteUrl, {
            responseType: 'json',
            timeout: REQUEST_TIMEOUT,
            retry: { limit: 1 }
        })
        return { data: res.body, responseStatus: RestResponseStatus.SUCCESS }
    } catch(error) {
        return handleGotError('Pull Remote', error, logger, () => null)
    }
}

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