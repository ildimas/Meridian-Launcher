const {ipcRenderer}  = require('electron')
const fs             = require('fs-extra')
const os             = require('os')
const path           = require('path')

const ConfigManager  = require('./configmanager')
const { DistroAPI, getRemoteDistroUrl } = require('./distromanager')
const LangLoader     = require('./langloader')
const ProxyManager   = require('./proxymanager')
const { LoggerUtil } = require('helios-core')
// eslint-disable-next-line no-unused-vars
const { HeliosDistribution } = require('helios-core/common')

const logger = LoggerUtil.getLogger('Preloader')

logger.info('Loading..')

// Load ConfigManager
ConfigManager.load()

// Route traffic through the configured proxy before any network request.
ProxyManager.apply(ConfigManager.getProxy())

// Yuck!
// TODO Fix this
DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()
DistroAPI['remoteUrl'] = getRemoteDistroUrl()

// Load Strings
LangLoader.setupLanguage(ConfigManager.getLanguage())

/**
 * Resolve the selected server if its value has yet to be set, or if the
 * distribution no longer has it.
 *
 * @param {HeliosDistribution} data
 */
function ensureSelectedServer(data){
    if(ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null){
        logger.info('Determining default selected server..')
        ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
        ConfigManager.save()
    }
}

/**
 * 
 * @param {HeliosDistribution} data 
 * @param {Function} [then] Runs once the page has the answer.
 */
function onDistroLoad(data, then = () => {}){
    if(data != null){
        ensureSelectedServer(data)
    }
    // A local load can finish before the page scripts listen for the answer.
    const send = () => {
        ipcRenderer.send('distributionIndexDone', data != null)
        then()
    }
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', send, { once: true })
    } else {
        send()
    }
}

/**
 * Fetch the remote distribution index while the launcher is already up, and
 * hand it to the page when it changed.
 */
async function refreshDistribution(){
    const before = JSON.stringify(DistroAPI.rawDistribution)
    const data = await DistroAPI.refreshDistributionOrFallback()
    if(JSON.stringify(DistroAPI.rawDistribution) === before){
        logger.info('No newer distribution index.')
        return
    }
    logger.info('Loaded a newer distribution index.')
    ensureSelectedServer(data)
    ipcRenderer.send('distributionIndexRefreshed')
}

// The page was reloaded to change the language: the distribution was just
// fetched, so don't wait on the network again.
let reopening
try {
    reopening = sessionStorage.getItem('meridian.reopen') != null
} catch {
    reopening = false
}

// Offline first: start on the distribution index saved last time, then fetch
// the remote one in the background. Only the very first start waits on the
// network, as there is nothing saved yet.
let fromDisk = true
DistroAPI.getDistributionLocalLoadOnly()
    .catch(() => {
        fromDisk = false
        return DistroAPI.getDistribution()
    })
    .then(heliosDistro => {
        logger.info(`Loaded distribution index${fromDisk ? ' from disk' : ''}.`)

        onDistroLoad(heliosDistro, () => {
            if(fromDisk && !reopening){
                refreshDistribution().catch(err => logger.warn('Unable to refresh distribution index.', err))
            }
        })
    })
    .catch(err => {
        logger.info('Failed to load an older version of the distribution index.')
        logger.info('Application cannot run.')
        logger.error(err)

        onDistroLoad(null)
    })

// Clean up temp dir incase previous launches ended unexpectedly. 
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error while cleaning natives directory', err)
    } else {
        logger.info('Cleaned natives directory.')
    }
})