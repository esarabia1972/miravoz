// Genera web/offline-manifest.json: la lista COMPLETA y versionada de lo que el Service Worker descarga para
// que MiraVoz abra sin conexión (M05). Cada archivo lleva su sha256: el Service Worker verifica cada respuesta
// y, si algo no coincide (p. ej. un deploy a medio publicar), NO instala la versión nueva y conserva la anterior.
//
// Uso:  node tools/build-offline-manifest.mjs           (regenera; correrlo antes de cada commit que toque web/)
//       node tools/build-offline-manifest.mjs --check   (falla si el manifiesto quedó desactualizado; lo usa npm test)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const OUT = path.join(WEB, 'offline-manifest.json');
// Versión visible (semver) — fuente única: "version" de package.json. Se sube en cada publicación (ver EQUIPO.md).
export const APP_VERSION = JSON.parse(fs.readFileSync(path.resolve(HERE, '../package.json'), 'utf8')).version;

// Archivos locales que forman la app (se excluye lo que no se usa en el navegador)
const EXCLUDE = new Set(['offline-manifest.json', 'sw.js', 'package.json', 'vercel.json', 'version.json', '.DS_Store', '.gitignore', 'oauth-consent.html']);
// api/ = funciones del servidor (MCP, 1.6.0): no son parte de la app sin conexión
const EXCLUDE_DIRS = new Set(['.vercel', 'api']);

// Recursos externos fijados por versión: solo el modelo de FaceLandmarker (Google, Apache-2.0). No se pudo
// descargar desde el entorno de desarrollo para calcular su sha256: se guarda tal cual lo entrega Google en su
// URL versionada (float16/1). Las bibliotecas y el WASM de MediaPipe están en web/vendor (con sha256).
export const REMOTE = [
    { url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', sha256: null }
];

function walk(dir, base = '') {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const rel = base ? `${base}/${name}` : name;
        const st = fs.statSync(full);
        if (st.isDirectory()) { if (!EXCLUDE_DIRS.has(name)) out.push(...walk(full, rel)); }
        else if (!EXCLUDE.has(name) && !(base === '' && name.endsWith('.md'))) out.push(rel);
    }
    return out;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function buildManifest() {
    const files = walk(WEB).map(rel => {
        const buf = fs.readFileSync(path.join(WEB, rel));
        return { url: '/' + rel, sha256: sha(buf), bytes: buf.length };
    });
    const remote = REMOTE.map(r => ({ url: r.url, sha256: r.sha256 }));
    const version = sha(JSON.stringify({ app: APP_VERSION, files: files.map(f => [f.url, f.sha256]), remote })).slice(0, 12);
    return { schema: 1, version, appVersion: APP_VERSION, files, remote, totalBytes: files.reduce((a, f) => a + f.bytes, 0) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    // Versión que CORRE (va dentro del código cacheado por el Service Worker); version.json dice la publicada.
    const BUILD_INFO = path.join(WEB, 'js/build-info.js');
    const buildInfoText = `// Generado por tools/build-offline-manifest.mjs (no editar a mano)\nexport const APP_VERSION = '${APP_VERSION}';\n`;
    if (!process.argv.includes('--check')) fs.writeFileSync(BUILD_INFO, buildInfoText);
    else if (!fs.existsSync(BUILD_INFO) || fs.readFileSync(BUILD_INFO, 'utf8') !== buildInfoText) { console.error('web/js/build-info.js desactualizado: correr node tools/build-offline-manifest.mjs'); process.exit(1); }
    const m = buildManifest();
    const text = JSON.stringify(m, null, 1) + '\n';
    // M08: identificador de entrega = hash del contenido publicado (no un commit que podría no describir los archivos)
    const VERSION_FILE = path.join(WEB, 'version.json');
    const versionText = JSON.stringify({ app: m.appVersion, version: m.version, files: m.files.length, note: 'app = versión visible (package.json). version = hash del contenido de web/: describe exactamente los archivos publicados.' }, null, 2) + '\n';
    if (process.argv.includes('--check')) {
        const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
        const curV = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8') : '';
        if (cur !== text || curV !== versionText) { console.error('offline-manifest.json o version.json desactualizados: correr node tools/build-offline-manifest.mjs'); process.exit(1); }
        console.log(`offline-manifest.json al día (versión ${m.version}, ${m.files.length} archivos)`);
    } else {
        fs.writeFileSync(OUT, text);
        fs.writeFileSync(VERSION_FILE, versionText);
        console.log(`offline-manifest.json: versión ${m.version}, ${m.files.length} archivos locales (${(m.totalBytes / 1e6).toFixed(1)} MB) + ${m.remote.length} externos`);
    }
}
