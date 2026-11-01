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

// How long the proxy may take to open a tunnel.
const PROXY_CONNECT_MS = 15000

exports.REQUEST_TIMEOUT = REQUEST_TIMEOUT

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
    const agent = proxy.type === 'socks5' ? new SocksProxyAgent(url, options) : new HttpsProxyAgent(url, options)
    // got's timeouts start once a request has its socket, and the agent hands
    // it over only when the proxy has opened the tunnel. A proxy that never
    // answers would hold the request forever: fail it instead.
    const connect = agent.connect.bind(agent)
    agent.connect = (req, opts) => new Promise((resolve, reject) => {
        let late = false
        const timer = setTimeout(() => {
            late = true
            reject(Object.assign(new Error(`The proxy didn't open a connection in ${PROXY_CONNECT_MS}ms`), { code: 'ETIMEDOUT' }))
        }, PROXY_CONNECT_MS)
        connect(req, opts).then(socket => {
            clearTimeout(timer)
            if(late) socket.destroy()
            else resolve(socket)
        }, err => {
            clearTimeout(timer)
            reject(err)
        })
    })
    return agent
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
 * The proxy Chromium picked, from session.resolveProxy(): "PROXY host:port",
 * "SOCKS5 host:port" or "DIRECT", maybe followed by fallbacks after ";".
 *
 * @param {string} rules Chromium's answer.
 * @returns {Object | null} A proxy configuration, or null for a direct
 * connection or a proxy Node can't use (HTTPS, SOCKS4).
 */
exports.parseChromiumProxy = function(rules){
    const [kind, address] = String(rules || '').split(';')[0].trim().split(/\s+/)
    const type = kind === 'PROXY' ? 'http' : kind === 'SOCKS5' ? 'socks5' : null
    const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(address || '')
    if(type == null || match == null){
        return null
    }
    return { enabled: true, type, host: match[1], port: match[2], username: '', password: '' }
}

/**
 * Give every got request a timeout. helios-core makes its requests (sign-in,
 * Mojang, Java, streamed downloads) with none, so a connection that stalls
 * (a throttled host, a network that drops packets, a proxy that hangs) would
 * otherwise hang sign-in or the launch for minutes. A timeout the caller
 * sets wins.
 *
 * Instances made with got.extend() take it from then on: run this before
 * helios-core's sign-in modules load (proxymanager.js does).
 */
exports.installRequestTimeouts = function(){
    if(got.__timeouts){
        return
    }
    const withTimeout = options => options != null && options.timeout != null ? options : Object.assign({ timeout: REQUEST_TIMEOUT }, options)
    for(const method of ['stream', 'get', 'post', 'put', 'patch', 'head', 'delete']){
        const original = got[method]
        got[method] = function(url, options){
            // got(options) with the url inside them.
            if(options == null && url != null && typeof url === 'object' && !(url instanceof URL)){
                return original.call(got, withTimeout(url))
            }
            return original.call(got, url, withTimeout(options))
        }
    }
    const extend = got.extend
    got.extend = (...instancesOrOptions) => extend.call(got, { timeout: REQUEST_TIMEOUT }, ...instancesOrOptions)
    got.__timeouts = true
}
