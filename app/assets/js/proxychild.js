/**
 * Preloaded (--require) into helios-core's download process, which is a
 * separate Node child and doesn't inherit the renderer's proxy agents.
 * The proxy configuration arrives through the environment.
 */
const fs = require('fs')
const ProxyAgent = require('./proxyagent')

// helios-core fsyncs stdout before reporting an error to the launcher. stdout
// is a pipe here, and fsync on a pipe fails with EINVAL on Linux, which kills
// the error report and leaves the launch hanging. There's nothing to flush on
// a pipe, so ignore that case.
const fsyncSync = fs.fsyncSync
fs.fsyncSync = function(fd){
    try {
        return fsyncSync(fd)
    } catch(err) {
        if(err.code !== 'EINVAL'){
            throw err
        }
    }
}

ProxyAgent.installRequestTimeouts()

const raw = process.env.CUSTOM_LAUNCHER_PROXY
if(raw){
    try {
        ProxyAgent.applyGlobalAgent(JSON.parse(raw))
    } catch(err) {
        console.error('Unable to apply the launcher proxy in the download process.', err)
    }
}
