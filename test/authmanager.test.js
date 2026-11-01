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
    save: () => { saved = true }
} }
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
