/**
 * Proxy agents and request timeouts for Node traffic.
 *
 * Kept free of Electron and launcher modules so it can also run inside the
 * helios-core download process (see proxychild.js), which is a plain Node
 * child and doesn't share the renderer's agents.
 */
const http                = require('http')
const https               = require('https')
const got                 = require('got')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { SocksProxyAgent } = require('socks-proxy-agent')

// Keep the original agents so the proxy can be turned off without a restart.
const DIRECT_HTTP_AGENT  = http.globalAgent
const DIRECT_HTTPS_AGENT = https.globalAgent

// A download that receives nothing for this long fails instead of hanging.
const REQUEST_TIMEOUT = {
    lookup: 15000,
    connect: 15000,
    secureConnect: 15000,
    socket: 30000
}

/**
 * Build the proxy URL (with credentials) for a configuration.
 *
 * @param {Object} proxy The proxy configuration.
 * @returns {string} The proxy URL.
 */
function toUrl(proxy){
    // socks5h resolves hostnames on the proxy side, so DNS for blocked hosts goes through it too.
    const url = new URL(`${proxy.type === 'socks5' ? 'socks5h' : 'http'}://${proxy.host}:${proxy.port}`)
    if(proxy.username){
        url.username = proxy.username
        url.password = proxy.password || ''
    }
    return url.toString()
}

/**
 * Create an agent which tunnels requests through the proxy.
 *
 * @param {Object} proxy The proxy configuration.
 * @param {Object} [options] Agent options, e.g. keepAlive.
 */
exports.createAgent = function(proxy, options){
    const url = toUrl(proxy)
    return proxy.type === 'socks5' ? new SocksProxyAgent(url, options) : new HttpsProxyAgent(url, options)
}

/**
 * Route this process's Node requests through the proxy, or directly.
 *
 * @param {Object | null} proxy A validated proxy configuration, or null for direct.
 */
exports.applyGlobalAgent = function(proxy){
    if(proxy != null){
        // Kept-alive tunnels: thousands of small pack files would otherwise
        // each pay for a new connection and TLS handshake through the proxy.
        const agent = exports.createAgent(proxy, { keepAlive: true })
        http.globalAgent = agent
        https.globalAgent = agent
    } else {
        http.globalAgent = DIRECT_HTTP_AGENT
        https.globalAgent = DIRECT_HTTPS_AGENT
    }
}

/**
 * Give got's streaming downloads a timeout. helios-core streams every file
 * with no timeout, so a connection that stalls (e.g. a throttled host)
 * would otherwise hang the launch forever.
 */
exports.installRequestTimeouts = function(){
    if(got.stream.__timeouts){
        return
    }
    const stream = got.stream
    got.stream = function(url, options = {}){
        return stream.call(got, url, Object.assign({ timeout: REQUEST_TIMEOUT }, options))
    }
    got.stream.__timeouts = true
}
