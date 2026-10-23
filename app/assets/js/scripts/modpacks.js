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
    versionsLoaded: false,
    // Hand-made pack files attached to the version card: { path, found }.
    files: null
}

const mpLoaderSeq = { n: 0 }

const mpFollowFill = progressFollower(p => {
    mpEl('mpTaskFill').style.width = p + '%'
})

function mpEl(id){
    return document.getElementById(id)
}

/**
 * The message to show for a failed install or search.
 */
function mpErrorText(err){
    if(err instanceof ModpackManager.ModpackError){
        const params = Object.fromEntries(Object.entries(err.params).map(([k, v]) => [k, escapeSettingsHTML(String(v))]))
        return Lang.queryJS(`settings.modpacks.errors.${err.key}`, params)
    }
    if(mpKeyError(err) === 'invalid'){
        return Lang.queryJS('settings.modpacks.errors.curseForgeKeyInvalid')
    }
    return Lang.queryJS('settings.modpacks.errors.generic', { message: escapeSettingsHTML(err != null && err.message ? err.message : String(err)) })
}

/**
 * Whether an error is down to the CurseForge API key.
 *
 * @returns {'missing' | 'invalid' | null}
 */
function mpKeyError(err){
    if(err instanceof ModpackManager.ModpackError){
        return err.key === 'curseForgeKey' ? 'missing' : null
    }
    const res = err != null ? err.response : null
    if(res != null && String(res.url || '').includes('api.curseforge.com') && (res.statusCode === 401 || res.statusCode === 403)){
        return 'invalid'
    }
    return null
}

/* Install task */

function mpSetBusy(busy){
    mpState.busy = busy
    for(const btn of document.querySelectorAll('#mpContainer [data-install], #mpVersionInstall, #mpImport, #mpFilesPick, #mpFilesClear')){
        btn.disabled = busy || btn.hasAttribute('data-unsupported')
    }
}

function mpShowTask(title){
    mpStopWatch()
    const task = mpEl('mpTask')
    task.hidden = false
    task.removeAttribute('state')
    mpEl('mpTaskTitle').textContent = title
    mpEl('mpTaskPercent').textContent = ''
    mpEl('mpTaskDetail').textContent = Lang.queryJS('settings.modpacks.stage.fetch')
    mpFollowFill(0)
    mpEl('mpTaskAction').hidden = true
    mpEl('mpTaskSecondary').hidden = true
    task.toggleAttribute('indeterminate', true)
}

function mpProgress(p){
    const hasCount = p.total != null && p.total > 0
    mpEl('mpTask').toggleAttribute('indeterminate', !hasCount)
    mpEl('mpTaskDetail').textContent = Lang.queryJS(`settings.modpacks.stage.${p.stage}`, { done: p.done, total: p.total })
    if(hasCount){
        const pct = Math.round(p.done / p.total * 100)
        mpEl('mpTaskPercent').textContent = pct + '%'
        mpFollowFill(pct)
    } else {
        mpEl('mpTaskPercent').textContent = ''
    }
}

function mpEndTask(state, title, detail, action, secondary){
    const task = mpEl('mpTask')
    task.setAttribute('state', state)
    task.removeAttribute('indeterminate')
    mpEl('mpTaskTitle').textContent = title
    mpEl('mpTaskPercent').textContent = ''
    mpFollowFill(state === 'done' ? 100 : 0)
    mpEl('mpTaskDetail').innerHTML = detail
    for(const [btn, a] of [[mpEl('mpTaskAction'), action], [mpEl('mpTaskSecondary'), secondary]]){
        btn.hidden = a == null
        btn.disabled = false
        if(a != null){
            btn.textContent = a.label
            btn.onclick = a.run
        }
    }
}

/**
 * A file as a list item, linked to its CurseForge page when known.
 */
/**
 * A missing file as a list item: a direct download link when there is one,
 * else its CurseForge page, and why the launcher couldn't fetch it.
 */
function mpFileItem(f){
    const name = escapeSettingsHTML(f.name)
    const href = f.direct || f.url
    const label = href ? `<a href="${escapeSettingsHTML(href)}" data-file>${name}</a>` : name
    const note = f.blocked ? Lang.queryJS('settings.modpacks.blockedByAuthor')
        : f.removed ? Lang.queryJS('settings.modpacks.removedFromSite')
            : Lang.queryJS('settings.modpacks.netError')
    // The technical reason (e.g. ECONNREFUSED) stays in the tooltip.
    const title = f.reason ? ` title="${escapeSettingsHTML(f.reason)}"` : ''
    return `<li>${label} <span class="mpFileNote"${title}>${escapeSettingsHTML(note)}</span></li>`
}

/**
 * Show how an install went: mods whose authors keep them out of other
 * launchers' packs, and files that couldn't be downloaded, each linked to its
 * page so it can be fetched by hand and picked up from Downloads.
 *
 * @param {Object} server The installed server.
 * @param {Array.<Object>} missing Files still missing.
 * @param {Object} last found: how many the last check brought in, error: why it failed.
 */
// Files fetched through the browser are picked up from Downloads: how long to
// wait for them and how often to look.
const MP_WATCH = { ms: 10 * 60 * 1000, every: 2500 }
let mpWatch = null

function mpStopWatch(){
    if(mpWatch != null){
        clearInterval(mpWatch.timer)
        mpWatch = null
    }
}

/**
 * Show how an install went. Files that couldn't be downloaded are listed with
 * direct links; "Download in browser" opens them all and the launcher adds
 * each one to the pack as it lands in Downloads.
 *
 * @param {Object} server The installed pack.
 * @param {Array.<Object>} missing Files still missing.
 * @param {{watching?: boolean, timedOut?: boolean, found?: number, error?: string}} view
 */
function mpShowResult(server, missing, view = {}){
    const select = { label: Lang.queryJS('settings.modpacks.select'), run: () => mpSelect(server.id) }
    const restricted = server.restricted || []
    const total = server.missingTotal || missing.length
    const title = missing.length > 0
        ? Lang.queryJS('settings.modpacks.missingTitle', { name: server.name, count: missing.length })
        : Lang.queryJS('settings.modpacks.installed', { name: server.name })
    let detail = ''
    if(missing.length > 0){
        const lead = view.watching ? Lang.queryJS('settings.modpacks.waiting', { found: total - missing.length, total })
            : view.timedOut ? Lang.queryJS('settings.modpacks.waitTimedOut')
                : Lang.queryJS('settings.modpacks.missingLead')
        detail += `<p>${lead}</p>`
            + `<details class="mpFiles"${missing.length <= 5 ? ' open' : ''}><summary>${Lang.queryJS('settings.modpacks.fileList', { count: missing.length })}</summary>`
            + `<ul class="mpMissing">${missing.map(mpFileItem).join('')}</ul></details>`
    } else if(view.found > 0){
        detail += `<p>${Lang.queryJS('settings.modpacks.manualAllFound')}</p>`
    }
    if(restricted.length > 0){
        detail += `<p class="mpFileNote">${Lang.queryJS('settings.modpacks.restrictedNote', { count: restricted.length })}</p>`
    }
    if(view.error != null){
        detail += `<p class="mpTaskError">${Lang.queryJS('settings.modpacks.manualFailed', { message: escapeSettingsHTML(view.error) })}</p>`
    }
    if(detail === ''){
        detail = Lang.queryJS('settings.modpacks.installedDetail')
    }
    const downloadable = missing.filter(f => f.direct || f.url)
    const download = missing.length === 0 || view.watching || downloadable.length === 0 ? null : {
        label: Lang.queryJS('settings.modpacks.browserDownload'),
        run: () => {
            downloadable.forEach((f, i) => setTimeout(() => shell.openExternal(f.direct || f.url), i * 700))
            mpWatchDownloads(server, missing)
        }
    }
    mpEndTask(missing.length > 0 || view.error != null ? 'warn' : 'done', title, detail, download || select, download ? select : null)
    // A single link opened by hand is watched for too.
    for(const a of mpEl('mpTaskDetail').querySelectorAll('a[data-file]')){
        a.addEventListener('click', () => {
            if(mpWatch == null) mpWatchDownloads(server, missing)
        })
    }
}

/**
 * Look in Downloads every few seconds and move each missing file found there
 * into the pack, until all are in or the wait runs out.
 */
function mpWatchDownloads(server, missing){
    mpStopWatch()
    server.missingTotal = server.missingTotal || missing.length
    let left = missing
    let busy = false
    const started = Date.now()
    const watch = { timer: null }
    mpWatch = watch
    const tick = async () => {
        if(busy || mpWatch !== watch) return
        busy = true
        try {
            left = await ModpackManager.importDownloaded(server.id, left)
        } catch(err) {
            console.error('Unable to pick up the downloaded files.', err)
            mpStopWatch()
            mpShowResult(server, left, { error: err.message || String(err) })
            return
        } finally {
            busy = false
        }
        if(mpWatch !== watch) return
        if(left.length === 0){
            mpStopWatch()
            mpShowResult(server, left, { found: server.missingTotal })
        } else if(Date.now() - started > MP_WATCH.ms){
            mpStopWatch()
            mpShowResult(server, left, { timedOut: true })
        } else {
            mpShowResult(server, left, { watching: true })
        }
    }
    watch.timer = setInterval(tick, MP_WATCH.every)
    mpShowResult(server, left, { watching: true })
    tick()
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
        mpShowResult(server, server.missing || [])
        return server
    } catch(err) {
        console.error('Modpack install failed.', err)
        const keyError = mpKeyError(err)
        if(keyError != null){
            mpAskKey(name, job, keyError)
        } else {
            mpEndTask('error', Lang.queryJS('settings.modpacks.failed', { name }), mpErrorText(err),
                err.file != null ? { label: Lang.queryJS('settings.modpacks.chooseVersion'), run: () => mpAttachFiles(err.file, err.found) } : null)
        }
    } finally {
        mpSetBusy(false)
    }
}

/**
 * An install stopped for want of a working CurseForge key: ask for one in the
 * task card and carry on with it. Nothing was written to disk yet.
 *
 * @param {string} name The pack's name.
 * @param {function} job The install, run again once the key is saved.
 * @param {'missing' | 'invalid'} why Whether there was no key or it was refused.
 */
function mpAskKey(name, job, why){
    mpEndTask('error', Lang.queryJS('settings.modpacks.keyNeededTitle', { name }),
        `<p>${Lang.queryJS(why === 'invalid' ? 'settings.modpacks.keyRefused' : 'settings.modpacks.keyNeeded')}</p>
        <div class="mpFormRow"><input type="text" id="mpTaskKey" class="mpFieldGrow" spellcheck="false" placeholder="$2a$10$…"></div>`,
        {
            label: Lang.queryJS('settings.modpacks.keySaveInstall'),
            run: () => {
                const key = mpEl('mpTaskKey').value.trim()
                if(!key){
                    mpEl('mpTaskKey').focus()
                    return
                }
                ConfigManager.setCurseForgeApiKey(key)
                ConfigManager.save()
                // The Catalog's key card shows the same key.
                mpEl('mpCurseForgeKeyInput').value = key
                mpRun(name, job)
            }
        })
    const input = mpEl('mpTaskKey')
    input.value = why === 'invalid' ? ConfigManager.getCurseForgeApiKey() : ''
    input.onkeydown = e => {
        if(e.key === 'Enter') mpEl('mpTaskAction').click()
    }
    input.focus()
    if(why === 'invalid') input.select()
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
    const label = raw.local.loaderVersion ? `${name} ${raw.local.loaderVersion}` : name
    return raw.local.clientJar ? `${label}, ${Lang.queryJS('settings.modpacks.filesClientJar')}` : label
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

const mpInstalledSeq = { n: 0 }

/**
 * A pack's tile in the installed list; a click picks another icon.
 */
function mpPackTile(raw, appearance){
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'serverListTile mpTile mpTilePick'
    paintServerTile(tile, raw, appearance, 'serverListTile')
    tile.title = Lang.queryJS('settings.modpacks.iconChange')
    tile.setAttribute('aria-label', tile.title)
    tile.onclick = () => mpPickIcon(raw)
    return tile
}

/**
 * Hide a pack from the pack pickers or show it again. The selected pack
 * can't be hidden: the picker would have nothing to point at.
 */
function mpHideButton(raw, selected){
    const hidden = ConfigManager.isPackHidden(raw.id)
    const title = Lang.queryJS(hidden ? 'settings.modpacks.show'
        : raw.id === selected ? 'settings.modpacks.hideSelected' : 'settings.modpacks.hide')
    const svg = hidden
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2.5 12S6 18 12 18c1.7 0 3.2-.5 4.5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/></svg>'
    const btn = mpIconButton(hidden ? 'mpHidden' : '', title, svg, () => {
        ConfigManager.setPackHidden(raw.id, !hidden)
        ConfigManager.save()
        mpRenderInstalled()
        renderServerPicker()
    })
    btn.disabled = !hidden && raw.id === selected
    return btn
}

/**
 * "Hidden" after a pack's details, when it is.
 */
function mpHiddenMeta(raw, parts){
    return ConfigManager.isPackHidden(raw.id) ? parts.concat(Lang.queryJS('settings.modpacks.hiddenMeta')) : parts
}

/**
 * A pack from distribution.json: it can be picked, but only the server changes it.
 */
function mpRenderServerRow(list, raw, appearance, selected){
    const row = document.createElement('div')
    row.className = 'mpRow mpRowServer'
    row.setAttribute('role', 'listitem')
    row.toggleAttribute('selected', raw.id === selected)
    row.toggleAttribute('packHidden', ConfigManager.isPackHidden(raw.id))

    const tile = mpPackTile(raw, appearance)

    const text = document.createElement('div')
    text.className = 'mpRowText'
    const name = document.createElement('span')
    name.className = 'mpRowName'
    name.textContent = raw.name
    const meta = document.createElement('span')
    meta.className = 'mpRowMeta'
    meta.textContent = mpHiddenMeta(raw, [raw.minecraftVersion, raw.version, Lang.queryJS('settings.modpacks.source.server')].filter(Boolean)).join(' · ')
    const note = document.createElement('span')
    note.className = 'mpRowNote'
    note.textContent = Lang.queryJS('settings.modpacks.serverLocked')
    text.append(name, meta, note)

    const use = document.createElement('button')
    use.type = 'button'
    use.className = 'mpButton mpButtonSmall'
    use.disabled = raw.id === selected
    use.textContent = Lang.queryJS(raw.id === selected ? 'settings.modpacks.selected' : 'settings.modpacks.select')
    use.onclick = () => mpSelect(raw.id)

    row.append(tile, text, use, mpHideButton(raw, selected))
    list.appendChild(row)
}

async function mpRenderInstalled(){
    const seq = ++mpInstalledSeq.n
    let servers = []
    try {
        servers = (await DistroAPI.getDistribution()).servers
            .map(serv => serv.rawServer)
            .filter(raw => raw.local == null)
    } catch(err){
        console.warn('Could not list the distribution packs.', err)
    }
    // A newer render started while the distribution was loading.
    if(seq !== mpInstalledSeq.n){
        return
    }
    const packs = ModpackManager.installed()
    const list = mpEl('mpInstalled')
    mpEl('mpInstalledSection').hidden = packs.length === 0 && servers.length === 0
    list.innerHTML = ''
    const appearance = ConfigManager.getAppearance()
    const selected = ConfigManager.getSelectedServer()
    for(const raw of servers){
        mpRenderServerRow(list, raw, appearance, selected)
    }
    for(const raw of packs){
        const row = document.createElement('div')
        row.className = 'mpRow'
        row.setAttribute('role', 'listitem')
        row.toggleAttribute('selected', raw.id === selected)
        row.toggleAttribute('packHidden', ConfigManager.isPackHidden(raw.id))

        const tile = mpPackTile(raw, appearance)

        const text = document.createElement('div')
        text.className = 'mpRowText'
        const name = document.createElement('span')
        name.className = 'mpRowName'
        name.textContent = raw.name
        const meta = document.createElement('span')
        meta.className = 'mpRowMeta'
        meta.textContent = mpHiddenMeta(raw, [mpLoaderLabel(raw), raw.minecraftVersion, Lang.queryJS(`settings.modpacks.source.${raw.local.source}`)]).join(' · ')
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

        row.append(tile, text, use, mpHideButton(raw, selected), folder, remove)
        list.appendChild(row)
    }
}

// Pictures that can be used as a pack's own icon.
const MP_ICON_TYPES = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * Choose a pack's icon: any Minecraft icon, or a picture of the user's own.
 */
async function mpPickIcon(raw){
    if(!(await PackIcons.load(raw.minecraftVersion))){
        return
    }
    const saved = PackIcons.choiceFor(raw.id)
    // An icon name, or { custom } / a new { file, url } picture, or { original }:
    // the logo (or monogram) the pack comes with, if it has one.
    let upload = saved.custom ? { custom: saved.custom } : null
    const original = raw.icon || (raw.launcherTheme != null && raw.launcherTheme.monogram) ? { original: true } : null
    let choice = original != null && !PackIcons.isPicked(raw.id) ? original : upload || { icon: saved.icon }

    const grid = document.createElement('div')
    grid.className = 'mpIconGrid'
    grid.setAttribute('role', 'radiogroup')

    const option = (onclick) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'mpIconOption'
        btn.setAttribute('role', 'radio')
        btn.onclick = onclick
        const glyph = document.createElement('span')
        glyph.className = 'serverGlyph'
        btn.appendChild(glyph)
        grid.appendChild(btn)
        return btn
    }
    const paintOption = (btn, icon) => {
        btn.style.backgroundImage = icon.background
        btn.firstChild.classList.toggle('serverGlyphFull', icon.full)
        Object.assign(btn.firstChild.style, { backgroundImage: icon.image, backgroundSize: icon.size, backgroundPosition: icon.position })
    }
    if(original != null){
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'mpIconOption mpIconOriginal'
        btn.setAttribute('role', 'radio')
        btn.setAttribute('data-original', '')
        btn.title = Lang.queryJS('settings.modpacks.iconOriginal')
        btn.setAttribute('aria-label', btn.title)
        btn.onclick = () => {
            choice = original
            paint()
        }
        const tile = document.createElement('span')
        tile.className = 'serverListTile'
        paintServerTile(tile, raw, ConfigManager.getAppearance(), 'serverListTile', true)
        btn.appendChild(tile)
        grid.appendChild(btn)
    }
    for(const name of PackIcons.iconNames()){
        const btn = option(() => {
            choice = { icon: name }
            paint()
        })
        btn.setAttribute('data-icon', name)
        btn.setAttribute('aria-label', name)
        paintOption(btn, PackIcons.render({ icon: name }))
    }

    // The user's own picture, once there is one, then a + to add another.
    const own = option(() => {
        choice = upload
        paint()
    })
    own.setAttribute('aria-label', Lang.queryJS('settings.modpacks.iconOwn'))
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'mpIconOption mpIconUpload'
    add.title = Lang.queryJS('settings.modpacks.iconUpload')
    add.setAttribute('aria-label', add.title)
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    add.onclick = async () => {
        const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            properties: ['openFile'],
            filters: [{ name: Lang.queryJS('settings.modpacks.iconFilter'), extensions: MP_ICON_TYPES.map(t => t.slice(1)) }]
        })
        if(res.canceled || res.filePaths.length === 0){
            return
        }
        const file = res.filePaths[0]
        const ext = path.extname(file).toLowerCase()
        if(!MP_ICON_TYPES.includes(ext)){
            return
        }
        let framed
        try {
            framed = await mpCropIcon(await fs.readFile(file), ext)
        } catch(err) {
            console.error('Could not open the picture.', err)
            return
        }
        if(framed == null){
            return
        }
        if(upload != null && upload.data) window.URL.revokeObjectURL(upload.url)
        upload = framed
        choice = upload
        paint()
    }
    grid.appendChild(add)

    function paint(){
        for(const btn of grid.querySelectorAll('[data-icon]')){
            const on = btn.getAttribute('data-icon') === choice.icon
            btn.toggleAttribute('selected', on)
            btn.setAttribute('aria-checked', on)
        }
        own.hidden = upload == null
        if(upload != null) paintOption(own, PackIcons.render(upload))
        own.toggleAttribute('selected', choice === upload)
        own.setAttribute('aria-checked', choice === upload)
        const orig = grid.querySelector('[data-original]')
        if(orig != null){
            orig.toggleAttribute('selected', choice === original)
            orig.setAttribute('aria-checked', choice === original)
        }
    }
    paint()

    const picker = document.createElement('div')
    picker.className = 'mpIconPicker'
    picker.append(grid)

    setOverlayContent(
        Lang.queryJS('settings.modpacks.iconTitle', { name: escapeSettingsHTML(raw.name) }),
        '',
        Lang.queryJS('settings.modpacks.iconSave'),
        Lang.queryJS('settings.modpacks.iconCancel')
    )
    document.getElementById('overlayDesc').appendChild(picker)
    setOverlayHandler(async () => {
        if(choice.original){
            PackIcons.unpick(raw.id)
            toggleOverlay(false)
            mpRenderInstalled()
            repaintPackTiles(raw)
            return
        }
        if(choice.data){
            try {
                choice = { custom: await PackIcons.saveCustom(raw.id, choice.data, '.png') }
            } catch(err) {
                console.error('Could not save the pack icon.', err)
                return
            }
        }
        PackIcons.setChoice(raw.id, choice, true)
        toggleOverlay(false)
        mpRenderInstalled()
        // Every other tile of this pack: the dial, the list, settings.
        repaintPackTiles(raw)
    })
    setDismissHandler(null)
    toggleOverlay(true, true)
}

// The framing dialog's stage and the icon circle in it, and the saved size, in px.
const MP_CROP = { stage: 280, hole: 220, out: 256 }

/**
 * Frame a picture in the icon circle, in a dialog over the icon picker: drag
 * to move it, the wheel or the slider to zoom. It starts whole inside the
 * circle with a margin, like the Minecraft icons.
 *
 * @param {Buffer} data The picture.
 * @param {string} ext Its extension, e.g. '.png'.
 * @returns {Promise<{data: Buffer, url: string} | null>} The framed square as
 * a PNG and a url to show it, or null if cancelled.
 */
function mpCropIcon(data, ext){
    const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/png'
    // A blob url, so the canvas may read the picture back. window.URL: the
    // global URL is Node's (landing.js), which takes no browser Blob.
    const src = window.URL.createObjectURL(new Blob([data], { type }))
    const { stage, hole, out } = MP_CROP
    const inset = (stage - hole) / 2

    const layer = document.createElement('div')
    layer.className = 'mpCropLayer'
    layer.innerHTML = `<div class="mpCropDialog" role="dialog" aria-modal="true">
        <div class="mpCropTitle"></div>
        <div class="mpCropHint"></div>
        <div class="mpCropStage">
            <div class="mpCropBackdrop"></div>
            <img class="mpCropImage" alt="" draggable="false">
            <div class="mpCropHole"></div>
        </div>
        <input class="mpCropZoom" type="range" min="0" max="1000" step="1">
        <div class="mpCropActions">
            <button type="button" class="crystalButton mpCropDone"></button>
            <button type="button" class="ghostButton mpCropCancel"></button>
        </div>
    </div>`
    const q = sel => layer.querySelector(sel)
    q('.mpCropTitle').textContent = Lang.queryJS('settings.modpacks.cropTitle')
    q('.mpCropHint').textContent = Lang.queryJS('settings.modpacks.cropHint')
    q('.mpCropDone').textContent = Lang.queryJS('settings.modpacks.cropDone')
    q('.mpCropCancel').textContent = Lang.queryJS('settings.modpacks.iconCancel')
    const img = q('.mpCropImage')
    const zoom = q('.mpCropZoom')
    const area = q('.mpCropStage')

    return new Promise((resolve, reject) => {
        // Scale and the picture's centre in the stage.
        let w, h, min, max, scale, cx = stage / 2, cy = stage / 2

        const place = () => {
            // Keep the centre over the circle, so the picture never leaves it.
            cx = Math.max(inset, Math.min(inset + hole, cx))
            cy = Math.max(inset, Math.min(inset + hole, cy))
            img.style.width = (w * scale) + 'px'
            img.style.height = (h * scale) + 'px'
            img.style.transform = `translate(${cx - w * scale / 2}px, ${cy - h * scale / 2}px)`
            zoom.value = Math.round(1000 * Math.log(scale / min) / Math.log(max / min))
        }
        // Zoom about a point of the stage, which stays put.
        const zoomTo = (next, px = stage / 2, py = stage / 2) => {
            next = Math.max(min, Math.min(max, next))
            cx = px + (cx - px) * next / scale
            cy = py + (cy - py) * next / scale
            scale = next
            place()
        }

        const finish = (result) => {
            window.removeEventListener('keydown', onKey, true)
            layer.remove()
            window.URL.revokeObjectURL(src)
            resolve(result)
        }
        const done = () => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = out
            const ctx = canvas.getContext('2d')
            // Pixel art stays sharp.
            ctx.imageSmoothingEnabled = !img.hasAttribute('pixel')
            ctx.imageSmoothingQuality = 'high'
            const k = out / hole
            ctx.drawImage(img, (cx - w * scale / 2 - inset) * k, (cy - h * scale / 2 - inset) * k, w * scale * k, h * scale * k)
            canvas.toBlob(async blob => {
                finish({ data: Buffer.from(await blob.arrayBuffer()), url: window.URL.createObjectURL(blob) })
            }, 'image/png')
        }
        // Ahead of the icon picker's own Enter and Escape.
        const onKey = (e) => {
            if(e.key === 'Enter' || e.key === 'Escape'){
                e.preventDefault()
                e.stopImmediatePropagation()
                if(e.key === 'Enter') done()
                else finish(null)
            }
        }

        img.onload = () => {
            w = img.naturalWidth
            h = img.naturalHeight
            img.toggleAttribute('pixel', Math.max(w, h) <= 64)
            // From half the size that fits the circle to well past filling it.
            const fit = hole / Math.max(w, h)
            min = fit * 0.5
            max = Math.max(hole / Math.min(w, h), fit) * 8
            scale = fit * 0.72
            place()
            document.body.appendChild(layer)
            window.addEventListener('keydown', onKey, true)
            q('.mpCropDone').focus()
        }
        img.onerror = () => {
            window.URL.revokeObjectURL(src)
            reject(new Error('Not a readable picture.'))
        }

        zoom.oninput = () => zoomTo(min * Math.pow(max / min, zoom.value / 1000))
        area.addEventListener('wheel', e => {
            e.preventDefault()
            const r = area.getBoundingClientRect()
            zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
        }, { passive: false })
        area.onpointerdown = e => {
            area.setPointerCapture(e.pointerId)
            let x = e.clientX, y = e.clientY
            area.onpointermove = m => {
                cx += m.clientX - x
                cy += m.clientY - y
                x = m.clientX
                y = m.clientY
                place()
            }
            area.onpointerup = area.onpointercancel = () => {
                area.onpointermove = null
            }
        }
        q('.mpCropDone').onclick = done
        q('.mpCropCancel').onclick = () => finish(null)

        img.src = src
    })
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
    // Move off the pack while it still exists, so its settings are saved
    // before its folder goes and the settings tabs show the next pack.
    if(ConfigManager.getSelectedServer() === raw.id){
        const others = (await DistroAPI.getDistribution()).servers.filter(s => s.rawServer.id !== raw.id)
        updateSelectedServer(others.find(s => s.rawServer.mainServer) || others[0] || null)
    }
    const dir = ModpackManager.instanceDir(raw.id)
    let error = null
    try {
        ModpackManager.remove(raw.id)
        if(await fs.pathExists(dir)){
            const res = await ipcRenderer.invoke(MP_SHELL_OPCODE.TRASH_ITEM, dir)
            if(!res.result){
                console.error('Unable to move the modpack folder to the trash.', res.error)
                error = Lang.queryJS('settings.modpacks.trashFailed', { path: escapeSettingsHTML(dir), message: escapeSettingsHTML(res.error && res.error.message ? res.error.message : String(res.error)) })
            }
        }
    } catch(err) {
        console.error('Unable to remove the modpack.', err)
        error = Lang.queryJS('settings.modpacks.errors.generic', { message: escapeSettingsHTML(err.message || String(err)) })
    }
    await mpAfterChange()
    if(error != null){
        mpEl('mpTask').hidden = false
        mpEndTask('error', Lang.queryJS('settings.modpacks.removeFailed', { name: raw.name }), error, null, fs.existsSync(dir) ? {
            label: Lang.queryJS('settings.modpacks.openFolder'),
            run: () => shell.openPath(dir)
        } : null)
        mpEl('settingsTabModpacks').scrollTo({ top: 0, behavior: 'smooth' })
    }
}

/* Import */

/**
 * Let a card take a dropped file or folder.
 *
 * @param {HTMLElement} card The drop target.
 * @param {function(string)} onPath Called with the dropped item's path.
 */
function mpBindDrop(card, onPath){
    card.ondragenter = e => {
        e.preventDefault()
        card.setAttribute('drag', '')
    }
    card.ondragover = e => e.preventDefault()
    card.ondragleave = e => {
        if(!card.contains(e.relatedTarget)) card.removeAttribute('drag')
    }
    card.ondrop = e => {
        e.preventDefault()
        card.removeAttribute('drag')
        const f = e.dataTransfer.files[0]
        if(f == null || mpState.busy){
            return
        }
        const { webUtils } = require('electron')
        onPath(webUtils != null && webUtils.getPathForFile != null ? webUtils.getPathForFile(f) : f.path)
    }
}

async function mpPickFile(extensions){
    const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        properties: ['openFile'],
        filters: [{ name: Lang.queryJS('settings.modpacks.fileFilter'), extensions }]
    })
    return !res.canceled && res.filePaths.length > 0 ? res.filePaths[0] : null
}

function mpBindImport(){
    const card = mpEl('mpImport')
    const install = (file) => mpRun(path.basename(file), async progress => {
        try {
            return await ModpackManager.installFile(file, progress)
        } catch(err) {
            // The version can still be chosen by hand.
            if(err instanceof ModpackManager.ModpackError && err.key === 'unknownVersion'){
                err.file = file
            }
            throw err
        }
    })
    card.onclick = async () => {
        const file = await mpPickFile(['mrpack', 'zip', 'rar'])
        if(file != null){
            install(file)
        }
    }
    mpBindDrop(card, install)
}

/* Hand-made pack files */

/**
 * Attach a hand-made pack to the version card: its files go into the
 * version installed there. What it runs on is filled in when it can be told.
 *
 * @param {string} file A .zip, .rar or folder.
 * @param {Object} found What the import already worked out, if it ran.
 */
async function mpAttachFiles(file, found = null){
    mpState.files = { path: file, found }
    mpEl('mpFilesPick').hidden = true
    mpEl('mpFilesChip').hidden = false
    mpEl('mpFilesName').textContent = path.basename(file)
    mpEl('mpVersion').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const note = mpEl('mpFilesNote')
    note.removeAttribute('data-state')
    if(found == null){
        note.textContent = Lang.queryJS('settings.modpacks.filesDetecting')
        try {
            found = await ModpackManager.detectFile(file)
        } catch(err) {
            console.error('Unable to read the pack files.', err)
            if(mpState.files != null && mpState.files.path === file){
                mpClearFiles()
                mpEndTask('error', Lang.queryJS('settings.modpacks.failed', { name: path.basename(file) }), mpErrorText(err))
                mpEl('mpTask').hidden = false
            }
            return
        }
        // Detached or replaced meanwhile.
        if(mpState.files == null || mpState.files.path !== file){
            return
        }
        mpState.files.found = found
    }
    await mpApplyFound(found)
    mpUpdateNamePlaceholder()
}

/**
 * Fill the version card with what a pack was found to run on.
 */
async function mpApplyFound(found){
    const note = mpEl('mpFilesNote')
    if(found.minecraft == null){
        note.setAttribute('data-state', 'failed')
        note.textContent = Lang.queryJS('settings.modpacks.filesUndetected')
        return
    }
    const loader = found.loader || 'vanilla'
    const parts = [ModpackManager.LOADER_NAMES[loader] + (found.loaderVersion ? ` ${found.loaderVersion}` : ''), `Minecraft ${found.minecraft}`]
    if(found.clientJar) parts.push(Lang.queryJS('settings.modpacks.filesClientJar'))
    note.textContent = Lang.queryJS('settings.modpacks.filesDetected', { found: parts.join(' · ') })

    await mpLoadVersions()
    const mcSelect = mpEl('mpMinecraft')
    if([...mcSelect.options].some(o => o.value === found.minecraft)){
        mcSelect.value = found.minecraft
    }
    const btn = mpEl('mpLoader').querySelector(`button[value="${loader}"]`)
    if(btn != null){
        for(const other of mpEl('mpLoader').children){
            other.toggleAttribute('selected', other === btn)
        }
    }
    await mpRefreshLoaderVersions()
    const versionSelect = mpEl('mpLoaderVersion')
    if(found.loaderVersion && [...versionSelect.options].some(o => o.value === found.loaderVersion)){
        versionSelect.value = found.loaderVersion
    }
}

function mpClearFiles(){
    mpState.files = null
    mpEl('mpFilesPick').hidden = false
    mpEl('mpFilesChip').hidden = true
    mpUpdateNamePlaceholder()
}

/* Plain versions */

function mpSelectedLoader(){
    return mpEl('mpLoader').querySelector('button[selected]').value
}

function mpUpdateNamePlaceholder(){
    const loader = mpSelectedLoader()
    const mc = mpEl('mpMinecraft').value
    const files = mpState.files
    if(files != null){
        mpEl('mpName').placeholder = (files.found != null && files.found.name) || path.basename(files.path).replace(/\.(zip|rar)$/i, '')
        return
    }
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
 * Grey out the loaders that have no builds for the chosen Minecraft version.
 */
function mpUpdateLoaderButtons(mc){
    for(const btn of mpEl('mpLoader').children){
        const supported = ModpackManager.loaderSupports(btn.value, mc)
        btn.disabled = !supported
        btn.title = supported ? '' : Lang.queryJS('settings.modpacks.loaderSince', { loader: btn.textContent, minecraft: ModpackManager.loaderSince(btn.value) })
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
    const mc = mpEl('mpMinecraft').value
    mpUpdateLoaderButtons(mc)
    if(loader === 'vanilla'){
        return
    }
    const seq = ++mpLoaderSeq.n
    if(!ModpackManager.loaderSupports(loader, mc)){
        // Picked before switching to an older Minecraft version.
        mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.loaderSince', { loader: ModpackManager.LOADER_NAMES[loader], minecraft: ModpackManager.loaderSince(loader) }) }])
        select.disabled = true
        select.title = ''
        install.setAttribute('data-unsupported', '')
        install.disabled = true
        return
    }
    mpFillSelect(select, [{ value: '', label: Lang.queryJS('settings.modpacks.loading') }])
    select.disabled = true
    let versions = []
    let failed = null
    try {
        versions = await ModpackManager.loaderVersions(loader, mc)
    } catch(err) {
        console.error('Unable to load loader versions.', err)
        failed = err
    }
    if(seq !== mpLoaderSeq.n){
        return
    }
    select.title = failed != null ? (failed.message || String(failed)) : ''
    if(versions.length === 0){
        // A network error is not the same as the loader having no build.
        mpFillSelect(select, [{ value: '', label: Lang.queryJS(failed != null ? 'settings.modpacks.versionsFailed' : 'settings.modpacks.loaderUnavailable') }])
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
    mpEl('mpFilesPick').onclick = async () => {
        const file = await mpPickFile(['zip', 'rar'])
        if(file != null){
            mpAttachFiles(file)
        }
    }
    mpEl('mpFilesClear').onclick = () => mpClearFiles()
    mpBindDrop(mpEl('mpVersion'), file => mpAttachFiles(file))
    mpEl('mpVersionInstall').onclick = async () => {
        const minecraft = mpEl('mpMinecraft').value
        if(!minecraft){
            return
        }
        const name = mpEl('mpName').value.trim() || mpEl('mpName').placeholder
        const opts = {
            name,
            minecraft,
            loader: mpSelectedLoader(),
            loaderVersion: mpEl('mpLoaderVersion').value || undefined
        }
        const files = mpState.files
        const server = await mpRun(name, progress => files != null
            ? ModpackManager.installFile(files.path, progress, opts)
            : ModpackManager.installVersion(opts, progress))
        if(server != null && files != null && mpState.files === files){
            mpClearFiles()
        }
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
