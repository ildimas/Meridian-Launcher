const { test } = require('node:test')
const assert = require('node:assert/strict')

// The launcher is CommonJS. A dependency that turns into an ES module still
// loads through require(), but as a namespace object, and every call into it
// fails at run time only: got 16 shipped in 1.2.0 and broke adding packs,
// the catalog and pack icons with "got.extend is not a function".
test('got loads through require() as the function the launcher calls', () => {
    const got = require('got')
    assert.equal(typeof got, 'function')
    for(const method of ['extend', 'get', 'post', 'stream']){
        assert.equal(typeof got[method], 'function', `got.${method}`)
    }
})
