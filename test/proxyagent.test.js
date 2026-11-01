const { test } = require('node:test')
const assert = require('node:assert/strict')
const got = require('got')
const ProxyAgent = require('../app/assets/js/proxyagent')

test('Chromium proxy answers become proxy configurations', () => {
    assert.deepEqual(ProxyAgent.parseChromiumProxy('PROXY 127.0.0.1:2080'), { enabled: true, type: 'http', host: '127.0.0.1', port: '2080', username: '', password: '' })
    assert.equal(ProxyAgent.parseChromiumProxy('SOCKS5 proxy.local:1080; DIRECT').type, 'socks5')
    assert.equal(ProxyAgent.parseChromiumProxy('PROXY [::1]:3128').host, '::1')
})

test('direct connections and proxies Node cannot use give null', () => {
    for(const rules of ['DIRECT', 'HTTPS proxy:443', 'SOCKS proxy:1080', '', null]){
        assert.equal(ProxyAgent.parseChromiumProxy(rules), null, rules)
    }
})

test('every got request gets a timeout, unless it sets its own', () => {
    ProxyAgent.installRequestDefaults()
    assert.deepEqual(got.extend({ retry: 0 }).defaults.options.timeout, ProxyAgent.REQUEST_TIMEOUT)
    assert.deepEqual(got.extend({ retry: { limit: 1 } }).defaults.options.retry.errorCodes, [])
    assert.deepEqual(got.extend({ timeout: { request: 1234 } }).defaults.options.timeout.request, 1234)
})
