/**
 * Startup splash (app.ejs).
 *
 * Every launch picks one of a few Meridian scenes at random (never the same
 * one twice in a row) and plays it around the compass mark until the UI is
 * ready. The palette is fixed to the brand so the splash looks the same
 * whatever theme or wallpaper is active.
 *
 * Scenes draw on two canvases, one behind the mark and one in front of it
 * (the sea uses that to let the mark rise out of the waves). The mark itself
 * is built as inline SVG so its parts can be animated one by one.
 *
 * Dev: localStorage['meridian.splash.force'] = 'wind' | 'sea' | 'meridians' | 'portolan'
 *      pins a scene; MeridianSplash.play(name) replays one from the console.
 */
;(function(){

    const SVGNS = 'http://www.w3.org/2000/svg'
    const STORE_LAST = 'meridian.splash.last'
    const STORE_FORCE = 'meridian.splash.force'
    const MIN_SHOW_MS = 2600

    // Brand palette, same values as logo.svg.
    const P = {
        navy: '#004477',
        face: '#0a508a',
        mid: '#6a9ccd',
        midDark: '#4f86bd',
        light: '#b9d3ec',
        white: '#ffffff'
    }

    // The mark is drawn in a 512 unit box shown at LOGO_PX css pixels.
    const LOGO_PX = 128
    const UNIT = 512 / LOGO_PX
    const RING = 2 * Math.PI * 172
    const TICK_ANGLES = [-60, -30, 30, 60, 120, 150, -150, -120]
    // Cardinal directions, N E S W, in screen space.
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
    const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1)
    const easeOut = p => 1 - Math.pow(1 - p, 3)
    const easeInOut = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    const easeBack = p => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2)
    const rand = (a, b) => a + Math.random() * (b - a)

    function rgba(hex, a){
        const n = parseInt(hex.slice(1), 16)
        return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1).toFixed(3)})`
    }

    const container = document.getElementById('loadingContainer')
    const back = document.getElementById('splashBack')
    const front = document.getElementById('splashFront')
    const logoSvg = document.getElementById('splashLogo')
    if(!container || !back || !front || !logoSvg){
        return
    }
    const ctxB = back.getContext('2d')
    const ctxF = front.getContext('2d')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 0, H = 0, cx = 0, cy = 0
    let scene = null
    let raf = 0
    let t0 = 0
    let last = 0

    /* ---------------------------------------------------------------- mark */

    function make(name, attrs, parent){
        const node = document.createElementNS(SVGNS, name)
        for(const k in attrs){
            node.setAttribute(k, attrs[k])
        }
        if(parent){
            parent.appendChild(node)
        }
        return node
    }

    // Builds logo.svg out of separately animatable parts. Everything is laid
    // out around (0,0) so rotations and scales pivot on the centre.
    function buildMark(){
        logoSvg.setAttribute('viewBox', '0 0 512 512')
        const root = make('g', { transform: 'translate(256 256)' }, logoSvg)
        const M = {}
        M.tile = make('rect', { x: -240, y: -240, width: 480, height: 480, rx: 240, fill: P.navy }, root)
        M.face = make('circle', { r: 172, fill: P.face }, root)
        M.ringWrap = make('g', {}, root)
        M.ring = make('circle', {
            r: 172, fill: 'none', stroke: P.white, 'stroke-width': 20,
            transform: 'rotate(-90)', 'stroke-dasharray': `${RING} ${RING}`
        }, M.ringWrap)
        M.ticks = TICK_ANGLES.map(deg => {
            const g = make('g', {}, root)
            const a = deg * Math.PI / 180
            make('line', {
                x1: 146 * Math.cos(a), y1: 146 * Math.sin(a), x2: 160 * Math.cos(a), y2: 160 * Math.sin(a),
                stroke: P.mid, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.9
            }, g)
            return g
        })
        M.diag = make('g', {}, root)
        M.diagArms = [0, 1, 2, 3].map(k => {
            const wrap = make('g', {}, M.diag)
            const arm = make('g', { transform: `rotate(${k * 90})` }, wrap)
            make('polygon', { points: '0,0 90.5,-90.5 0,-30', fill: P.mid }, arm)
            make('polygon', { points: '0,0 90.5,-90.5 30,0', fill: P.midDark }, arm)
            return wrap
        })
        M.card = make('g', {}, root)
        M.cardArms = [0, 1, 2, 3].map(k => {
            const wrap = make('g', {}, M.card)
            const arm = make('g', { transform: `rotate(${k * 90})` }, wrap)
            make('polygon', { points: '0,0 0,-206 -21.2,-21.2', fill: P.white }, arm)
            make('polygon', { points: '0,0 0,-206 21.2,-21.2', fill: P.light }, arm)
            return wrap
        })
        M.hub = make('g', {}, root)
        make('circle', { r: 23, fill: P.white }, M.hub)
        make('circle', { r: 12, fill: P.navy }, M.hub)
        return M
    }

    const M = buildMark()

    function place(node, o = {}){
        const x = o.x || 0, y = o.y || 0, r = o.r || 0, s = o.s ?? 1
        node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)}) scale(${Math.max(0, s).toFixed(4)})`)
        node.setAttribute('opacity', clamp(o.o ?? 1, 0, 1).toFixed(3))
    }

    function drawRing(p){
        M.ring.setAttribute('stroke-dashoffset', (RING * (1 - p)).toFixed(1))
    }

    // Offsets the whole mark from the centre, in css pixels.
    function moveMark(x = 0, y = 0){
        logoSvg.style.transform = `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
    }

    function resetMark(){
        for(const node of [M.tile, M.face, M.ringWrap, M.diag, M.card, M.hub, ...M.ticks, ...M.diagArms, ...M.cardArms]){
            place(node)
        }
        drawRing(1)
        moveMark()
    }

    // The default entrance: the dial grows, the ring draws itself round and
    // the needle spins in and settles on north.
    function introMark(t, { tile = true, spin = 540, sway = 0 } = {}){
        const grow = easeBack(seg(t, 0, 0.7))
        place(M.tile, { s: 0.7 + 0.3 * grow, o: tile ? seg(t, 0, 0.4) : 0 })
        place(M.face, { s: 0.6 + 0.4 * grow, o: seg(t, 0, 0.35) })
        drawRing(easeInOut(seg(t, 0.15, 1.1)))
        M.ticks.forEach((g, i) => {
            const p = seg(t, 0.5 + i * 0.06, 0.8 + i * 0.06)
            place(g, { s: 0.7 + 0.3 * easeBack(p), o: p })
        })
        const settle = seg(t, 0.2, 1.8)
        const turn = spin * Math.pow(1 - settle, 3)
        const wobble = t > 1.8 ? 5 * Math.exp(-2.5 * (t - 1.8)) * Math.sin(9 * (t - 1.8)) : 0
        place(M.card, { r: turn + wobble + sway, s: 0.4 + 0.6 * easeBack(seg(t, 0.2, 0.9)), o: seg(t, 0.2, 0.5) })
        place(M.diag, { r: -0.5 * (turn + wobble), s: 0.3 + 0.7 * easeBack(seg(t, 0.35, 1)), o: seg(t, 0.35, 0.65) })
        place(M.hub, { s: easeBack(seg(t, 0.9, 1.2)), o: seg(t, 0.9, 1) })
    }

    /* -------------------------------------------------------------- scenes */

    // Wind: streamlines blowing across the screen, swirling round the rose
    // and parting around it. The needle spins up and then sways in the gusts.
    const wind = {
        init(){
            this.ps = []
            const n = Math.round(clamp(W * H / 1700, 160, 720))
            for(let i = 0; i < n; i++){
                this.ps.push(this.spawn({}, true))
            }
        },
        spawn(p, initial){
            p.x = Math.random() * W
            p.y = Math.random() * H
            p.life = rand(2.5, 6.5)
            p.age = initial ? Math.random() * p.life : 0
            p.w = rand(0.7, 1.9)
            p.bright = Math.random() < 0.1
            return p
        },
        frame(t, dt){
            // Fade old trails out rather than clearing, so the strokes leave streaks.
            ctxB.globalCompositeOperation = 'destination-out'
            ctxB.fillStyle = 'rgba(0,0,0,0.08)'
            ctxB.fillRect(0, 0, W, H)
            ctxB.globalCompositeOperation = 'source-over'
            ctxB.lineCap = 'round'

            const gust = Math.pow(Math.max(0, Math.sin(t * 0.55 - 1)), 8)
            const speed = 110 * (1 + 0.9 * gust) * (0.25 + 0.75 * easeOut(seg(t, 0, 1.2)))

            for(const p of this.ps){
                const dx = p.x - cx, dy = p.y - cy
                const r = Math.hypot(dx, dy) || 1
                const a = 0.45 * Math.sin(p.x * 0.0032 + t * 0.3) + 0.35 * Math.cos(p.y * 0.0041 - t * 0.22)
                let vx = Math.cos(a), vy = Math.sin(a)
                const swirl = 1.6 * Math.exp(-r / 240)
                vx += -dy / r * swirl
                vy += dx / r * swirl
                const push = 3 * Math.max(0, 1 - r / 120)
                vx += dx / r * push
                vy += dy / r * push

                const nx = p.x + vx * speed * dt
                const ny = p.y + vy * speed * dt
                const fade = Math.sin(Math.PI * p.age / p.life)
                ctxB.strokeStyle = p.bright ? rgba(P.white, 0.8 * fade) : rgba(P.light, 0.5 * fade)
                ctxB.lineWidth = p.w
                ctxB.beginPath()
                ctxB.moveTo(p.x, p.y)
                ctxB.lineTo(nx, ny)
                ctxB.stroke()

                p.x = nx
                p.y = ny
                p.age += dt
                if(p.age > p.life || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40){
                    this.spawn(p, false)
                }
            }

            const sway = seg(t, 1.8, 2.6) * (1.5 * Math.sin(t * 1.3) + 6 * gust * Math.sin(t * 7))
            introMark(t, { tile: true, spin: 540, sway })
        }
    }

    // Sea: night turning to dawn. The compass rises out of the water like the
    // sun, then rides the swell with a glittering reflection beneath it.
    const sea = {
        init(){
            this.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.4, 1.3), tw: rand(0.8, 2.4), ph: rand(0, 6.3) }))
            this.streaks = Array.from({ length: 8 }, () => ({ x: rand(-0.2, 1), y: Math.random(), len: rand(90, 240), v: rand(30, 80), ph: rand(0, 6.3) }))
            this.far = [
                { off: 0, amp: 1.5, k: 0.02, s: 0.6, ph: 0, col: '#0b4677', crest: 0.30 },
                { off: 12, amp: 2.5, k: 0.016, s: 0.8, ph: 2, col: '#08396a', crest: 0.22 }
            ]
            this.near = [
                { off: 62, amp: 6, k: 0.011, s: 1.1, ph: 1, col: '#06305a', crest: 0.40 },
                { off: 116, amp: 10, k: 0.008, s: 0.8, ph: 4, col: '#042647', crest: 0.28 },
                { off: 190, amp: 15, k: 0.006, s: 0.6, ph: 2.5, col: '#021a31', crest: 0.20 }
            ]
        },
        wave(ctx, w, t, glow){
            const base = cy + w.off
            const yAt = x => base + w.amp * (0.6 * Math.sin(x * w.k + t * w.s + w.ph) + 0.4 * Math.sin(x * w.k * 2.1 - t * w.s * 1.4 + w.ph * 1.7))
            ctx.beginPath()
            ctx.moveTo(0, H)
            for(let x = 0; x <= W + 8; x += 8){
                ctx.lineTo(x, yAt(x))
            }
            ctx.lineTo(W, H)
            ctx.closePath()
            ctx.fillStyle = w.col
            ctx.fill()

            const g = ctx.createLinearGradient(0, 0, W, 0)
            g.addColorStop(0, rgba(P.light, w.crest * 0.25))
            g.addColorStop(0.5, rgba(P.light, w.crest * (0.4 + 0.6 * glow)))
            g.addColorStop(1, rgba(P.light, w.crest * 0.25))
            ctx.strokeStyle = g
            ctx.lineWidth = 1.4
            ctx.beginPath()
            for(let x = 0; x <= W + 8; x += 8){
                x === 0 ? ctx.moveTo(x, yAt(x)) : ctx.lineTo(x, yAt(x))
            }
            ctx.stroke()
        },
        // Glitter path on the water below the risen mark.
        reflect(ctx, from, to, t, glow, horizon){
            for(let y = from; y < to; y += 5){
                const d = (y - horizon) / (H - horizon)
                const flicker = 0.5 + 0.5 * Math.sin(y * 0.7 + t * 3.1) * Math.sin(y * 0.23 - t * 1.7)
                const half = (14 + d * 120) * flicker
                ctx.fillStyle = rgba(P.light, 0.32 * glow * (1 - d) * (0.4 + 0.6 * flicker))
                ctx.fillRect(cx - half + Math.sin(y * 0.11 + t * 2) * 6, y, half * 2, 1.6)
            }
        },
        frame(t){
            const horizon = cy + 30
            const rise = easeOut(seg(t, 0.15, 2.1))

            ctxB.clearRect(0, 0, W, H)
            const sky = ctxB.createLinearGradient(0, 0, 0, horizon)
            sky.addColorStop(0, '#010913')
            sky.addColorStop(0.65, '#06213d')
            sky.addColorStop(1, '#0f4472')
            ctxB.fillStyle = sky
            ctxB.fillRect(0, 0, W, horizon + 2)

            const sun = ctxB.createRadialGradient(cx, horizon, 0, cx, horizon, Math.max(W, H) * 0.6)
            sun.addColorStop(0, rgba(P.light, 0.30 * rise))
            sun.addColorStop(0.35, rgba(P.mid, 0.10 * rise))
            sun.addColorStop(1, rgba(P.mid, 0))
            ctxB.fillStyle = sun
            ctxB.fillRect(0, 0, W, horizon + 2)

            for(const s of this.stars){
                const y = s.y * (horizon - 60)
                const a = 0.55 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph)) * (1 - 0.6 * rise) * (1 - y / horizon)
                ctxB.fillStyle = rgba(P.white, a)
                ctxB.beginPath()
                ctxB.arc(s.x * W, y, s.r, 0, Math.PI * 2)
                ctxB.fill()
            }

            // Wind over the water.
            ctxB.lineWidth = 1
            for(const s of this.streaks){
                const x0 = ((s.x * W + t * s.v) % (W + s.len * 2)) - s.len
                const y0 = 30 + s.y * (horizon - 110)
                const g = ctxB.createLinearGradient(x0, 0, x0 + s.len, 0)
                g.addColorStop(0, rgba(P.light, 0))
                g.addColorStop(0.5, rgba(P.light, 0.22 * seg(t, 0.3, 1.2)))
                g.addColorStop(1, rgba(P.light, 0))
                ctxB.strokeStyle = g
                ctxB.beginPath()
                for(let x = 0; x <= s.len; x += 6){
                    const y = y0 + 5 * Math.sin((x0 + x) * 0.018 + s.ph + t * 0.8)
                    x === 0 ? ctxB.moveTo(x0 + x, y) : ctxB.lineTo(x0 + x, y)
                }
                ctxB.stroke()
            }

            const water = ctxB.createLinearGradient(0, horizon, 0, H)
            water.addColorStop(0, '#0a3e6c')
            water.addColorStop(1, '#010c18')
            ctxB.fillStyle = water
            ctxB.fillRect(0, horizon, W, H - horizon)
            for(const w of this.far){
                this.wave(ctxB, { ...w, off: 30 + w.off }, t, rise)
            }
            this.reflect(ctxB, horizon + 3, cy + 70, t, rise, horizon)

            ctxF.clearRect(0, 0, W, H)
            for(const w of this.near){
                this.wave(ctxF, w, t, rise)
            }
            this.reflect(ctxF, cy + 70, H, t, rise, horizon)

            introMark(t, { tile: false, spin: 0 })
            const bob = seg(t, 1.2, 2.6)
            moveMark(0, (1 - rise) * 150 + bob * 4 * Math.sin(t * 1.5))
            place(M.card, { r: bob * 3 * Math.sin(t * 1.1), s: 1, o: seg(t, 0.2, 0.5) })
        }
    }

    // Meridians: a wireframe globe turns behind the mark, its lines tracing
    // themselves in; the prime meridian glows and a light runs up it.
    const meridians = {
        init(){
            this.stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.3, 1.2), tw: rand(0.6, 2), ph: rand(0, 6.3) }))
        },
        frame(t){
            ctxB.clearRect(0, 0, W, H)
            for(const s of this.stars){
                ctxB.fillStyle = rgba(P.white, 0.45 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph)) * seg(t, 0, 1))
                ctxB.beginPath()
                ctxB.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2)
                ctxB.fill()
            }

            const R = Math.min(W, H) * 0.36
            const tilt = 0.42, ct = Math.cos(tilt), st = Math.sin(tilt)
            const spin = t * 0.22 + 0.4
            const proj = (phi, lam) => {
                const x = Math.cos(phi) * Math.sin(lam)
                const y = -Math.sin(phi)
                const z = Math.cos(phi) * Math.cos(lam)
                return [cx + R * x, cy + R * (y * ct + z * st), -y * st + z * ct]
            }
            const near = new Path2D(), far = new Path2D()
            const trace = (pts, a = near, b = far) => {
                for(let i = 1; i < pts.length; i++){
                    const path = pts[i][2] + pts[i - 1][2] >= 0 ? a : b
                    path.moveTo(pts[i - 1][0], pts[i - 1][1])
                    path.lineTo(pts[i][0], pts[i][1])
                }
            }

            const halo = ctxB.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.35)
            halo.addColorStop(0, rgba(P.face, 0.22 * seg(t, 0, 1.2)))
            halo.addColorStop(0.7, rgba(P.mid, 0.07 * seg(t, 0, 1.2)))
            halo.addColorStop(1, rgba(P.mid, 0))
            ctxB.fillStyle = halo
            ctxB.fillRect(0, 0, W, H)

            const N = 16, steps = 48
            const prime = []
            for(let i = 0; i < N; i++){
                const p = easeInOut(seg(t, 0.1 + i * 0.04, 1 + i * 0.04))
                const pts = []
                for(let j = 0; j <= steps * p; j++){
                    pts.push(proj(Math.PI / 2 - Math.PI * j / steps, spin + i * Math.PI / 8))
                }
                i === 0 ? prime.push(...pts) : trace(pts)
            }
            ;[-60, -30, 0, 30, 60].forEach((deg, j) => {
                const p = easeInOut(seg(t, 0.6 + j * 0.08, 1.6 + j * 0.08))
                const pts = []
                for(let k = 0; k <= 96 * p; k++){
                    pts.push(proj(deg * Math.PI / 180, spin + Math.PI * 2 * k / 96))
                }
                trace(pts)
            })

            ctxB.lineWidth = 1
            ctxB.strokeStyle = rgba(P.mid, 0.12)
            ctxB.stroke(far)
            ctxB.strokeStyle = rgba(P.light, 0.32)
            ctxB.stroke(near)

            ctxB.strokeStyle = rgba(P.light, 0.35)
            ctxB.lineWidth = 1.2
            ctxB.beginPath()
            ctxB.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeInOut(seg(t, 0, 1.1)))
            ctxB.stroke()

            const primeNear = new Path2D(), primeFar = new Path2D()
            trace(prime, primeNear, primeFar)
            ctxB.lineWidth = 1.4
            ctxB.strokeStyle = rgba(P.light, 0.2)
            ctxB.stroke(primeFar)
            ctxB.save()
            ctxB.shadowColor = P.light
            ctxB.shadowBlur = 12
            ctxB.lineWidth = 2
            ctxB.strokeStyle = rgba(P.white, 0.85)
            ctxB.stroke(primeNear)
            ctxB.restore()

            // A light travelling pole to pole along the prime meridian.
            if(t > 1.6){
                const u = ((t - 1.6) * 0.28) % 1
                const [x, y, z] = proj(-Math.PI / 2 + Math.PI * u, spin)
                const a = clamp(z * 4, 0, 1) * Math.sin(Math.PI * u)
                const g = ctxB.createRadialGradient(x, y, 0, x, y, 14)
                g.addColorStop(0, rgba(P.white, a))
                g.addColorStop(1, rgba(P.light, 0))
                ctxB.fillStyle = g
                ctxB.fillRect(x - 14, y - 14, 28, 28)
            }

            introMark(t, { tile: false, spin: 360 })
        }
    }

    // Portolan: like an old sea chart, 32 rhumb lines shoot out from the rose
    // and a net of bearings links the points of an outer circle. The mark is
    // assembled from its pieces, the four points blowing in from the edges.
    const portolan = {
        init(){
            this.gusts = Array.from({ length: 28 }, () => this.gust({}))
        },
        gust(g){
            g.line = Math.floor(Math.random() * 32)
            g.s = rand(60, 200)
            g.v = rand(120, 280)
            g.len = rand(30, 80)
            return g
        },
        frame(t, dt){
            ctxB.clearRect(0, 0, W, H)
            ctxF.clearRect(0, 0, W, H)
            const far = Math.hypot(W, H) * 0.6
            const Rr = Math.min(W, H) * 0.38

            // Rhumb lines, cardinal ones first and brightest.
            const tiers = [0.45, 0.3, 0.18, 0.11]
            for(let tier = 0; tier < 4; tier++){
                const fade = ctxB.createRadialGradient(cx, cy, 0, cx, cy, far)
                fade.addColorStop(0, rgba(P.light, tiers[tier]))
                fade.addColorStop(1, rgba(P.light, 0))
                ctxB.strokeStyle = fade
                ctxB.lineWidth = tier === 0 ? 1.4 : 1
                const p = easeOut(seg(t, 0.25 + tier * 0.15, 1.3 + tier * 0.15))
                ctxB.beginPath()
                for(let k = 0; k < 32; k++){
                    const kt = k % 8 === 0 ? 0 : k % 4 === 0 ? 1 : k % 2 === 0 ? 2 : 3
                    if(kt !== tier) continue
                    const a = k * Math.PI / 16 - Math.PI / 2
                    ctxB.moveTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60)
                    ctxB.lineTo(cx + Math.cos(a) * (60 + far * p), cy + Math.sin(a) * (60 + far * p))
                }
                ctxB.stroke()
            }

            // The outer circle of 16 roses and the bearings between them.
            const nodes = Array.from({ length: 16 }, (_, i) => {
                const a = i * Math.PI / 8 - Math.PI / 2
                return [cx + Math.cos(a) * Rr, cy + Math.sin(a) * Rr]
            })
            const net = seg(t, 1, 2.6)
            ctxB.strokeStyle = rgba(P.mid, 0.09)
            ctxB.lineWidth = 1
            ctxB.beginPath()
            let idx = 0
            for(let i = 0; i < 16; i++){
                for(let j = i + 1; j < 16; j++, idx++){
                    const q = seg(net, idx / 120 * 0.6, idx / 120 * 0.6 + 0.4)
                    if(q <= 0) continue
                    const [x1, y1] = nodes[i], [x2, y2] = nodes[j]
                    ctxB.moveTo(x1, y1)
                    ctxB.lineTo(x1 + (x2 - x1) * q, y1 + (y2 - y1) * q)
                }
            }
            ctxB.stroke()

            ctxB.save()
            ctxB.setLineDash([2, 7])
            ctxB.lineDashOffset = -t * 10
            ctxB.strokeStyle = rgba(P.light, 0.3)
            ctxB.beginPath()
            ctxB.arc(cx, cy, Rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeInOut(seg(t, 0.6, 1.6)))
            ctxB.stroke()
            ctxB.restore()

            nodes.forEach(([x, y], i) => {
                const p = easeBack(seg(t, 1 + i * 0.04, 1.3 + i * 0.04))
                if(p <= 0) return
                const big = i % 4 === 0
                ctxB.fillStyle = rgba(big ? P.white : P.light, big ? 0.8 : 0.5)
                ctxB.beginPath()
                ctxB.arc(x, y, (big ? 3 : 2) * p, 0, Math.PI * 2)
                ctxB.fill()
                if(big){
                    ctxB.strokeStyle = rgba(P.light, 0.5)
                    ctxB.beginPath()
                    ctxB.moveTo(x - 9 * p, y); ctxB.lineTo(x + 9 * p, y)
                    ctxB.moveTo(x, y - 9 * p); ctxB.lineTo(x, y + 9 * p)
                    ctxB.stroke()
                }
            })

            // Gusts running outward along the rhumb lines.
            if(t > 1.4){
                const show = seg(t, 1.4, 2.2)
                for(const g of this.gusts){
                    const a = g.line * Math.PI / 16 - Math.PI / 2
                    const c = Math.cos(a), s = Math.sin(a)
                    const grad = ctxB.createLinearGradient(cx + c * (g.s - g.len), cy + s * (g.s - g.len), cx + c * g.s, cy + s * g.s)
                    grad.addColorStop(0, rgba(P.white, 0))
                    grad.addColorStop(1, rgba(P.white, 0.7 * show * (1 - g.s / far)))
                    ctxB.strokeStyle = grad
                    ctxB.lineWidth = 1.5
                    ctxB.beginPath()
                    ctxB.moveTo(cx + c * (g.s - g.len), cy + s * (g.s - g.len))
                    ctxB.lineTo(cx + c * g.s, cy + s * g.s)
                    ctxB.stroke()
                    g.s += g.v * dt
                    if(g.s > far){
                        this.gust(g)
                    }
                }
            }

            // Assemble the mark: dial, then the four points blowing in, then
            // the diagonals, ticks and hub, the tile last.
            const grow = easeBack(seg(t, 0, 0.6))
            place(M.face, { s: 0.5 + 0.5 * grow, o: seg(t, 0, 0.3) })
            drawRing(easeInOut(seg(t, 0.1, 0.9)))
            place(M.card)
            const reach = Math.max(W, H) * 0.6
            ctxF.lineCap = 'round'
            M.cardArms.forEach((arm, k) => {
                const p = easeOut(seg(t, 0.15 + k * 0.1, 0.85 + k * 0.1))
                const dist = reach * (1 - p)
                const [dx, dy] = DIRS[k]
                place(arm, { x: dx * dist * UNIT, y: dy * dist * UNIT, o: seg(t, 0.15 + k * 0.1, 0.3 + k * 0.1) })
                if(p > 0 && p < 1){
                    const tip = dist + 206 / UNIT
                    const tail = tip + 220 * (1 - p)
                    const g = ctxF.createLinearGradient(cx + dx * tip, cy + dy * tip, cx + dx * tail, cy + dy * tail)
                    g.addColorStop(0, rgba(P.white, 0.6 * (1 - p)))
                    g.addColorStop(1, rgba(P.white, 0))
                    ctxF.strokeStyle = g
                    ctxF.lineWidth = 2
                    for(const side of [-6, 6]){
                        ctxF.beginPath()
                        ctxF.moveTo(cx + dx * tip - dy * side, cy + dy * tip + dx * side)
                        ctxF.lineTo(cx + dx * tail - dy * side, cy + dy * tail + dx * side)
                        ctxF.stroke()
                    }
                }
            })
            const d = easeBack(seg(t, 0.9, 1.4))
            place(M.diag, { r: 90 * (1 - d), s: d, o: seg(t, 0.9, 1.1) })
            M.ticks.forEach((g, i) => {
                const p = seg(t, 1.1 + i * 0.05, 1.35 + i * 0.05)
                place(g, { s: 0.7 + 0.3 * easeBack(p), o: p })
            })
            place(M.hub, { s: easeBack(seg(t, 1.2, 1.5)), o: seg(t, 1.2, 1.3) })
            const tile = easeOut(seg(t, 1.4, 1.9))
            place(M.tile, { s: 1.15 - 0.15 * tile, o: tile })
        }
    }

    const SCENES = { wind, sea, meridians, portolan }

    /* -------------------------------------------------------------- runner */

    function pickScene(){
        const names = Object.keys(SCENES)
        let lastName = null
        try {
            const forced = localStorage.getItem(STORE_FORCE)
            if(forced && SCENES[forced]){
                return forced
            }
            lastName = localStorage.getItem(STORE_LAST)
        } catch(e) {
            // Storage unavailable, any scene will do.
        }
        const pool = names.filter(n => n !== lastName)
        const name = pool[Math.floor(Math.random() * pool.length)]
        try {
            localStorage.setItem(STORE_LAST, name)
        } catch(e) {
            // Not remembered, so the next launch may repeat it.
        }
        return name
    }

    function resize(){
        const dpr = window.devicePixelRatio || 1
        W = container.clientWidth
        H = container.clientHeight
        cx = W / 2
        cy = H / 2
        for(const [canvas, ctx] of [[back, ctxB], [front, ctxF]]){
            canvas.width = Math.round(W * dpr)
            canvas.height = Math.round(H * dpr)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
    }

    function onResize(){
        resize()
        scene && scene.init()
    }

    function tick(now){
        const t = (now - t0) / 1000
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        scene.frame(t, dt)
        raf = requestAnimationFrame(tick)
    }

    function stop(){
        cancelAnimationFrame(raf)
        raf = 0
        window.removeEventListener('resize', onResize)
        // Two screen-sized bitmaps; play() sizes them again.
        for(const canvas of [back, front]){
            canvas.width = 0
            canvas.height = 0
        }
    }

    function play(name){
        stop()
        scene = SCENES[name] || SCENES[pickScene()]
        container.dataset.scene = Object.keys(SCENES).find(k => SCENES[k] === scene)
        resetMark()
        resize()
        ctxB.clearRect(0, 0, W, H)
        ctxF.clearRect(0, 0, W, H)
        scene.init()
        window.addEventListener('resize', onResize)
        if(reducedMotion){
            // Run the entrance off screen and show only where it ends up.
            for(let t = 0; t <= 3.5; t += 1 / 30){
                scene.frame(t, 1 / 30)
            }
            return
        }
        t0 = last = performance.now()
        raf = requestAnimationFrame(tick)
    }

    // How long until the entrance has played out, so the UI does not cut it short.
    function remaining(){
        return raf ? Math.max(0, MIN_SHOW_MS - (performance.now() - t0)) : 0
    }

    window.MeridianSplash = { play, stop, remaining, scenes: Object.keys(SCENES) }

    // Reloaded to change the language: go straight back to the launcher.
    let reopening = false
    try {
        reopening = sessionStorage.getItem('meridian.reopen') != null
    } catch {
        reopening = false
    }
    if(reopening){
        container.style.display = 'none'
    } else {
        play(pickScene())
    }

})()
