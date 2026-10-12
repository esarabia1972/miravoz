// practice.js — Sección "Practicar" (1.3.0): cinco actividades para aprender a usar el acceso por cabeza/mirada.
//
// Reglas de cada nivel en practice-logic.js (puro y testeado). Acá: pantalla, dibujo, sonido y registro.
//  - Usa el MISMO cursor, permanencia, barrido y calibración que los tableros: main.js llama a tick() en cada
//    cuadro con la posición del cursor y toma los objetivos (botones) de targets() para la permanencia/barrido.
//  - En Manual el cursor es el dedo (arrastrar); en Barrido solo están los niveles con botones (3 y 4).
//  - Sin conexión: todo se dibuja y se sintetiza acá (sin imágenes ni sonidos descargados).
//  - Sin emojis; los textos los fija el código (textContent).

import { LEVELS, CoverageGrid, noteForY, nextBalloonSize, balloonPosition, BALLOON, optionCount, pickOptions,
    followPosition, nextLoopSeconds, FOLLOW, appendLog, summarize, hintFor, scanBalloonCount } from './practice-logic.js';
import { speak } from './speech.js';

let deps = { setTargets() {}, mode: () => 'CLICKS', scope: () => 'prueba', onExit() {}, blinkInfo: () => ({ available: false, mode: 'off', value: null, threshold: 0.5 }) };
export function initPractice(d) { deps = { ...deps, ...d }; }

let view = null, backBtn, titleEl, hintEl, counterEl, stage, canvas, ctx;
let isOpenFlag = false, activity = null, level = null, targetsList = [];
let touch = null;          // último toque/arrastre en Manual { x, y, t, down }
let stageRect = null, dpr = 1;
let lastTick = 0;
let sizeWatch = () => {};
let bgInert = [];

export function isOpen() { return isOpenFlag; }
export function targets() { return targetsList; }
/** 1.4.0: en "Parpadear" el parpadeo revienta el globo (no elige lo que está bajo el cursor). */
export function wantsBlink() { return !!(isOpenFlag && activity && level && level.needsBlink); }
/** 0.7.5 (H03): en Barrido el parpadeo es el pulsador también acá: el barrido alterna globo y "Actividades". */
export function blinkViaScan() { return wantsBlink() && deps.mode() === 'SCAN'; }
export function onBlink() { if (wantsBlink() && activity.onBlink) activity.onBlink(); }
function setTargets(list) { targetsList = list; if (isOpenFlag) deps.setTargets(list); }

// Botón accesible por permanencia/barrido: se activa con click (toque directo, o el click sintético de la
// permanencia/barrido). En Barrido, tocar la pantalla es el pulsador: ese toque directo no elige el botón.
function makeButton(cls, word, onSelect) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `practice-target ${cls}`;
    b.dataset.word = word;
    b.setAttribute('aria-label', word);
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    b.appendChild(bar);
    b.addEventListener('click', (e) => { if (deps.mode() === 'SCAN' && e.isTrusted) return; onSelect(e); });
    return b;
}
const asTarget = (el) => ({ element: el, isAccBtn: true, data: { label: el.dataset.word } });

// --- Sonido (WebAudio, sintetizado: funciona sin conexión) ---
let audio = null;
function ac() {
    try {
        if (!audio) {
            const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
            // iPadOS 17+: que suene aunque el iPad esté en silencio (como la voz)
            try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
            audio = new C();
        }
        if (audio.state !== 'running') audio.resume().catch(() => {});
        return audio;
    } catch { return null; }
}
function tone(freq, { dur = 0.35, type = 'sine', gain = 0.16, when = 0, glideTo = null } = {}) {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(dur = 0.15, gain = 0.2, freq = 1500, when = 0) {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + when;
    const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0);
}
const chime = () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { dur: 0.6, when: i * 0.09, type: 'triangle', gain: 0.12 }));
const popSound = () => { noise(0.14, 0.35, 1800); tone(620, { dur: 0.14, type: 'square', gain: 0.04, glideTo: 180 }); };
const CHOICE_SOUND = {
    tambor: () => { [0, 0.28, 0.56, 0.7].forEach(w => { tone(120, { dur: 0.3, gain: 0.4, when: w, glideTo: 55 }); noise(0.08, 0.15, 300, w); }); },
    campana: () => { [0, 0.5].forEach(w => [880, 1320, 2093].forEach((f, i) => tone(f, { dur: 1.4, gain: 0.1 / (i + 1), when: w, type: 'sine' }))); },
    melodia: () => { [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => tone(f, { dur: 0.32, when: i * 0.18, type: 'triangle', gain: 0.13 })); },
    silbido: () => { tone(900, { dur: 0.45, glideTo: 1500, gain: 0.12 }); tone(1500, { dur: 0.5, when: 0.45, glideTo: 1050, gain: 0.12 }); }
};
let hum = null; // tono suave y continuo del nivel 5 (sube cuando el cursor acompaña)
function humStart() {
    const a = ac(); if (!a || hum) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = 392; g.gain.value = 0.0001;
    o.connect(g).connect(a.destination); o.start();
    hum = { o, g };
}
function humLevel(on) { if (hum && audio) hum.g.gain.setTargetAtTime(on ? 0.07 : 0.0001, audio.currentTime, 0.12); }
function humStop() {
    if (!hum) return;
    const h = hum; hum = null;
    try { h.g.gain.setTargetAtTime(0.0001, audio.currentTime, 0.02); h.o.stop(audio.currentTime + 0.08); } catch { try { h.o.stop(); } catch {} }
}

let lastPraise = 0;
function praise(text = '¡Muy bien!') {
    chime();
    const now = performance.now();
    if (now - lastPraise > 4000) { lastPraise = now; speak(text, { cancelPrevious: true }); }
}

// --- Pantalla ---
function build() {
    view = document.createElement('div');
    view.id = 'practice-view';
    view.className = 'practice-view';
    view.hidden = true;
    view.setAttribute('aria-label', 'Practicar');
    const header = document.createElement('div');
    header.className = 'practice-header';
    // "Actividades" y "Salir" son el mismo botón: con permanencia, tras usarlo se ignora por 2,5 s (si el cursor
    // se queda quieto ahí, no se encadena una salida no buscada)
    let lastBackAt = -Infinity;
    backBtn = makeButton('practice-back', 'Salir', (e) => {
        const now = performance.now();
        const byDwell = !e.isTrusted && (deps.mode() === 'CARA');
        if (byDwell && now - lastBackAt < 2500) return; // solo la permanencia se encadena; un toque siempre vale
        lastBackAt = now;
        onBack();
    });
    const backLabel = document.createElement('span');
    backLabel.className = 'practice-back-label';
    backBtn.prepend(backLabel);
    const titles = document.createElement('div');
    titles.className = 'practice-titles';
    titleEl = document.createElement('h2');
    hintEl = document.createElement('p');
    titles.append(titleEl, hintEl);
    counterEl = document.createElement('div');
    counterEl.className = 'practice-counter';
    counterEl.setAttribute('aria-live', 'polite');
    header.append(backBtn, titles, counterEl);
    stage = document.createElement('div');
    stage.className = 'practice-stage';
    canvas = document.createElement('canvas');
    canvas.className = 'practice-canvas';
    stage.appendChild(canvas);
    ctx = canvas.getContext('2d');
    view.append(header, stage);
    document.body.appendChild(view);

    // Manual: el dedo (o el mouse) es el cursor
    const pt = (e, down) => { touch = { x: e.clientX, y: e.clientY, t: performance.now(), down }; };
    stage.addEventListener('pointerdown', e => pt(e, true));
    stage.addEventListener('pointermove', e => pt(e, touch ? touch.down || e.pointerType === 'mouse' : e.pointerType === 'mouse'));
    const up = () => { if (touch) touch.down = false; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // Pestaña oculta: el dibujo se detiene; el tono continuo no tiene que quedar sonando
    document.addEventListener('visibilitychange', () => { if (document.hidden) humLevel(false); });
    // Cambio de tamaño real (girar, Split View): se re-mide; no se reinicia por las barras de Safari
    let rz = null, lastSize = null;
    window.addEventListener('resize', () => {
        clearTimeout(rz);
        rz = setTimeout(() => {
            if (!isOpenFlag || !activity) return;
            const r = stage.getBoundingClientRect();
            if (lastSize && Math.abs(r.width - lastSize.w) / lastSize.w < 0.1 && Math.abs(r.height - lastSize.h) / lastSize.h < 0.1) { stageRect = r; return; }
            restartActivity();
        }, 300);
    });
    sizeWatch = (r) => { lastSize = { w: r.width, h: r.height }; };
}

function setBack(label) { backBtn.querySelector('.practice-back-label').textContent = label; backBtn.dataset.word = label; backBtn.setAttribute('aria-label', label); }
function setHeader(title, hint, counter = '') { titleEl.textContent = title; hintEl.textContent = hint; counterEl.textContent = counter; }

function measureStage() { stageRect = stage.getBoundingClientRect(); sizeWatch(stageRect); return stageRect; }
function sizeCanvas() {
    measureStage();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(stageRect.width * dpr));
    canvas.height = Math.max(1, Math.round(stageRect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: stageRect.width, h: stageRect.height };
}

export function openPractice() {
    if (!view) build();
    ac(); // el toque que abre la sección habilita el sonido en iPad
    isOpenFlag = true;
    view.hidden = false;
    document.body.classList.add('practice-open');
    // El fondo (inicio, barras, tablero) no se activa por teclado ni pulsador mientras se practica
    bgInert = ['home-view', 'board-view', 'top-bar', 'bottom-bar'].map(id => document.getElementById(id)).filter(el => el && !el.inert);
    bgInert.forEach(el => { el.inert = true; });
    showMenu();
}

export function closePractice({ silent = false } = {}) {
    if (!isOpenFlag) return;
    stopActivity();
    isOpenFlag = false;
    view.hidden = true;
    document.body.classList.remove('practice-open');
    targetsList = [];
    humStop();
    bgInert.forEach(el => { el.inert = false; }); bgInert = [];
    // El mismo toque que eligió "Salir" (en Barrido, tocar la pantalla) no tiene que caer en el inicio
    const block = (e) => { if (e.isTrusted) { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener('click', block, true);
    setTimeout(() => window.removeEventListener('click', block, true), 500);
    if (!silent) deps.onExit();
}

function onBack() { if (activity) { stopActivity(); showMenu(); } else closePractice(); }

// --- Menú de niveles ---
function showMenu() {
    level = null;
    setBack('Salir');
    setHeader('Practicar', 'Elegí una actividad. Van de la más simple a la más difícil.');
    canvas.style.display = 'none';
    stage.querySelectorAll('.practice-layer').forEach(n => n.remove());
    const menu = document.createElement('div');
    menu.className = 'practice-layer practice-menu';
    const scan = deps.mode() === 'SCAN';
    const log = readLog();
    const list = [];
    for (const lv of LEVELS) {
        const blinkInfo = deps.blinkInfo();
        const disabled = (scan && lv.pointerOnly) || (lv.needsBlink && !blinkInfo.available);
        const card = makeButton('practice-card', `${lv.title}`, () => { if (!disabled) startLevel(lv); });
        card.style.setProperty('--lv', String(lv.id));
        const num = document.createElement('span'); num.className = 'practice-card-num'; num.textContent = String(lv.id);
        const t = document.createElement('span'); t.className = 'practice-card-title'; t.textContent = lv.title;
        const s = document.createElement('span'); s.className = 'practice-card-skill'; s.textContent = lv.skill;
        const last = [...log].reverse().find(e => e.level === lv.id);
        const sub = document.createElement('span'); sub.className = 'practice-card-last';
        sub.textContent = disabled ? (lv.needsBlink ? 'Activá el parpadeo en Configuración' : 'Con Manual, Rostro o Mirada') : (last ? `Última vez: ${summarize(last)}` : '');
        card.append(num, t, s, sub);
        if (disabled) { card.classList.add('is-disabled'); card.setAttribute('aria-disabled', 'true'); }
        else list.push(asTarget(card));
        menu.appendChild(card);
    }
    stage.appendChild(menu);
    setTargets([...list, asTarget(backBtn)]); // "Salir" al final del barrido
}

// --- Actividades ---
function startLevel(lv) {
    level = lv;
    setBack('Actividades');
    stage.querySelectorAll('.practice-layer').forEach(n => n.remove());
    activity = ACTIVITIES[lv.key]();
    activity.startedAt = Date.now();
    activity.start(performance.now());
    speak(hintFor(lv, deps.mode(), deps.blinkInfo().mode), { cancelPrevious: true });
}
function restartActivity() { if (!level) return; const lv = level; stopActivity(); startLevel(lv); }
function stopActivity() {
    if (!activity) return;
    const result = activity.stop ? activity.stop() : {};
    humStop();
    const entry = { level: level.id, startedAt: activity.startedAt, durationMs: Date.now() - activity.startedAt, mode: deps.mode(), ...result };
    if (entry.durationMs > 3000) writeLog(entry);
    activity = null;
    stage.querySelectorAll('.practice-layer').forEach(n => n.remove());
    canvas.style.display = 'none';
}

/** Llamar en cada cuadro. cursor = {x, y} en px de la ventana (Rostro o Mirada) o null (sin cursor / Manual / Barrido). */
export function tickPractice(now, cursor) {
    if (!isOpenFlag || !activity) return;
    const dt = lastTick ? Math.min(100, now - lastTick) : 16;
    lastTick = now;
    let p = cursor;
    if (!p && touch && (touch.down || now - touch.t < 120)) p = touch;
    let local = null;
    if (p && stageRect) {
        const x = p.x - stageRect.left, y = p.y - stageRect.top;
        if (x >= 0 && y >= 0 && x <= stageRect.width && y <= stageRect.height) local = { x, y };
    }
    activity.tick(now, local, dt);
}

// Colores del dibujo según el modo Día/Noche (se leen en cada cuadro: siguen al tema de la app)
const PALETTES = {
    dark: { bg: '#0f1420', fade: 'rgba(15,20,32,0.018)', light: 62, line: 'rgba(255,255,255,0.05)', track: 'rgba(255,255,255,0.1)', ring: 'rgba(255,255,255,0.5)',
        cover: ['#3a4256', '#262c3b'], dots: 'rgba(255,255,255,0.06)', fly: [255, 214, 90], flyCore: ['#fff6c2', '#ffe27a'], bar: '#ffd65a' },
    light: { bg: '#f4f6fb', fade: 'rgba(244,246,251,0.022)', light: 50, line: 'rgba(15,23,42,0.08)', track: 'rgba(15,23,42,0.1)', ring: 'rgba(15,23,42,0.45)',
        cover: ['#cfd5e1', '#b7bfce'], dots: 'rgba(255,255,255,0.45)', fly: [255, 140, 0], flyCore: ['#ffb84d', '#ff9f1c'], bar: '#e58600' }
};
const pal = () => (document.documentElement.getAttribute('data-theme') === 'light' ? PALETTES.light : PALETTES.dark);
const ACTIVITIES = {
    // 1. Causa y efecto: cualquier movimiento pinta y suena
    paint() {
        let w, h, grid, last, moveAcc = 0, lastNote = 0, lastMoveAt = 0, hue = Math.random() * 360, done = 0, activeMs = 0;
        return {
            start(now) {
                setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), '');
                canvas.style.display = 'block';
                ({ w, h } = sizeCanvas());
                ctx.fillStyle = pal().bg; ctx.fillRect(0, 0, w, h);
                grid = new CoverageGrid(8, 6); lastMoveAt = now;
                setTargets([asTarget(backBtn)]);
            },
            tick(now, p, dt) {
                ctx.fillStyle = pal().fade; ctx.fillRect(0, 0, w, h); // los trazos se desvanecen despacio
                const brush = Math.max(14, Math.min(w, h) * 0.035);
                if (p) {
                    if (last) {
                        const d = Math.hypot(p.x - last.x, p.y - last.y);
                        if (d > 1.5) {
                            hue = (hue + d * 0.25) % 360;
                            ctx.strokeStyle = `hsl(${hue}, 90%, ${pal().light}%)`; ctx.lineWidth = brush; ctx.lineCap = 'round';
                            ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
                            moveAcc += d; activeMs += dt; lastMoveAt = now;
                            grid.mark(p.x, p.y, brush, w, h);
                            if (moveAcc > 70 && now - lastNote > 170) { tone(noteForY(p.y, h), { dur: 0.4, type: 'triangle', gain: 0.12 }); moveAcc = 0; lastNote = now; }
                        }
                    }
                    last = p;
                    ctx.fillStyle = `hsla(${hue}, 100%, 75%, 0.9)`; ctx.beginPath(); ctx.arc(p.x, p.y, brush * 0.35, 0, Math.PI * 2); ctx.fill();
                } else last = null;
                if (grid.fraction() >= 0.6) { done++; grid.reset(); praise(); counterEl.textContent = `Pantallas pintadas: ${done}`; }
                hintEl.classList.toggle('practice-hint-pulse', now - lastMoveAt > 5000);
            },
            stop() { hintEl.classList.remove('practice-hint-pulse'); return { done, activeMs: Math.round(activeMs) }; }
        };
    },

    // 2. Explorar: recorrer toda la pantalla para descubrir un dibujo
    reveal() {
        let w, h, grid, sceneCv, coverCv, cctx, last, idx = Math.floor(Math.random() * SCENES.length), revealAt = 0, done = 0;
        const R = () => Math.min(w, h) * 0.1;
        function newScene() {
            idx = (idx + 1) % SCENES.length;
            sceneCv = document.createElement('canvas'); sceneCv.width = w; sceneCv.height = h;
            SCENES[idx].draw(sceneCv.getContext('2d'), w, h);
            coverCv = document.createElement('canvas'); coverCv.width = w; coverCv.height = h;
            cctx = coverCv.getContext('2d');
            const g = cctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, pal().cover[0]); g.addColorStop(1, pal().cover[1]);
            cctx.fillStyle = g; cctx.fillRect(0, 0, w, h);
            cctx.fillStyle = pal().dots;
            for (let y = 20; y < h; y += 40) for (let x = 20 + (y / 40 % 2) * 20; x < w; x += 40) { cctx.beginPath(); cctx.arc(x, y, 3, 0, Math.PI * 2); cctx.fill(); }
            grid = new CoverageGrid(8, 5); revealAt = 0; last = null;
        }
        return {
            start() {
                setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), '');
                canvas.style.display = 'block';
                ({ w, h } = sizeCanvas());
                newScene();
                setTargets([asTarget(backBtn)]);
            },
            tick(now, p) {
                if (!revealAt && p) {
                    cctx.globalCompositeOperation = 'destination-out';
                    cctx.lineCap = 'round'; cctx.lineWidth = R() * 2;
                    cctx.beginPath();
                    if (last) { cctx.moveTo(last.x, last.y); cctx.lineTo(p.x, p.y); cctx.stroke(); }
                    cctx.beginPath(); cctx.arc(p.x, p.y, R(), 0, Math.PI * 2); cctx.fill();
                    cctx.globalCompositeOperation = 'source-over';
                    if (grid.mark(p.x, p.y, R(), w, h) && grid.count % 4 === 0) tone(noteForY(p.y, h), { dur: 0.25, gain: 0.07 });
                    last = p;
                    if (grid.fraction() >= 0.85) { revealAt = now; done++; praise(SCENES[idx].name); counterEl.textContent = `Dibujos descubiertos: ${done}`; }
                } else if (!p) last = null;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(sceneCv, 0, 0, w, h);
                if (revealAt) {
                    const k = Math.min(1, (now - revealAt) / 800);
                    ctx.globalAlpha = 1 - k; ctx.drawImage(coverCv, 0, 0, w, h); ctx.globalAlpha = 1;
                    if (now - revealAt > 3500) newScene();
                } else ctx.drawImage(coverCv, 0, 0, w, h);
                if (p && !revealAt) { ctx.strokeStyle = pal().ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, R(), 0, Math.PI * 2); ctx.stroke(); }
            },
            stop() { return { done }; }
        };
    },

    // 3. Apuntar: globos que se achican si acierta y crecen si cuesta
    balloon() {
        if (deps.mode() === 'SCAN') return scanBalloons();
        let layer, el, size, pos, appearedAt = 0, popping = false, done = 0, w, h;
        const times = [];
        const COLORS = ['#ff5d73', '#ffb547', '#4cc9f0', '#7bd389', '#b28dff'];
        function place(keepCenter) {
            if (keepCenter && pos) {
                const c = { x: pos.x + parseFloat(el.style.width) / 2, y: pos.y + parseFloat(el.style.height) / 2 };
                pos = { x: Math.max(8, Math.min(w - size - 8, c.x - size / 2)), y: Math.max(8, Math.min(h - size - 8, c.y - size / 2)) };
            } else pos = balloonPosition(size, w, h, Math.random, pos);
            Object.assign(el.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${size}px`, height: `${size}px` });
        }
        function spawn(now) {
            el.classList.remove('pop', 'active', 'clicked');
            el.style.setProperty('--balloon', COLORS[done % COLORS.length]);
            el.style.transition = 'none'; // aparece directo en su lugar (sin deslizarse): la permanencia mide el lugar real
            place(false);
            void el.offsetWidth;
            el.style.transition = '';
            appearedAt = now; popping = false;
            setTargets([asTarget(el), asTarget(backBtn)]); // "Actividades" al final: en Barrido se resalta primero el globo
        }
        function pop() {
            if (popping) return;
            popping = true;
            times.push(performance.now() - appearedAt);
            done++;
            popSound();
            el.classList.add('pop');
            burst(layer, pos.x + size / 2, pos.y + size / 2, size, getComputedStyle(el).getPropertyValue('--balloon') || '#ff5d73');
            counterEl.textContent = `Globos: ${done}`;
            if (done % 5 === 0) praise();
            // los objetivos no cambian mientras explota (pop() ignora lo que llegue): el barrido no salta a "Actividades"
            setTimeout(() => { if (activity && layer.isConnected) { size = nextBalloonSize(size, { popped: true, minDim: Math.min(w, h) }); spawn(performance.now()); } }, 650);
        }
        return {
            start(now) {
                canvas.style.display = 'none';
                setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), 'Globos: 0');
                measureStage(); w = stageRect.width; h = stageRect.height;
                layer = document.createElement('div'); layer.className = 'practice-layer practice-balloons';
                el = makeButton('practice-balloon', 'Globo', pop);
                layer.appendChild(el); stage.appendChild(layer);
                size = BALLOON.startFrac * Math.min(w, h);
                spawn(now);
            },
            tick(now) {
                if (!popping && now - appearedAt > BALLOON.helpAfterMs) {
                    // Cuesta: el globo crece (sin error ni penalidad) y se reinicia la espera
                    size = nextBalloonSize(size, { popped: false, minDim: Math.min(w, h) });
                    // crece sin animar el tamaño: la permanencia lo vuelve a medir sola (sin reiniciar el barrido)
                    el.style.transition = 'none'; place(true); void el.offsetWidth; el.style.transition = '';
                    appearedAt = now;
                }
            },
            stop() {
                const sorted = [...times].sort((a, b) => a - b);
                return { done, medianMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null, finalSizeFrac: +(size / Math.min(w, h)).toFixed(3) };
            }
        };
    },

    // 4. Elegir: 2 → 3 → 4 opciones; todas las respuestas valen (es elegir, no acertar)
    choose() {
        let layer, made = 0, busy = false, roundAt = 0;
        const times = [], timers = [];
        const later = (fn, ms) => timers.push(setTimeout(() => { if (activity && layer.isConnected) fn(); }, ms));
        function round() {
            layer.replaceChildren();
            const opts = pickOptions(optionCount(made));
            const btns = opts.map(o => {
                const b = makeButton('practice-choice', o.label, () => pick(o, b));
                b.style.setProperty('--choice', o.color);
                const icon = document.createElement('span'); icon.className = 'practice-choice-icon'; icon.innerHTML = ICONS[o.key]; // SVG fijo del código
                const lab = document.createElement('span'); lab.className = 'practice-choice-label'; lab.textContent = o.label;
                b.append(icon, lab);
                return b;
            });
            layer.append(...btns);
            roundAt = performance.now(); busy = false;
            setTargets([...btns.map(asTarget), asTarget(backBtn)]);
        }
        function pick(o, b) {
            if (busy) return;
            busy = true; made++;
            times.push(performance.now() - roundAt);
            b.classList.add('chosen');
            layer.classList.add('has-chosen');
            speak(o.label, { cancelPrevious: true });
            later(() => CHOICE_SOUND[o.key](), 650);
            counterEl.textContent = `Elecciones: ${made}`;
            if (made === 5 || made === 10) later(() => praise('¡Muy bien! Ahora hay una opción más'), 2400);
            later(() => { layer.classList.remove('has-chosen'); round(); }, 2600);
        }
        return {
            start() {
                canvas.style.display = 'none';
                layer = document.createElement('div'); layer.className = 'practice-layer practice-choices';
                stage.appendChild(layer);
                setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), 'Elecciones: 0');
                round();
            },
            tick() {},
            stop() { timers.forEach(clearTimeout); const s = [...times].sort((a, b) => a - b); return { done: made, medianMs: s.length ? Math.round(s[Math.floor(s.length / 2)]) : null }; }
        };
    },

    // 5. Seguir: una luciérnaga que se mueve despacio; acompañarla llena la barra
    follow() {
        let w, h, t = 0, loop = FOLLOW.loopSeconds, onMs = 0, presentMs = 0, sumOn = 0, done = 0;
        return {
            start() {
                setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), '');
                canvas.style.display = 'block';
                ({ w, h } = sizeCanvas());
                humStart();
                setTargets([asTarget(backBtn)]);
            },
            tick(now, p, dt) {
                const r = Math.min(w, h) * FOLLOW.radiusFrac;
                // Sin cursor (no se ve la cara, o en Manual sin tocar) la luciérnaga espera: nadie queda atrás
                if (p) { t += dt / 1000; presentMs += dt; }
                const f = followPosition(t, w, h, loop);
                const near = !!p && Math.hypot(p.x - f.x, p.y - f.y) < r * FOLLOW.nearFactor;
                if (near) { onMs += dt; sumOn += dt; }
                humLevel(near);
                if (onMs >= FOLLOW.goalMs) { onMs = 0; done++; loop = nextLoopSeconds(loop); praise(); counterEl.textContent = `Vueltas: ${done}`; }
                const P = pal();
                ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h);
                // estela del recorrido (tenue)
                ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.beginPath();
                for (let k = 0; k <= 80; k++) { const q = followPosition(t + (k - 40) * 0.08, w, h, loop); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
                ctx.stroke();
                const glow = near ? 3.2 : 2.2;
                const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * glow);
                const [fr, fg, fb] = P.fly;
                g.addColorStop(0, `rgba(${fr},${fg},${fb},${near ? 1 : 0.9})`);
                g.addColorStop(0.35, `rgba(${fr},${fg},${fb},${near ? 0.55 : 0.25})`);
                g.addColorStop(1, `rgba(${fr},${fg},${fb},0)`);
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r * glow, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = near ? P.flyCore[0] : P.flyCore[1]; ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.55, 0, Math.PI * 2); ctx.fill();
                // barra de progreso arriba
                ctx.fillStyle = P.track; ctx.fillRect(16, 12, w - 32, 10);
                ctx.fillStyle = P.bar; ctx.fillRect(16, 12, (w - 32) * Math.min(1, onMs / FOLLOW.goalMs), 10);
            },
            stop() { return { done, onTargetFrac: presentMs ? +(sumOn / presentMs).toFixed(3) : 0 }; }
        };
    }
};

// --- Globo que revienta: onda expansiva + pedazos de goma que salen volando y caen ---
function burst(layer, cx, cy, size, color) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const b = document.createElement('div');
    b.className = 'practice-burst';
    Object.assign(b.style, { left: `${cx}px`, top: `${cy}px` });
    b.style.setProperty('--balloon', color.trim());
    const ring = document.createElement('span');
    ring.className = 'practice-ring';
    ring.style.setProperty('--d', `${size}px`);
    b.appendChild(ring);
    const n = reduce ? 0 : 14;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const dist = size * (0.55 + Math.random() * 0.6);
        const sh = document.createElement('span');
        sh.className = i % 3 === 0 ? 'practice-shard practice-shard-dot' : 'practice-shard';
        sh.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
        sh.style.setProperty('--dy', `${Math.sin(a) * dist + size * 0.35}px`); // caen un poco (gravedad)
        sh.style.setProperty('--rot', `${Math.round((Math.random() * 2 - 1) * 540)}deg`);
        sh.style.setProperty('--sw', `${Math.max(8, size * (0.06 + Math.random() * 0.06))}px`);
        sh.style.setProperty('--sh', `${Math.max(6, size * (0.03 + Math.random() * 0.05))}px`);
        sh.style.animationDelay = `${Math.random() * 40}ms`;
        b.appendChild(sh);
    }
    layer.appendChild(b);
    setTimeout(() => b.remove(), 900);
}

// --- 3 en Barrido: la habilidad clave del barrido es el TIEMPO — esperar a que se resalte lo que quiero y
// recién ahí activar. Hay 2 a 5 globos en fila y uno dorado; elegir otro no es error: el globo se sacude y sigue.
function scanBalloons() {
    let layer, done = 0, misses = 0, busy = false, roundAt = 0;
    const times = [], timers = [];
    const later = (fn, ms) => timers.push(setTimeout(() => { if (activity && layer.isConnected) fn(); }, ms));
    const COLORS = ['#ff5d73', '#4cc9f0', '#7bd389', '#b28dff', '#ff8fab'];
    function round() {
        layer.replaceChildren();
        const n = scanBalloonCount(done);
        const goal = Math.floor(Math.random() * n);
        const r = stage.getBoundingClientRect();
        const size = Math.min((r.width - 40) / n * 0.72, r.height * 0.5);
        const btns = [];
        for (let i = 0; i < n; i++) {
            const isGoal = i === goal;
            const b = makeButton(`practice-balloon${isGoal ? ' is-goal' : ''}`, isGoal ? 'Globo dorado' : 'Globo', () => pick(b, isGoal));
            b.style.setProperty('--balloon', isGoal ? '#ffc93c' : COLORS[i % COLORS.length]);
            const slot = (r.width - 40) / n;
            Object.assign(b.style, { left: `${20 + slot * i + (slot - size) / 2}px`, top: `${(r.height - size) / 2 - 10}px`, width: `${size}px`, height: `${size}px` });
            btns.push(b);
        }
        layer.append(...btns);
        roundAt = performance.now(); busy = false;
        setTargets([...btns.map(asTarget), asTarget(backBtn)]);
    }
    function pick(b, isGoal) {
        if (busy) return;
        if (!isGoal) {
            misses++;
            b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
            tone(220, { dur: 0.15, gain: 0.06 });
            return;
        }
        busy = true; done++;
        times.push(performance.now() - roundAt);
        popSound();
        b.classList.add('pop');
        const r = b.getBoundingClientRect(), lr = layer.getBoundingClientRect();
        burst(layer, r.left - lr.left + r.width / 2, r.top - lr.top + r.height / 2, r.width, '#ffc93c');
        counterEl.textContent = `Globos: ${done}`;
        if (done % 4 === 0) praise(done < 13 ? '¡Muy bien! Ahora hay un globo más' : '¡Muy bien!');
        later(round, 750);
    }
    return {
        start() {
            canvas.style.display = 'none';
            setHeader(level.title, hintFor(level, 'SCAN'), 'Globos: 0');
            layer = document.createElement('div'); layer.className = 'practice-layer practice-balloons';
            stage.appendChild(layer);
            round();
        },
        tick() {},
        stop() { timers.forEach(clearTimeout); const s = [...times].sort((a, b) => a - b); return { done, misses, medianMs: s.length ? Math.round(s[Math.floor(s.length / 2)]) : null, variant: 'scan' }; }
    };
}

// --- 6. Parpadear: un globo grande en el centro; el parpadeo voluntario lo revienta ---
// Abajo, una barra muestra cuánto se cierran los ojos y la línea del umbral: sirve para que la persona
// de apoyo vea si la cámara distingue el parpadeo (y si hace falta "Ajustar a esta persona").
ACTIVITIES.blink = function () {
    let layer, el, meter, fill, mark, done = 0, popping = false, w, h, size;
    const COLORS = ['#b28dff', '#4cc9f0', '#ff5d73', '#7bd389', '#ffb547'];
    function spawn() {
        el.classList.remove('pop');
        el.style.setProperty('--balloon', COLORS[done % COLORS.length]);
        el.style.transition = 'none';
        Object.assign(el.style, { left: `${(w - size) / 2}px`, top: `${(h - size) / 2 - 20}px`, width: `${size}px`, height: `${size}px` });
        void el.offsetWidth; el.style.transition = '';
        popping = false;
    }
    return {
        start() {
            setHeader(level.title, hintFor(level, deps.mode(), deps.blinkInfo().mode), 'Globos: 0');
            canvas.style.display = 'none';
            measureStage(); w = stageRect.width; h = stageRect.height;
            size = Math.min(w, h) * 0.42;
            layer = document.createElement('div'); layer.className = 'practice-layer practice-balloons';
            el = document.createElement('div'); el.className = 'practice-target practice-balloon practice-balloon-static'; el.setAttribute('aria-hidden', 'true');
            meter = document.createElement('div'); meter.className = 'practice-blink-meter';
            fill = document.createElement('div'); fill.className = 'practice-blink-fill';
            mark = document.createElement('div'); mark.className = 'practice-blink-mark';
            const cap = document.createElement('span'); cap.className = 'practice-blink-cap'; cap.textContent = 'Ojos cerrados';
            meter.append(fill, mark, cap);
            layer.append(el, meter); stage.appendChild(layer);
            spawn();
            if (deps.mode() === 'SCAN') {
                // El globo es un elemento más del barrido: parpadear con el globo resaltado lo revienta y con
                // "Actividades" resaltado se sale (así se puede salir solo con parpadeo).
                el.dataset.word = 'Globo';
                el.addEventListener('click', (e) => { if (!e.isTrusted && activity) activity.onBlink(); });
                setTargets([asTarget(el), asTarget(backBtn)]);
            } else setTargets([asTarget(backBtn)]);
        },
        tick() {
            const b = deps.blinkInfo();
            const v = Number.isFinite(b.value) ? b.value : 0;
            fill.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
            fill.classList.toggle('is-closed', v >= b.threshold);
            mark.style.left = `${Math.round(b.threshold * 100)}%`;
        },
        onBlink() {
            if (popping) return;
            popping = true; done++;
            popSound();
            el.classList.add('pop');
            burst(layer, w / 2, (h - size) / 2 - 20 + size / 2, size, COLORS[(done - 1) % COLORS.length]);
            counterEl.textContent = `Globos: ${done}`;
            if (done % 5 === 0) praise();
            setTimeout(() => { if (activity && layer.isConnected) spawn(); }, 700);
        },
        stop() { return { done }; }
    };
};

// --- Íconos de "Elegir" (SVG fijo) ---
const ICONS = {
    tambor: '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="22" rx="22" ry="8" fill="currentColor" opacity=".9"/><path d="M10 22v20c0 4.4 9.8 8 22 8s22-3.6 22-8V22" fill="none" stroke="currentColor" stroke-width="4"/><path d="M10 30l44 12M54 30L10 42" stroke="currentColor" stroke-width="2.5" opacity=".7"/><path d="M40 6l10 12M24 6L14 18" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>',
    campana: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8c-10 0-16 8-16 18v12l-6 8h44l-6-8V26c0-10-6-18-16-18z" fill="currentColor"/><circle cx="32" cy="52" r="5" fill="currentColor"/><circle cx="32" cy="7" r="3" fill="currentColor"/></svg>',
    melodia: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 46V14l28-6v32" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><ellipse cx="17" cy="46" rx="8" ry="6" fill="currentColor"/><ellipse cx="45" cy="40" rx="8" ry="6" fill="currentColor"/></svg>',
    silbido: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M6 32c6-12 12-12 18 0s12 12 18 0 12-12 16 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M6 46c6-8 12-8 18 0s12 8 18 0 12-8 16 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".6"/></svg>'
};

// --- Dibujos de "Descubrir" (hechos con código: sin imágenes ni licencias) ---
const SCENES = [
    { name: '¡Un sol y montañas!', draw(c, w, h) {
        const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#5ec8ff'); sky.addColorStop(1, '#bfe9ff');
        c.fillStyle = sky; c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(w * 0.78, h * 0.25, Math.min(w, h) * 0.12, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#ffd23f'; c.lineWidth = 6;
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, r1 = Math.min(w, h) * 0.16, r2 = Math.min(w, h) * 0.22; c.beginPath(); c.moveTo(w * 0.78 + Math.cos(a) * r1, h * 0.25 + Math.sin(a) * r1); c.lineTo(w * 0.78 + Math.cos(a) * r2, h * 0.25 + Math.sin(a) * r2); c.stroke(); }
        c.fillStyle = '#5b6c8f'; c.beginPath(); c.moveTo(0, h * 0.8); c.lineTo(w * 0.28, h * 0.35); c.lineTo(w * 0.55, h * 0.8); c.fill();
        c.fillStyle = '#7488ad'; c.beginPath(); c.moveTo(w * 0.3, h * 0.8); c.lineTo(w * 0.6, h * 0.42); c.lineTo(w * 0.95, h * 0.8); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(w * 0.28, h * 0.35); c.lineTo(w * 0.23, h * 0.43); c.lineTo(w * 0.33, h * 0.43); c.fill();
        c.fillStyle = '#4caf50'; c.fillRect(0, h * 0.78, w, h * 0.22);
    } },
    { name: '¡Un pez!', draw(c, w, h) {
        const sea = c.createLinearGradient(0, 0, 0, h); sea.addColorStop(0, '#1e88e5'); sea.addColorStop(1, '#0d3b66');
        c.fillStyle = sea; c.fillRect(0, 0, w, h);
        const cx = w * 0.5, cy = h * 0.5, L = Math.min(w, h) * 0.28;
        c.fillStyle = '#ff8c42'; c.beginPath(); c.ellipse(cx, cy, L, L * 0.55, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.moveTo(cx - L * 0.9, cy); c.lineTo(cx - L * 1.5, cy - L * 0.5); c.lineTo(cx - L * 1.5, cy + L * 0.5); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx + L * 0.5, cy - L * 0.12, L * 0.14, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(cx + L * 0.54, cy - L * 0.12, L * 0.07, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 3;
        for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(cx + L * 1.2 + (i % 2) * 18, cy - L * 0.4 - i * 26, 7 + i * 1.5, 0, Math.PI * 2); c.stroke(); }
        c.strokeStyle = '#2e7d32'; c.lineWidth = 10; c.lineCap = 'round';
        for (const x of [0.1, 0.18, 0.86, 0.93]) { c.beginPath(); c.moveTo(w * x, h); c.quadraticCurveTo(w * x + 30, h * 0.8, w * x, h * 0.62); c.stroke(); }
    } },
    { name: '¡La luna y las estrellas!', draw(c, w, h) {
        c.fillStyle = '#0b1a3a'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff5c0'; c.beginPath(); c.arc(w * 0.3, h * 0.35, Math.min(w, h) * 0.16, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#0b1a3a'; c.beginPath(); c.arc(w * 0.3 + Math.min(w, h) * 0.07, h * 0.31, Math.min(w, h) * 0.15, 0, Math.PI * 2); c.fill();
        let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        c.fillStyle = '#ffffff';
        for (let i = 0; i < 70; i++) { const x = rnd() * w, y = rnd() * h, r = 1 + rnd() * 3; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
        const star = (x, y, r) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); };
        c.fillStyle = '#ffd23f'; star(w * 0.7, h * 0.3, Math.min(w, h) * 0.08); star(w * 0.82, h * 0.65, Math.min(w, h) * 0.06); star(w * 0.55, h * 0.75, Math.min(w, h) * 0.05);
    } },
    { name: '¡Una flor!', draw(c, w, h) {
        const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#fbe3ff'); sky.addColorStop(1, '#e0f7ff');
        c.fillStyle = sky; c.fillRect(0, 0, w, h);
        c.fillStyle = '#66bb6a'; c.fillRect(0, h * 0.82, w, h * 0.18);
        const cx = w * 0.5, cy = h * 0.42, R = Math.min(w, h) * 0.12;
        c.strokeStyle = '#388e3c'; c.lineWidth = 12; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, h * 0.85); c.stroke();
        c.fillStyle = '#43a047'; c.beginPath(); c.ellipse(cx + R * 0.8, h * 0.68, R * 0.7, R * 0.3, -0.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ff4f8b';
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * 0.62, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(cx, cy, R * 0.75, 0, Math.PI * 2); c.fill();
    } }
];

// --- Registro local por persona (para la futura pestaña "Progreso"; no se envía a ningún lado todavía) ---
const logKey = () => `miravoz_practice_${deps.scope()}`;
function readLog() { try { return JSON.parse(localStorage.getItem(logKey()) || '[]') || []; } catch { return []; } }
function writeLog(entry) { try { deps.onLog?.(entry); } catch {} try { localStorage.setItem(logKey(), JSON.stringify(appendLog(readLog(), entry))); } catch { /* sin espacio: se pierde el registro, no la práctica */ } }
