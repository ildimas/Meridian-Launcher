const { ipcRenderer }     = require('electron')
const child_process       = require('child_process')
const path                = require('path')
const got                 = require('got')
const { LoggerUtil }      = require('helios-core')

const { PROXY_OPCODE }    = require('./ipcconstants')
const Lang                = require('./langloader')
const ProxyAgent          = require('./proxyagent')

const logger = LoggerUtil.getLogger('ProxyManager')

const PROXY_TYPES = ['http', 'socks5']

// Downloads in this process (Java, distribution) fail instead of hanging.
ProxyAgent.installRequestTimeouts()

/**
 * Validate a proxy configuration.
 *
 * @param {Object} proxy The proxy configuration.
 * @returns {string | null} An error key (see lang file), or null if the config is usable.
 */
exports.validate = function(proxy){
    if(!proxy.enabled){
        return null
    }
    if(!PROXY_TYPES.includes(proxy.type)){
        return 'invalidType'
    }
    if(!proxy.host || /[\s/]/.test(proxy.host)){
        return 'invalidHost'
    }
    const port = Number(proxy.port)
    if(!Number.isInteger(port) || port < 1 || port > 65535){
        return 'invalidPort'
    }
    return null
}

const createAgent = ProxyAgent.createAgent

/**
 * The proxy to use, or null for a direct connection.
 */
function activeProxy(proxy){
    return proxy.enabled && exports.validate(proxy) == null ? proxy : null
}

/**
 * Route all launcher traffic through the given proxy, or directly if it is disabled.
 *
 * Node requests (authentication, distribution, downloads, Java) use the global
 * agents; Chromium requests (Microsoft login window, auto updater) use the
 * session proxy configured by the main process.
 *
 * @param {Object} proxy The proxy configuration.
 */
exports.apply = async function(proxy){
    const active = activeProxy(proxy)
    ProxyAgent.applyGlobalAgent(active)
    if(active != null){
        logger.info(`Routing traffic through ${proxy.type} proxy ${proxy.host}:${proxy.port}.`)
    } else {
        logger.info('Using direct connection.')
    }
    try {
        await ipcRenderer.invoke(PROXY_OPCODE.SET, proxy)
    } catch(err) {
        logger.error('Failed to apply proxy to the browser session.', err)
    }
}

/**
 * Spawn a helios-core transmitter's receiver (the download / validation
 * process) with the proxy and request timeouts applied inside it. The
 * receiver is a separate Node process, so the agents set by apply() don't
 * reach it on their own.
 *
 * @param {Object} transmitter A helios-core transmitter, e.g. FullRepair.
 * @param {Object} proxy The proxy configuration.
 */
exports.spawnReceiver = function(transmitter, proxy){
    const active = activeProxy(proxy)
    const hook = path.join(__dirname, 'proxychild.js')
    // The receiver also needs the local modpacks in its distribution.
    const localHook = path.join(__dirname, 'localpackschild.js')
    // More downloads at once than helios-core's 15.
    const downloadHook = path.join(__dirname, 'downloadchild.js')
    const fork = child_process.fork
    child_process.fork = function(modulePath, args, options = {}){
        return fork.call(child_process, modulePath, args, Object.assign({}, options, {
            execArgv: (options.execArgv || process.execArgv).concat(['--require', hook, '--require', localHook, '--require', downloadHook]),
            env: Object.assign({}, options.env || process.env, {
                CUSTOM_LAUNCHER_PROXY: active != null ? JSON.stringify(active) : ''
            })
        }))
    }
    try {
        transmitter.spawnReceiver()
    } finally {
        child_process.fork = fork
    }
}

/**
 * Check that Microsoft and Mojang services are reachable through the given proxy.
 *
 * @param {Object} proxy The proxy configuration.
 * @returns {Promise.<{ok: boolean, error?: string}>} The result of the check.
 */
exports.test = async function(proxy){
    const agent = proxy.enabled ? createAgent(proxy) : undefined
    const targets = [
        'https://login.microsoftonline.com/',
        'https://api.minecraftservices.com/'
    ]
    try {
        for(const url of targets){
            // Any HTTP response (even 404) means the host is reachable.
            await got.head(url, {
                agent: agent ? { http: agent, https: agent } : undefined,
                timeout: 10000,
                retry: 0,
                throwHttpErrors: false
            })
        }
        return { ok: true }
    } catch(err) {
        return { ok: false, error: err.code || err.message }
    }
}

/**
 * Proxy arguments for the Minecraft client. The game connects directly unless
 * the user opted in to proxying it. The client only supports SOCKS proxies,
 * which it uses for authentication and skin requests.
 *
 * @param {Object} proxy The proxy configuration.
 * @returns {Array.<string>} The game arguments.
 */
exports.getGameArgs = function(proxy){
    if(!proxy.enabled || !proxy.useForGame || proxy.type !== 'socks5' || exports.validate(proxy) != null){
        return []
    }
    const args = ['--proxyHost', proxy.host, '--proxyPort', String(proxy.port)]
    if(proxy.username){
        args.push('--proxyUser', proxy.username, '--proxyPass', proxy.password || '')
    }
    return args
}

/**
 * Bind a proxy form (see proxyForm.ejs) to the stored configuration.
 *
 * @param {HTMLElement} root The form container.
 * @param {Object} ConfigManager The config manager.
 */
exports.bindForm = function(root, ConfigManager){
    const field = name => root.querySelector(`[proxyField="${name}"]`)
    const enabled = field('enabled')
    const status = root.querySelector('.proxyFormStatus')

    const read = () => ({
        enabled: enabled.checked,
        type: field('type').value,
        host: field('host').value.trim(),
        port: field('port').value.trim(),
        username: field('username').value.trim(),
        password: field('password').value,
        useForGame: field('useForGame').checked
    })

    const setStatus = (text, state) => {
        status.textContent = text
        status.setAttribute('state', state || '')
    }

    const refreshDisabled = () => {
        root.querySelectorAll('.proxyFormFields input, .proxyFormFields select')
            .forEach(el => el.disabled = !enabled.checked)
    }

    const load = () => {
        const proxy = ConfigManager.getProxy()
        enabled.checked = proxy.enabled
        field('type').value = proxy.type
        field('host').value = proxy.host
        field('port').value = proxy.port
        field('username').value = proxy.username
        field('password').value = proxy.password
        field('useForGame').checked = proxy.useForGame
        refreshDisabled()
        setStatus('')
    }

    const checkValid = proxy => {
        const err = exports.validate(proxy)
        if(err != null){
            setStatus(Lang.queryJS(`proxy.${err}`), 'error')
            return false
        }
        return true
    }

    enabled.onchange = refreshDisabled

    root.querySelector('.proxyFormTest').onclick = async (e) => {
        const proxy = read()
        if(!checkValid(proxy)){
            return
        }
        e.target.disabled = true
        setStatus(Lang.queryJS('proxy.testing'))
        const res = await exports.test(proxy)
        e.target.disabled = false
        if(res.ok){
            setStatus(Lang.queryJS('proxy.testOk'), 'ok')
        } else {
            setStatus(Lang.queryJS('proxy.testFailed', { error: res.error }), 'error')
        }
    }

    root.querySelector('.proxyFormSave').onclick = async () => {
        const proxy = read()
        if(!checkValid(proxy)){
            return
        }
        ConfigManager.setProxy(proxy)
        ConfigManager.save()
        await exports.apply(ConfigManager.getProxy())
        if(proxy.enabled && proxy.type === 'socks5' && proxy.username){
            setStatus(Lang.queryJS('proxy.socksAuthWarning'), 'warn')
        } else {
            setStatus(Lang.queryJS('proxy.saved'), 'ok')
        }
        root.dispatchEvent(new CustomEvent('proxysaved'))
    }

    load()
    return { load }
}
