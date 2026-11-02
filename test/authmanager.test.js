const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { RestResponseStatus } = require('helios-core/common')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')

// ConfigManager lives in Electron: replace it with one expired Microsoft session.
const configPath = require.resolve('../app/assets/js/configmanager')
let account
let saved
require.cache[configPath] = { exports: {
    getSelectedAccount: () => account,
    updateMicrosoftAuthAccount: (uuid, mcAccess) => { account.accessToken = mcAccess },
    addMicrosoftAuthAccount: (uuid, mcAccess, name, mcExpires, msAccess, msRefresh) => {
        account = { type: 'microsoft', uuid, accessToken: mcAccess, microsoft: { access_token: msAccess, refresh_token: msRefresh } }
        return account
    },
    save: () => { saved = true }
} }
const got = require('got')
const AuthManager = require('../app/assets/js/authmanager')

const HOUR = 3600 * 1000
const error = (name) => ({ responseStatus: RestResponseStatus.ERROR, error: Object.assign(new Error(name), { name }), microsoftErrorCode: MicrosoftErrorCode.UNKNOWN })

beforeEach(() => {
    saved = false
    account = {
        type: 'microsoft', uuid: 'u', accessToken: 'old', expiresAt: Date.now() - HOUR,
        microsoft: { access_token: 'ms', refresh_token: 'refresh', expires_at: Date.now() - HOUR }
    }
})

test('an unexpired session needs no network', async () => {
    account.expiresAt = Date.now() + HOUR
    MicrosoftAuth.getAccessToken = async () => { throw new Error('no request expected') }
    assert.equal(await AuthManager.validateSelected(), true)
})

test('no answer from Microsoft keeps the session', async () => {
    for(const name of ['RequestError', 'TimeoutError']){
        MicrosoftAuth.getAccessToken = async () => error(name)
        assert.equal(await AuthManager.validateSelected(), true, name)
        assert.equal(account.accessToken, 'old')
    }
})

test('a refused token ends the session', async () => {
    MicrosoftAuth.getAccessToken = async () => error('HTTPError')
    assert.equal(await AuthManager.validateSelected(), false)
})

test('no answer later in the chain keeps the session too', async () => {
    account.microsoft.expires_at = Date.now() + HOUR
    MicrosoftAuth.getXBLToken = async () => error('RequestError')
    assert.equal(await AuthManager.validateSelected(), true)
    assert.equal(saved, false)
})

test('offline accounts are never checked', async () => {
    account = { type: 'offline' }
    assert.equal(await AuthManager.validateSelected(), true)
})

function succeed(data){
    return async () => ({ responseStatus: RestResponseStatus.SUCCESS, data })
}

function stubXboxChain(){
    MicrosoftAuth.getXBLToken = succeed({})
    MicrosoftAuth.getXSTSToken = succeed({})
    MicrosoftAuth.getMCAccessToken = succeed({ access_token: 'mc', expires_in: 3600 })
    MicrosoftAuth.getMCProfile = succeed({ id: 'u', name: 'Steve' })
}

test('a browser sign-in redeems the code with its redirect URI and verifier', async () => {
    stubXboxChain()
    MicrosoftAuth.getAccessToken = async () => { throw new Error('helios-core sends the embedded redirect URI') }
    let form
    got.post = async (url, options) => {
        form = options.form
        return { body: { access_token: 'ms', refresh_token: 'refresh', expires_in: 3600 } }
    }
    const added = await AuthManager.addMicrosoftAccount('code', { redirectUri: 'http://localhost:1234', codeVerifier: 'verifier' })
    assert.equal(form.grant_type, 'authorization_code')
    assert.equal(form.code, 'code')
    assert.equal(form.redirect_uri, 'http://localhost:1234')
    assert.equal(form.code_verifier, 'verifier')
    assert.equal(added.microsoft.browser, true)
    assert.equal(saved, true)
})

test('an account from the browser refreshes without a redirect URI', async () => {
    stubXboxChain()
    account.microsoft.browser = true
    MicrosoftAuth.getAccessToken = async () => { throw new Error('helios-core sends the embedded redirect URI') }
    let form
    got.post = async (url, options) => {
        form = options.form
        return { body: { access_token: 'ms2', refresh_token: 'refresh2', expires_in: 3600 } }
    }
    assert.equal(await AuthManager.validateSelected(), true)
    assert.deepEqual(form, { client_id: form.client_id, scope: 'XboxLive.signin offline_access', grant_type: 'refresh_token', refresh_token: 'refresh' })
    assert.equal(account.accessToken, 'mc')
})

test('no answer to the browser token request keeps the session', async () => {
    account.microsoft.browser = true
    got.post = async () => { throw Object.assign(new Error('offline'), { name: 'RequestError' }) }
    assert.equal(await AuthManager.validateSelected(), true)
    assert.equal(account.accessToken, 'old')
})
