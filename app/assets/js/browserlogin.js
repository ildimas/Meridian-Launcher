/**
 * Microsoft sign-in in the system browser (OAuth 2.0 authorization code with
 * PKCE and a loopback redirect, RFC 8252).
 *
 * The browser already holds the player's Microsoft session, so signing in
 * takes a click there instead of typing the password into an embedded
 * window. Microsoft sends the code back to a one-shot HTTP server on
 * localhost.
 *
 * It needs http://localhost as a redirect URI of the Azure application
 * ("Mobile and desktop applications" platform, where the port is ignored).
 * Until it is there, supported() reports false and the launcher keeps the
 * embedded window.
 *
 * Runs in the main process.
 */
const crypto  = require('crypto')
const http    = require('http')

const AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
const SCOPE = 'XboxLive.signin offline_access'
const PROBE_TIMEOUT_MS = 5000
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

function base64url(buffer){
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createPkce(){
    const verifier = base64url(crypto.randomBytes(32))
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
    return { verifier, challenge }
}

function authorizeUrl(clientId, redirectUri, extra = {}){
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: SCOPE,
        redirect_uri: redirectUri,
        ...extra
    })
    return `${AUTHORIZE_URL}?${params}`
}

/**
 * Whether Microsoft accepts the loopback redirect for this client. An
 * unregistered redirect URI ends on an error page instead of the sign-in
 * form. Anything other than the form (a changed page, no network) counts as
 * unsupported: the embedded window works either way.
 *
 * @param {string} clientId The Azure application ID.
 * @param {typeof fetch} fetchImpl Electron's net.fetch, to go through the launcher's proxy.
 */
async function probe(clientId, fetchImpl){
    const res = await fetchImpl(authorizeUrl(clientId, 'http://localhost'), {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    const body = await res.text()
    return res.ok && body.includes('urlPost') && !body.includes('Error Info')
}

let supportedResult = null

/**
 * probe(), asked once per run. MERIDIAN_BROWSER_LOGIN=1 or 0 skips it.
 */
exports.supported = async function(clientId, fetchImpl){
    const forced = process.env.MERIDIAN_BROWSER_LOGIN
    if(forced === '1' || forced === '0'){
        return forced === '1'
    }
    if(supportedResult == null){
        try {
            supportedResult = await probe(clientId, fetchImpl)
        } catch {
            // No answer: try again on the next sign-in.
            return false
        }
    }
    return supportedResult
}

function page(title, text){
    const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
    return '<!doctype html><html><head><meta charset="utf-8"><title>Meridian</title>'
        + '<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;'
        + 'background:#1b1b1b;color:#e8e8e8;font-family:system-ui,sans-serif;text-align:center}'
        + 'h1{font-weight:500;font-size:22px;margin:0 0 8px}p{margin:0;color:#a8a8a8}</style></head>'
        + `<body><div><h1>${escape(title)}</h1><p>${escape(text)}</p></div></body></html>`
}

/**
 * Start a sign-in.
 *
 * Listens on a free port of 127.0.0.1 (and ::1, where browsers resolve
 * localhost first), then resolves `ready` with the authorize URL to open.
 * `result` resolves with the redirect's query (`code` or `error`, plus
 * `redirect_uri` and `code_verifier` for the token request), or with null
 * once cancelled or timed out.
 *
 * @param {Object} options
 * @param {string} options.clientId The Azure application ID.
 * @param {{title: string, text: string}} options.donePage What the browser tab shows afterwards.
 * @param {number} [options.timeoutMs] How long to wait for the browser.
 */
exports.start = function({ clientId, donePage, timeoutMs = LOGIN_TIMEOUT_MS }){
    const pkce = createPkce()
    const state = base64url(crypto.randomBytes(16))
    const servers = []
    let finish
    let timer

    const result = new Promise((resolve) => {
        finish = (value) => {
            clearTimeout(timer)
            for(const server of servers){
                server.close()
                server.closeAllConnections()
            }
            finish = () => {}
            resolve(value)
        }
    })

    let redirectUri
    const handler = (req, res) => {
        const url = new URL(req.url, redirectUri)
        if(url.pathname !== '/' || url.searchParams.get('state') !== state){
            res.writeHead(404).end()
            return
        }
        const query = Object.fromEntries(url.searchParams)
        delete query.state
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        res.end(page(donePage.title, donePage.text), () => {
            finish({ ...query, redirect_uri: redirectUri, code_verifier: pkce.verifier })
        })
    }

    const listen = (host, port) => new Promise((resolve, reject) => {
        const server = http.createServer(handler)
        server.once('error', reject)
        server.listen(port, host, () => {
            servers.push(server)
            resolve(server.address().port)
        })
    })

    const ready = listen('127.0.0.1', 0).then(async (port) => {
        // No IPv6 loopback: browsers fall back to 127.0.0.1.
        await listen('::1', port).catch(() => {})
        redirectUri = `http://localhost:${port}`
        timer = setTimeout(() => finish(null), timeoutMs)
        return authorizeUrl(clientId, redirectUri, {
            state,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            prompt: 'select_account'
        })
    })

    return {
        ready,
        result,
        cancel: () => finish(null)
    }
}

exports._createPkce = createPkce
exports._probe = probe
