const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const http = require('http')

const BrowserLogin = require('../app/assets/js/browserlogin')

const donePage = { title: 'Signed in', text: 'Close <this> tab' }

function get(url){
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => resolve({ status: res.statusCode, body }))
        }).on('error', reject)
    })
}

function redirectTo(authorizeUrl, query){
    const params = new URL(authorizeUrl).searchParams
    const url = new URL(params.get('redirect_uri'))
    for(const [key, value] of Object.entries(query)){
        url.searchParams.set(key, value)
    }
    return url.toString().replace('localhost', '127.0.0.1')
}

afterEach(() => {
    delete process.env.MERIDIAN_BROWSER_LOGIN
})

test('the PKCE challenge is the S256 of the verifier', () => {
    const { verifier, challenge } = BrowserLogin._createPkce()
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'))
})

test('the redirect brings back the code, the redirect URI and the verifier', async () => {
    const login = BrowserLogin.start({ clientId: 'client', donePage })
    const authorize = await login.ready
    const params = new URL(authorize).searchParams
    assert.equal(params.get('client_id'), 'client')
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.match(params.get('redirect_uri'), /^http:\/\/localhost:\d+$/)

    const page = await get(redirectTo(authorize, { code: 'abc', state: params.get('state') }))
    assert.equal(page.status, 200)
    assert.match(page.body, /Signed in/)
    assert.match(page.body, /Close &#60;this&#62; tab/)

    const result = await login.result
    assert.equal(result.code, 'abc')
    assert.equal(result.state, undefined)
    assert.equal(result.redirect_uri, params.get('redirect_uri'))
    assert.equal(crypto.createHash('sha256').update(result.code_verifier).digest('base64url'), params.get('code_challenge'))

    // One sign-in, one redirect: the server is gone.
    await assert.rejects(get(redirectTo(authorize, { code: 'again', state: params.get('state') })), { code: 'ECONNREFUSED' })
})

test('a redirect with another state is ignored', async () => {
    const login = BrowserLogin.start({ clientId: 'client', donePage })
    const authorize = await login.ready
    const forged = await get(redirectTo(authorize, { code: 'forged', state: 'other' }))
    assert.equal(forged.status, 404)

    const state = new URL(authorize).searchParams.get('state')
    await get(redirectTo(authorize, { code: 'real', state }))
    assert.equal((await login.result).code, 'real')
})

test('an error from Microsoft is passed on', async () => {
    const login = BrowserLogin.start({ clientId: 'client', donePage })
    const authorize = await login.ready
    const state = new URL(authorize).searchParams.get('state')
    await get(redirectTo(authorize, { error: 'access_denied', error_description: 'The user cancelled', state }))
    const result = await login.result
    assert.equal(result.error, 'access_denied')
    assert.equal(result.code, undefined)
})

test('the browser reaches localhost over IPv6 too', async (t) => {
    const login = BrowserLogin.start({ clientId: 'client', donePage })
    const authorize = await login.ready
    const params = new URL(authorize).searchParams
    const url = redirectTo(authorize, { code: 'v6', state: params.get('state') }).replace('127.0.0.1', '[::1]')
    try {
        await get(url)
    } catch(err) {
        login.cancel()
        t.skip(`no IPv6 loopback here (${err.code})`)
        return
    }
    assert.equal((await login.result).code, 'v6')
})

test('cancelling or timing out resolves with nothing', async () => {
    const cancelled = BrowserLogin.start({ clientId: 'client', donePage })
    await cancelled.ready
    cancelled.cancel()
    assert.equal(await cancelled.result, null)

    const abandoned = BrowserLogin.start({ clientId: 'client', donePage, timeoutMs: 50 })
    await abandoned.ready
    assert.equal(await abandoned.result, null)
})

function respond(body, ok = true){
    return async () => ({ ok, text: async () => body })
}

test('the probe tells the sign-in form from the error page', async () => {
    assert.equal(await BrowserLogin._probe('client', respond('<script>var ServerData={urlPost:"..."}</script>')), true)
    assert.equal(await BrowserLogin._probe('client', respond('<!-------Error Info------- HR=0x80049D57 -->')), false)
    assert.equal(await BrowserLogin._probe('client', respond('urlPost', false)), false)
})

test('supported() asks once, retries after no answer, and can be forced', async () => {
    let asked = 0
    const offline = async () => { asked++; throw new Error('offline') }
    assert.equal(await BrowserLogin.supported('client', offline), false)
    assert.equal(await BrowserLogin.supported('client', offline), false)
    assert.equal(asked, 2)

    const unsupported = async () => { asked++; return { ok: true, text: async () => 'Error Info' } }
    assert.equal(await BrowserLogin.supported('client', unsupported), false)
    assert.equal(await BrowserLogin.supported('client', unsupported), false)
    assert.equal(asked, 3)

    process.env.MERIDIAN_BROWSER_LOGIN = '1'
    assert.equal(await BrowserLogin.supported('client', offline), true)
    process.env.MERIDIAN_BROWSER_LOGIN = '0'
    assert.equal(await BrowserLogin.supported('client', offline), false)
    assert.equal(asked, 3)
})
