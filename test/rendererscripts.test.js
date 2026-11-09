const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const espree = require('espree')

const APP = path.join(__dirname, '..', 'app')

/**
 * The scripts app.ejs loads, in order: its own <script> tags and those of the
 * views it includes.
 */
function windowScripts(view = 'app', seen = new Set()){
    const file = path.join(APP, view + '.ejs')
    if(seen.has(file)) return []
    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    const scripts = []
    const pattern = /<script src="\.\/(assets\/js\/[^"]+\.js)"><\/script>|<%-\s*include\('([^']+)'/g
    for(const match of source.matchAll(pattern)){
        if(match[1]) scripts.push(path.join(APP, match[1]))
        else scripts.push(...windowScripts(match[2], seen))
    }
    return scripts
}

function names(pattern){
    if(pattern == null) return []
    switch(pattern.type){
        case 'Identifier': return [pattern.name]
        case 'ObjectPattern': return pattern.properties.flatMap(p => names(p.type === 'RestElement' ? p.argument : p.value))
        case 'ArrayPattern': return pattern.elements.flatMap(names)
        case 'AssignmentPattern': return names(pattern.left)
        case 'RestElement': return names(pattern.argument)
        default: return []
    }
}

// Classic scripts share the window's global scope: a const, let or class
// declared in two of them is a SyntaxError that stops the later script from
// running at all, which neither ESLint nor a unit test of either file sees.
test('the window\'s scripts don\'t declare the same top-level name twice', () => {
    const scripts = windowScripts()
    assert.ok(scripts.some(s => s.endsWith('landing.js')) && scripts.some(s => s.endsWith('pack.js')))
    const lexical = new Map()
    const other = new Map()
    for(const script of scripts){
        const ast = espree.parse(fs.readFileSync(script, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' })
        for(const node of ast.body){
            const rel = path.relative(APP, script)
            if(node.type === 'VariableDeclaration'){
                const into = node.kind === 'var' ? other : lexical
                for(const d of node.declarations) for(const n of names(d.id)) into.set(n, [...(into.get(n) || []), rel])
            } else if(node.type === 'ClassDeclaration'){
                lexical.set(node.id.name, [...(lexical.get(node.id.name) || []), rel])
            } else if(node.type === 'FunctionDeclaration'){
                other.set(node.id.name, [...(other.get(node.id.name) || []), rel])
            }
        }
    }
    const clashes = []
    for(const [name, files] of lexical){
        const all = [...files, ...(other.get(name) || [])]
        if(all.length > 1) clashes.push(`${name}: ${all.join(', ')}`)
    }
    assert.deepEqual(clashes, [])
})
