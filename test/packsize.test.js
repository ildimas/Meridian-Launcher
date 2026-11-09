const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { packSize, formatSize } = require('../app/assets/js/packsize')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-packsize-'))
const instance = path.join(root, 'instances', 'pack')
const common = path.join(root, 'common')

function file(target, bytes){
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Buffer.alloc(bytes))
    return target
}

after(() => fs.rmSync(root, { recursive: true, force: true }))

test('the instance folder counts with everything inside it', async () => {
    file(path.join(instance, 'options.txt'), 100)
    file(path.join(instance, 'saves', 'world', 'level.dat'), 50)
    assert.equal(await packSize(instance, []), 150)
})

test('a file out of the instance folder counts once, one inside it isn\'t counted twice', async () => {
    const mod = file(path.join(common, 'modstore', 'mod.jar'), 1000)
    const inside = path.join(instance, 'options.txt')
    assert.equal(await packSize(instance, [mod, mod, inside]), 1150)
})

test('a file that isn\'t on disk counts as nothing', async () => {
    assert.equal(await packSize(path.join(root, 'instances', 'none'), [path.join(common, 'none.jar')]), 0)
})

test('a link is not followed', { skip: process.platform === 'win32' }, async () => {
    const dir = path.join(root, 'instances', 'linked')
    file(path.join(dir, 'a.txt'), 10)
    fs.symlinkSync(root, path.join(dir, 'loop'))
    const linkSize = fs.lstatSync(path.join(dir, 'loop')).size
    assert.equal(await packSize(dir, []), 10 + linkSize)
})

test('a size is written in the largest unit that fits', () => {
    assert.equal(formatSize(512, 'en-US'), '512 byte')
    assert.equal(formatSize(1536, 'en-US'), '2 kB')
    assert.equal(formatSize(46 * 1024 ** 2, 'en-US'), '46 MB')
    assert.equal(formatSize(5.42 * 1024 ** 3, 'en-US'), '5.4 GB')
    assert.equal(formatSize(5.42 * 1024 ** 3, 'ru-RU'), '5,4 ГБ')
    assert.equal(formatSize(2048 * 1024 ** 4, 'en-US'), '2,048 TB')
})
