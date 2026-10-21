/**
 * Interface scale for high resolution monitors.
 *
 * Ctrl + "+" and Ctrl + "-" step through ZOOM_STEPS, Ctrl + 0 goes back to
 * 100%. The scale is saved in the config; scales that wouldn't fit on the
 * screen are skipped.
 *
 * The layout is designed for at least MIN_LAYOUT css pixels. A window
 * smaller than that at the picked scale (a tile, a small floating window)
 * shrinks the whole interface to fit instead of breaking or clipping it.
 */
;(function(){

    const { webFrame } = require('electron')
    const remote = require('@electron/remote')
    const ConfigManager = require('./assets/js/configmanager')

    const ZOOM_STEPS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
    // The smallest css size the layout is designed for.
    const MIN_LAYOUT = { width: 1100, height: 620 }
    // Below this the text gets too small to read; the layout may clip instead.
    const MIN_FIT = 0.5

    const win = remote.getCurrentWindow()
    // The scale the player picked; the page may be smaller to fit the window.
    let userZoom = 1
    let indicator = null
    let indicatorTimer = 0

    /**
     * The largest scale whose minimum layout still fits on the window's screen.
     */
    function maxZoom(){
        const area = remote.screen.getDisplayMatching(win.getBounds()).workArea
        return Math.min(area.width / MIN_LAYOUT.width, area.height / MIN_LAYOUT.height)
    }

    /**
     * Use a new scale. The window keeps its size: on Wayland a minimum size
     * the compositor won't give (a tile) makes it clip the window instead,
     * so the page is fitted to whatever size the window has.
     *
     * @param {number} zoom The zoom factor, 1 being 100%.
     */
    function applyZoom(zoom){
        userZoom = zoom
        fitToWindow()
    }

    /**
     * Use the picked scale, or less when the window is smaller than the
     * layout at that scale.
     */
    function fitToWindow(){
        // What the page really gets, which may differ from what the window asked for.
        const current = webFrame.getZoomFactor()
        const w = window.innerWidth * current
        const h = window.innerHeight * current
        if(w === 0 || h === 0){
            // Minimised: keep the scale for when it comes back.
            return
        }
        const zoom = Math.max(MIN_FIT, Math.min(userZoom, w / MIN_LAYOUT.width, h / MIN_LAYOUT.height))
        if(Math.abs(webFrame.getZoomFactor() - zoom) > 0.001){
            webFrame.setZoomFactor(zoom)
        }
    }

    /**
     * Briefly show the new scale in the middle of the window.
     */
    function showIndicator(zoom){
        if(indicator == null){
            indicator = document.createElement('div')
            indicator.id = 'zoomIndicator'
            indicator.setAttribute('role', 'status')
            document.body.appendChild(indicator)
        }
        indicator.textContent = `${Math.round(zoom * 100)}%`
        indicator.setAttribute('shown', '')
        clearTimeout(indicatorTimer)
        indicatorTimer = setTimeout(() => indicator.removeAttribute('shown'), 1100)
    }

    function setZoom(zoom){
        applyZoom(zoom)
        ConfigManager.setZoom(zoom)
        ConfigManager.save()
        showIndicator(zoom)
    }

    /**
     * The next step up or down from the current scale, or null at the end.
     */
    function step(direction){
        const current = userZoom
        const max = Math.max(1, maxZoom())
        const steps = ZOOM_STEPS.filter(z => z <= max + 1e-6)
        if(direction > 0){
            return steps.find(z => z > current + 1e-6) ?? null
        }
        return [...steps].reverse().find(z => z < current - 1e-6) ?? null
    }

    document.addEventListener('keydown', (e) => {
        if(!(e.ctrlKey || e.metaKey) || e.altKey){
            return
        }
        // Physical keys, so it works the same on every keyboard layout.
        let next
        if(e.code === 'Equal' || e.code === 'NumpadAdd'){
            next = step(1)
        } else if(e.code === 'Minus' || e.code === 'NumpadSubtract'){
            next = step(-1)
        } else if(e.code === 'Digit0' || e.code === 'Numpad0'){
            next = 1
        } else {
            return
        }
        e.preventDefault()
        if(next == null){
            // Already at the smallest or largest scale.
            showIndicator(userZoom)
        } else {
            setZoom(next)
        }
    })

    window.addEventListener('resize', fitToWindow)

    // Restore the saved scale, or the largest step that fits on this screen.
    const limit = Math.min(ConfigManager.getZoom(), Math.max(1, maxZoom()))
    applyZoom([...ZOOM_STEPS].reverse().find(z => z <= limit + 1e-6) ?? 1)

})()
