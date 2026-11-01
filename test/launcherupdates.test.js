const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pickNewer } = require('../app/assets/js/launcherupdates')

const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://example.com/${tag}`, draft: false, prerelease: false, ...extra })

test('the newest release above the running version', () => {
    const releases = [release('v1.1.3'), release('v1.2.0'), release('v1.1.2'), release('v1.0.9')]
    assert.deepEqual(pickNewer(releases, '1.1.2', false), { version: '1.2.0', url: 'https://example.com/v1.2.0' })
})

test('nothing when the running version is the newest', () => {
    assert.equal(pickNewer([release('v1.1.2'), release('v1.0.9')], '1.1.2', false), null)
})

test('pre-releases count only when allowed', () => {
    const releases = [release('v1.2.0-beta.1', { prerelease: true }), release('v1.1.3')]
    assert.equal(pickNewer(releases, '1.1.2', false).version, '1.1.3')
    assert.equal(pickNewer(releases, '1.1.2', true).version, '1.2.0-beta.1')
})

test('drafts and odd tags are skipped', () => {
    const releases = [release('v9.0.0', { draft: true }), release('nightly'), release('v1.1.3')]
    assert.equal(pickNewer(releases, '1.1.2', false).version, '1.1.3')
})
