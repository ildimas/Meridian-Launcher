const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs-extra')
const http = require('http')
const os = require('os')
const path = require('path')
const { MojangIndexProcessor } = require('helios-core/dl')
const HeliosFixes = require('../app/assets/js/heliosfixes')
require('../app/assets/js/proxyagent').installRequestDefaults()

HeliosFixes.patchMojangIndexProcessor(MojangIndexProcessor)

// Mojang's bytes: formatted as Mojang publishes them, not as JSON.stringify would.
const BODY = '{\n  "objects": {}\n}\n'
const HASH = { algo: 'sha1', value: crypto.createHash('sha1').update(BODY).digest('hex') }
// Nothing listens here: a request gets no answer.
const UNREACHABLE = 'http://127.0.0.1:9/index.json'

let server
let url
let dir
const processor = () => new MojangIndexProcessor(dir, '1.21')

before(async () => {
    server = http.createServer((req, res) => res.end(BODY))
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${server.address().port}/index.json`
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-index-'))
})

after(() => {
    server.close()
    fs.removeSync(dir)
})

test('a download is saved as it came, so its hash matches next time', async () => {
    const file = path.join(dir, 'saved.json')
    assert.deepEqual(await processor().loadContentWithRemoteFallback(url, file, HASH), { objects: {} })
    assert.equal(fs.readFileSync(file, 'utf8'), BODY)
    // Matching now: no request.
    assert.deepEqual(await processor().loadContentWithRemoteFallback(UNREACHABLE, file, HASH), { objects: {} })
})

test('offline, the copy on disk is used whatever its hash', async () => {
    const file = path.join(dir, 'old.json')
    fs.writeFileSync(file, JSON.stringify({ objects: { old: true } }))
    assert.deepEqual(await processor().loadContentWithRemoteFallback(UNREACHABLE, file, HASH), { objects: { old: true } })
})

test('offline with nothing on disk gives null', async () => {
    assert.equal(await processor().loadContentWithRemoteFallback(UNREACHABLE, path.join(dir, 'none.json'), HASH), null)
})
