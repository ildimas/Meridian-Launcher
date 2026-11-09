const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs-extra')
const http = require('http')
const os = require('os')
const path = require('path')
require('../app/assets/js/proxyagent').installRequestDefaults()
// Patches helios-core's download process (what the launcher preloads into it).
require('../app/assets/js/downloadchild')
const { FullRepairReceiver } = require(path.join(path.dirname(require.resolve('helios-core')), 'dl', 'receivers', 'FullRepairReceiver.js'))

const NEW = 'new contents'
// Nothing listens here: a request gets no answer.
const UNREACHABLE = 'http://127.0.0.1:9'

let server
let base
let dir
let sent

before(async () => {
    server = http.createServer((req, res) => {
        if(req.url === '/broken'){
            res.statusCode = 500
            return res.end('oops')
        }
        res.end(NEW)
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-download-'))
    process.send = (message) => sent.push(message.response)
})

after(() => {
    server.close()
    fs.removeSync(dir)
    delete process.send
})

beforeEach(() => {
    sent = []
})

function receiver(url, file){
    const r = new FullRepairReceiver()
    r.assets = [{ id: file, url, path: path.join(dir, file), size: NEW.length, algo: 'md5', hash: 'x' }]
    r.processors = []
    return r
}

test('offline, files on disk stay as they are and the launch goes on', async () => {
    fs.writeFileSync(path.join(dir, 'config.txt'), 'edited by the game')
    const started = Date.now()
    await receiver(`${UNREACHABLE}/config.txt`, 'config.txt').download({})
    assert.equal(fs.readFileSync(path.join(dir, 'config.txt'), 'utf8'), 'edited by the game')
    assert.deepEqual(sent, ['downloadComplete'])
    // No ten retries a second apart.
    assert.ok(Date.now() - started < 3000)
})

test('offline, a missing file fails the launch with the network error', async () => {
    await assert.rejects(receiver(`${UNREACHABLE}/mod.jar`, 'mod.jar').download({}), { name: 'RequestError' })
    assert.deepEqual(sent, [])
})

test('offline, a missing copy of the pack\'s server list doesn\'t stop the launch', async () => {
    await receiver(`${UNREACHABLE}/servers.dat`, '.meridian-servers.dat').download({})
    assert.equal(fs.existsSync(path.join(dir, '.meridian-servers.dat')), false)
    assert.deepEqual(sent, ['downloadComplete'])
})

test('online, the file is replaced and nothing is left aside', async () => {
    fs.writeFileSync(path.join(dir, 'pack.txt'), 'old')
    await receiver(`${base}/pack.txt`, 'pack.txt').download({})
    assert.equal(fs.readFileSync(path.join(dir, 'pack.txt'), 'utf8'), NEW)
    assert.equal(fs.existsSync(path.join(dir, 'pack.txt.meridian-old')), false)
})

test('a failed download leaves the old file whole, not empty', async () => {
    fs.writeFileSync(path.join(dir, 'kept.txt'), 'old')
    await assert.rejects(receiver(`${base}/broken`, 'kept.txt').download({}))
    assert.equal(fs.readFileSync(path.join(dir, 'kept.txt'), 'utf8'), 'old')
    assert.equal(fs.existsSync(path.join(dir, 'kept.txt.meridian-old')), false)
})
