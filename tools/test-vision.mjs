// Tests del motor de visión separado (M06): cola de cuadros sin acumulación, descarte de resultados viejos,
// caída del motor y métricas. Correr: node tools/test-vision.mjs
// La ejecución real en un Worker de Safari (GPU/OffscreenCanvas) se valida en el iPad.
const { FrameScheduler, RollingStats, RateCounter } = await import('../web/js/vision-scheduler.js');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

function setup(timeoutMs = 2000) {
    const sent = [], released = [];
    const s = new FrameScheduler({ send: f => sent.push(f), release: f => released.push(f.sequence), timeoutMs });
    return { s, sent, released };
}

console.log('vision (M06)');
t('como máximo un cuadro en vuelo y uno pendiente (el más reciente); los descartados se liberan', () => {
    const { s, sent, released } = setup();
    assert(s.submit({ sequence: 1 }, 0) === 'sent', 'primero');
    for (let i = 2; i <= 10; i++) s.submit({ sequence: i }, i);
    assert(sent.length === 1, `enviados ${sent.length}`);
    assert(s.pending.sequence === 10, 'pendiente no es el último');
    assert(JSON.stringify(released) === JSON.stringify([2, 3, 4, 5, 6, 7, 8, 9]), 'no liberó: ' + released);
    assert(s.dropped === 8, 'contador de descartados');
    assert(s.onResult({ sessionId: s.sessionId, sequence: 1 }, 20) === true, 'resultado 1');
    assert(sent.length === 2 && sent[1].sequence === 10, 'no mandó el pendiente');
});
t('un resultado de una secuencia ya superada o de otra sesión se descarta', () => {
    const { s } = setup();
    s.submit({ sequence: 5 }, 0);
    assert(s.onResult({ sessionId: s.sessionId, sequence: 5 }, 1), '5');
    s.submit({ sequence: 6 }, 2);
    assert(s.onResult({ sessionId: s.sessionId, sequence: 4 }, 3) === false, 'aceptó una secuencia vieja');
    const old = s.sessionId;
    s.newSession();
    assert(s.onResult({ sessionId: old, sequence: 99 }, 4) === false, 'aceptó un resultado de la sesión anterior (T07)');
});
t('el motor que no responde se declara caído; después no se envían ni aceptan cuadros', () => {
    const { s, sent, released } = setup(2000);
    s.submit({ sequence: 1 }, 0);
    s.submit({ sequence: 2 }, 10);
    assert(s.checkTimeout(1500) === false, 'caído antes de tiempo');
    assert(s.checkTimeout(2100) === true, 'no detectó la caída');
    assert(released.includes(2), 'no liberó el pendiente');
    assert(s.submit({ sequence: 3 }, 2200) === 'dropped-dead', 'siguió enviando');
    assert(s.onResult({ sessionId: s.sessionId, sequence: 1 }, 2300) === false, 'aceptó un resultado tardío del motor caído');
    assert(sent.length === 1, 'envió de más');
    s.newSession();
    assert(s.submit({ sequence: 4 }, 2400) === 'sent', 'no se recuperó con sesión nueva');
});
t('cola estable en una sesión larga (sin crecer) con un motor lento', () => {
    const { s, sent } = setup(5000);
    let now = 0, maxQueue = 0;
    for (let seq = 1; seq <= 3000; seq++) {   // cámara a 30 cps durante 100 s
        now += 33;
        s.submit({ sequence: seq }, now);
        maxQueue = Math.max(maxQueue, (s.inFlight ? 1 : 0) + (s.pending ? 1 : 0));
        if (seq % 3 === 0 && s.inFlight) s.onResult({ sessionId: s.sessionId, sequence: s.inFlight.sequence }, now); // motor a ~10 cps
    }
    assert(maxQueue <= 2, `cola ${maxQueue}`);
    assert(sent.length > 900 && sent.length < 1100, `enviados ${sent.length}`);
});
t('métricas: percentiles y cuadros por segundo', () => {
    const st = new RollingStats(5);
    [10, 20, 30, 40, 50, 60].forEach(v => st.push(v));
    assert(st.count === 5 && st.percentile(0.5) === 40 && st.percentile(0.95) === 60, `${st.percentile(0.5)} ${st.percentile(0.95)}`);
    st.push(NaN);
    assert(st.count === 5, 'aceptó NaN');
    const rc = new RateCounter();
    for (let i = 0; i < 60; i++) rc.tick(i * 33);
    assert(rc.rate(60 * 33) >= 29 && rc.rate(60 * 33) <= 31, `fps ${rc.rate(60 * 33)}`);
    assert(rc.rate(10000) === 0, 'no decae');
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
