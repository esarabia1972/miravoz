// Corre todos los tests del proyecto. Uso: npm test   (o: node tools/run-tests.mjs --unit para saltear los de jsdom)
// Los grupos boot y device necesitan jsdom: `npm install` en la raíz (devDependency fijada en package.json).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UNIT = ['test-headpose', 'test-gaze', 'test-calibration', 'test-pages', 'test-sync', 'test-asterics', 'test-selection', 'test-profiles', 'test-contexts', 'test-offline', 'test-vision', 'test-speech', 'test-practice', 'test-blink'];
const DOM = ['test-boot', 'test-device'];
const only = process.argv.includes('--unit') ? UNIT : [...UNIT, ...DOM];

let failed = 0;
for (const name of only) {
    const file = path.join(HERE, name + '.mjs');
    if (!fs.existsSync(file)) continue;
    const r = spawnSync(process.execPath, ['--no-warnings', file], { encoding: 'utf8', timeout: 180000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const lines = out.trim().split('\n');
    const last = [...lines].reverse().find(l => /\d+ (ok|pasan|pasaron)/.test(l)) || lines.pop();
    const ok = r.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name}: ${last}`);
    if (!ok) console.log(out.split('\n').filter(l => l.includes('✗')).slice(0, 10).join('\n'));
}
console.log(failed ? `\n${failed} grupo(s) con fallas` : '\nTodos los grupos pasan');
process.exit(failed ? 1 : 0);
