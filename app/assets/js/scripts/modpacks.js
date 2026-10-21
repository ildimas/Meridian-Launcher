/**
 * Modpacks tab: install packs found on Modrinth and CurseForge, import pack
 * files (.mrpack, CurseForge .zip, Prism export) and add plain Minecraft
 * versions. The installing itself is in modpackmanager.js.
 */
const ModpackManager = require('./assets/js/modpackmanager')
const { reloadLocalPacks } = require('./assets/js/distromanager')
const { SHELL_OPCODE: MP_SHELL_OPCODE } = require('./assets/js/ipcconstants')

const mpState = {
    busy: false,
    source: 'modrinth',
    query: '',
    offset: 0,
    total: 0,
    // Bumped per search so late answers to an old query are dropped.
    seq: 0,
    versionsLoaded: false
}

const mpLoaderSeq = { n: 0 }

function mpEl(id){
    return document.getElementById(id)
}

/**
 * The message to show for a failed install or search.
 */
function mpErrorText(err){
    if(err instanceof ModpackManager.ModpackError){
        return Lang.queryJS(`settings.modpacks.errors.${err.key}`, err.params)
    }
    const res = err != null ? err.response : null
    if(res != null && String(res.url || '').includes('api.curseforge.com') && (res.statusCode === 401 || res.statusCode === 403)){
        return Lang.queryJS('settings.modpacks.errors.curseForgeKeyInvalid')
    }
    return Lang.queryJS('settings.modpacks.errors.generic', { message: escapeSettingsHTML(err != null && err.message ? err.message : String(err)) })
}

/* Install task */

function mpSetBusy(busy){
    mpState.busy = busy
    for(const btn of document.querySelectorAll('#mpContainer [data-install], #mpVersionInstall, #mpImport')){
        btn.disabled = busy || btn.hasAttribute('data-unsupported')
    }
}

function mpShowTask(title){
    const task = mpEl('mpTask')
    task.hidden = false
    task.removeAttribute('state')
    mpEl('mpTaskTitle').textContent = title
    mpEl('mpTaskPercent').textContent = ''
    mpEl('mpTaskDetail').textContent = Lang.queryJS('settings.modpacks.stage.fetch')
    mpEl('mpTaskFill').style.width = '0%'
    mpEl('mpTaskAction').hidden = true
    task.toggleAttribute('indeterminate', true)
}

function mpProgress(p){
    const hasCount = p.total != null && p.total > 0
    mpEl('mpTask').toggleAttribute('indeterminate', !hasCount)
    mpEl('mpTaskDetail').textContent = Lang.queryJS(`settings.modpacks.stage.${p.stage}`, { done: p.done, total: p.total })
    if(hasCount){
        const pct = Math.round(p.done / p.total * 100)
        mpEl('mpTaskPercent').textContent = pct + '%'
        mpEl('mpTaskFill').style.width = pct + '%'
    } else {
        mpEl('mpTaskPercent').textContent = ''
    }
}

function mpEndTask(state, title, detail, action){
    const task = mpEl('mpTask')
    task.setAttribute('state', state)
    task.removeAttribute('indeterminate')
    mpEl('mpTaskTitle').textContent = title
    mpEl('mpTaskPercent').textContent = ''
    mpEl('mpTaskFill').style.width = state === 'done' ? '100%' : '0%'
    mpEl('mpTaskDetail').innerHTML = detail
    const btn = mpEl('mpTaskAction')
    btn.hidden = action == null
    if(action != null){
        btn.textContent = action.label
        btn.onclick = action.run
    }
}

/**
 * Let the rest of the launcher see the changed packs.
 */
async function mpAfterChange(){
    const distro = await reloadLocalPacks()
    syncModConfigurations(distro)
    ensureJavaSettings(distro)
    renderServerPicker()
    mpRenderInstalled()
    return distro
}

/**
 * Run an install with the progress shown at the top of the tab.
 *
 * @param {string} name What is being installed, for the title.
 * @param {function(function(Object)): Promise.<Object>} job Installs and resolves to the new server.
 */
async function mpRun(name, job){
    if(mpState.busy){
        return
    }
    mpSetBusy(true)
    mpShowTask(Lang.queryJS('settings.modpacks.installing', { name }))
    mpEl('settingsTabModpacks').scrollTo({ top: 0, behavior: 'smooth' })
    try {
        const server = await job(mpProgress)
        await mpAfterChange()
        const missing = server.missing || []
        const detail = missing.length > 0
            ? Lang.queryJS('settings.modpacks.missingFiles', { count: missing.length, files: missing.map(escapeSettingsHTML).join(', ') })
            : Lang.queryJS('settings.modpacks.installedDetail')
        mpEndTask(missing.length > 0 ? 'warn' : 'done', Lang.queryJS('settings.modpacks.installed', { name: server.name }), detail, {
            label: Lang.queryJS('settings.modpacks.select'),
            run: () => mpSelect(server.id)
        })
    } catch(err) {
        console.error('Modpack install failed.', err)
        mpEndTask('error', Lang.queryJS('settings.modpacks.failed', { name }), mpErrorText(err))
    } finally {
        mpSetBusy(false)
    }
}

/* Installed packs */

async function mpSelect(id){
    const serv = (await DistroAPI.getDistribution()).getServerById(id)
    if(serv != null){
        updateSelectedServer(serv)
        mpRenderInstalled()
    }
}

function mpLoaderLabel(raw){
    const loader = raw.local.loader
    const name = ModpackManager.LOADER_NAMES[loader] || loader
    return raw.local.loaderVersion ? `${name} ${raw.local.loaderVersion}` : name
}

function mpIconButton(cls, title, svg, onclick){
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'modFolder ' + cls
    btn.title = title
    btn.setAttribute('aria-label', title)
    btn.innerHTML = svg
    btn.onclick = (e) => {
        e.stopPropagation()
        onclick()
    }
    return btn
}

function mpRenderInstalled(){
    const packs = ModpackManager.installed()
    const list = mpEl('mpInstalled')
    mpEl('mpInstalledSection').hidden = packs.length === 0
    list.innerHTML = ''
    const appearance = ConfigManager.getAppearance()
    const selected = ConfigManager.getSelectedServer()
    for(const raw of packs){
        const row = document.createElement('div')
        row.className = 'mpRow'
        row.setAttribute('role', 'listitem')
        row.toggleAttribute('selected', raw.id === selected)

        const tile = document.createElement('span')
        tile.className = 'serverListTile mpTile'
        paintServerTile(tile, raw, appearance, 'serverListTile')

        const text = document.createElement('div')
        text.className = 'mpRowText'
        const name = document.createElement('span')
        name.className = 'mpRowName'
        name.textContent = raw.name
        const meta = document.createElement('span')
        meta.className = 'mpRowMeta'
        meta.textContent = [mpLoaderLabel(raw), raw.minecraftVersion, Lang.queryJS(`settings.modpacks.source.${raw.local.source}`)].join(' · ')
        text.append(name, meta)

        const use = document.createElement('button')
        use.type = 'button'
        use.className = 'mpButton mpButtonSmall'
        use.disabled = raw.id === selected
        use.textContent = Lang.queryJS(raw.id === selected ? 'settings.modpacks.selected' : 'settings.modpacks.select')
        use.onclick = () => mpSelect(raw.id)

        const folder = mpIconButton('', Lang.queryJS('settings.modpacks.openFolder'),
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
            () => {
                const dir = ModpackManager.instanceDir(raw.id)
                DropinModUtil.validateDir(dir)
                shell.openPath(dir)
            })
        const remove = mpIconButton('mpRemove', Lang.queryJS('settings.modpacks.remove'),
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
            () => mpConfirmRemove(raw))

        row.append(tile, text, use, folder, remove)
        list.appendChild(row)
    }
}

function mpConfirmRemove(raw){
    setOverlayContent(
        Lang.queryJS('settings.modpacks.removeTitle', { name: escapeSettingsHTML(raw.name) }),
        Lang.queryJS('settings.modpacks.removeDesc'),
        Lang.queryJS('settings.modpacks.removeConfirm'),
        Lang.queryJS('settings.modpacks.removeCancel')
    )
    setOverlayHandler(async () => {
        toggleOverlay(false)
        await mpRemove(raw)
    })
    setDismissHandler(null)
    toggleOverlay(true, true)
}

async function mpRemove(raw){
    ModpackManager.remove(raw.id)
    const dir = ModpackManager.instanceDir(raw.id)
    if(await fs.pathExists(dir)){
        const res = await ipcRenderer.invoke(MP_SHELL_OPCODE.TRASH_ITEM, dir)
        if(!res.result){
            console.error('Unable to move the modpack folder to the trash.', res.error)
        }
    }
    const distro = await mpAfterChange()
    if(ConfigManager.getSelectedServer() === raw.id){
        updateSelectedServer(distro.getMainServer())
        mpRenderInstalled()
    }
}

/* Import */

function mpBindImport(){
    const card = mpEl('mpImport')
    const install = (file) => mpRun(path.basename(file), progress => ModpackManager.installFile(file, progress))
    card.onclick = async () => {
        const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            properties: ['openFile'],
            filters: [{ name: Lang.queryJS('settings.modpacks.fileFilter'), extensions: ['mrpack', 'zip'] }]
        })
        if(!res.canceled && res.filePaths.length > 0){
            install(res.filePaths[0])
        }
    }
    card.ondragenter = e => {
        e.preventDefault()
        card.setAttribute('drag', '')
    }
    card.ondragover = e => e.preventDefault()
    card.ondragleave = () => card.removeAttribute('drag')
    card.ondrop = e => {
        e.preventDefault()
        card.removeAttribute('drag')
        const f = e.dataTransfer.files[0]
        if(f == null || mpState.busy){
            return
        }
        const { webUtils } = require('electron')
        install(webUtils != null && webUtils.getPathForFile != null ? webUtils.getPathForFile(f) : f.path)
    }
}

/* Plain versions */

function mpSelectedLoader(){
    return mpEl('mpLoader').querySelector('button[selected]').value
}

function mpUpdateNamePlaceholder(){
    const loader = mpSelectedLoader()
    const mc = mpEl('mpMinecraft').value
    mpEl('mpName').placeholder = mc ? (loader === 'vanilla' ? `Minecraft ${mc}` : `${ModpackManager.LOADER_NAMES[loader]} ${mc}`) : ''
}

function mpFillSelect(select, options){
    select.innerHTML = ''
    for(const o of options){
        const opt = document.createElement('option')
        opt.value = o.value
        opt.textContent = o.label
        select.appendChild(opt)
    }
}

/**
 * Reload the loader version list for the chosen loader and Minecraft version.
 */
async function mpRefreshLoaderVersions(){
    const loader = mpSelectedLoader()
    const field = mpEl('mpLoaderVersionField')
    const select = mpEl('mpLoaderVersion')
    const install = mpEl('mpVersionInstall')
    field.hidden = loader === 'vanilla'
    install.removeAttribute('data-unsupported')
    install.disabled = mpState.busy
    mpUpdateNamePlaceholder()
    if(loader === 'vanilla'){
        return
    }
    const seq = ++mpLoaderSeq.n
    const mc = mpEl('mpMinecraft').value
    mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.loading') }])
    select.disabled = true
    let versions = []
    try {
        versions = await ModpackManager.loaderVersions(loader, mc)
    } catch(err) {
        console.error('Unable to load loader versions.', err)
    }
    if(seq !== mpLoaderSeq.n){
        return
    }
    if(versions.length === 0){
        mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.loaderUnavailable') }])
        install.setAttribute('data-unsupported', '')
        install.disabled = true
        return
    }
    const latest = versions.find(v => v.stable) || versions[0]
    mpFillSelect(select, [
        { value: '', label: Lang.queryJS('settings.modpacks.latestStable', { version: latest.version }) },
        ...versions.map(v => ({ value: v.version, label: v.version }))
    ])
    select.disabled = false
}

async function mpLoadVersions(){
    if(mpState.versionsLoaded){
        return
    }
    mpState.versionsLoaded = true
    const select = mpEl('mpMinecraft')
    mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.loading') }])
    try {
        const versions = await ModpackManager.minecraftVersions()
        mpFillSelect(select, versions.map(v => ({ value: v, label: v })))
    } catch(err) {
        console.error('Unable to load Minecraft versions.', err)
        mpState.versionsLoaded = false
        mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.versionsFailed') }])
    }
    await mpRefreshLoaderVersions()
}

function mpBindVersion(){
    for(const btn of mpEl('mpLoader').children){
        btn.onclick = () => {
            for(const other of mpEl('mpLoader').children){
                other.toggleAttribute('selected', other === btn)
            }
            mpRefreshLoaderVersions()
        }
    }
    mpEl('mpMinecraft').onchange = () => mpRefreshLoaderVersions()
    mpEl('mpVersionInstall').onclick = () => {
        const minecraft = mpEl('mpMinecraft').value
        if(!minecraft){
            return
        }
        const name = mpEl('mpName').value.trim() || mpEl('mpName').placeholder
        mpRun(name, progress => ModpackManager.installVersion({
            name,
            minecraft,
            loader: mpSelectedLoader(),
            loaderVersion: mpEl('mpLoaderVersion').value || undefined
        }, progress))
    }
}

/* Browse */

const mpNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

function mpResultRow(hit){
    const supported = hit.loaders.length === 0 || hit.loaders.some(ModpackManager.isSupportedLoader)
    const row = document.createElement('div')
    row.className = 'mpRow mpResult'
    row.setAttribute('role', 'listitem')

    const icon = document.createElement('span')
    icon.className = 'modIcon mpResultIcon'
    icon.textContent = (hit.title.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()
    if(hit.icon){
        const img = document.createElement('img')
        img.alt = ''
        img.loading = 'lazy'
        img.onload = () => icon.setAttribute('hasIcon', '')
        img.onerror = () => img.remove()
        img.src = hit.icon
        icon.appendChild(img)
    }

    const text = document.createElement('div')
    text.className = 'mpRowText'
    const title = document.createElement('a')
    title.className = 'mpRowName mpResultTitle'
    title.textContent = hit.title
    title.href = '#'
    title.title = Lang.queryJS('settings.modpacks.openPage')
    title.onclick = (e) => {
        e.preventDefault()
        if(hit.url) shell.openExternal(hit.url)
    }
    const desc = document.createElement('span')
    desc.className = 'mpResultDesc'
    desc.textContent = hit.description || ''
    const meta = document.createElement('div')
    meta.className = 'mpResultMeta'
    const parts = []
    if(hit.author) parts.push(Lang.queryJS('settings.modpacks.by', { author: escapeSettingsHTML(hit.author) }))
    parts.push(Lang.queryJS('settings.modpacks.downloads', { count: mpNumber.format(hit.downloads || 0) }))
    if(hit.minecraft) parts.push(escapeSettingsHTML(hit.minecraft))
    meta.innerHTML = parts.map(p => `<span>${p}</span>`).join('')
    for(const l of hit.loaders){
        const chip = document.createElement('span')
        chip.className = 'mpChip'
        chip.toggleAttribute('unsupported', !ModpackManager.isSupportedLoader(l))
        chip.textContent = ModpackManager.LOADER_NAMES[l] || l
        meta.appendChild(chip)
    }
    text.append(title, desc, meta)

    const install = document.createElement('button')
    install.type = 'button'
    install.className = 'mpButton'
    install.setAttribute('data-install', '')
    install.textContent = Lang.queryJS('settings.modpacks.install')
    if(!supported){
        install.setAttribute('data-unsupported', '')
        install.title = Lang.queryJS('settings.modpacks.unsupportedHint', { loader: hit.loaders.map(l => ModpackManager.LOADER_NAMES[l] || l).join(', ') })
    }
    install.disabled = mpState.busy || !supported
    install.onclick = () => mpRun(hit.title, progress => hit.source === 'modrinth'
        ? ModpackManager.installModrinth(hit, progress)
        : ModpackManager.installCurseForge(hit, progress))

    row.append(icon, text, install)
    return row
}

function mpResultsNote(text){
    const list = mpEl('mpResults')
    list.innerHTML = `<div class="settingsPackEmpty">${text}</div>`
    list.setAttribute('empty', '')
    mpEl('mpMore').hidden = true
}

/**
 * Search the chosen source.
 *
 * @param {boolean} more Append the next page instead of starting over.
 */
async function mpSearch(more = false){
    const source = mpState.source
    const needsKey = source === 'curseforge' && !ModpackManager.hasCurseForge()
    mpEl('mpCurseForgeKey').hidden = !needsKey
    mpEl('mpResults').hidden = needsKey
    if(needsKey){
        mpEl('mpMore').hidden = true
        return
    }
    const seq = ++mpState.seq
    if(!more){
        mpState.offset = 0
        mpResultsNote(Lang.queryJS('settings.modpacks.loading'))
    }
    mpEl('mpMore').disabled = true
    let res
    try {
        res = source === 'modrinth'
            ? await ModpackManager.searchModrinth(mpState.query, mpState.offset)
            : await ModpackManager.searchCurseForge(mpState.query, mpState.offset)
    } catch(err) {
        if(seq === mpState.seq){
            console.error('Modpack search failed.', err)
            mpResultsNote(mpErrorText(err))
        }
        return
    }
    if(seq !== mpState.seq){
        return
    }
    const list = mpEl('mpResults')
    if(!more){
        list.innerHTML = ''
        list.removeAttribute('empty')
    }
    if(!more && res.hits.length === 0){
        mpResultsNote(Lang.queryJS('settings.modpacks.noResults'))
        return
    }
    for(const hit of res.hits){
        list.appendChild(mpResultRow(hit))
    }
    mpState.offset += res.hits.length
    mpState.total = res.total
    const moreBtn = mpEl('mpMore')
    moreBtn.hidden = mpState.offset >= res.total || res.hits.length === 0
    moreBtn.disabled = false
}

function mpBindBrowse(){
    for(const btn of mpEl('mpSource').children){
        btn.onclick = () => {
            if(btn.hasAttribute('selected')) return
            for(const other of mpEl('mpSource').children){
                other.toggleAttribute('selected', other === btn)
            }
            mpState.source = btn.value
            mpSearch()
        }
    }
    let timer = null
    mpEl('mpSearchInput').oninput = (e) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            mpState.query = e.target.value.trim()
            mpSearch()
        }, 350)
    }
    mpEl('mpMore').onclick = () => mpSearch(true)
    mpEl('mpCurseForgeKeyInput').value = ConfigManager.getCurseForgeApiKey()
    mpEl('mpCurseForgeKeySave').onclick = () => {
        ConfigManager.setCurseForgeApiKey(mpEl('mpCurseForgeKeyInput').value)
        ConfigManager.save()
        mpSearch()
    }
}

/* Tab */

let mpOpened = false

/**
 * Called when the tab is shown; loads the lists the first time.
 */
function mpOnShow(){
    mpRenderInstalled()
    if(!mpOpened){
        mpOpened = true
        mpLoadVersions()
        mpSearch()
    }
}

mpBindImport()
mpBindVersion()
mpBindBrowse()
document.querySelector('.settingsNavItem[rSc="settingsTabModpacks"]').addEventListener('click', mpOnShow)
