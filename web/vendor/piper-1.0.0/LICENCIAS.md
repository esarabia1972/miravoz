# Voz natural (Piper) — componentes y licencias

Estos archivos se descargan solo si se elige una voz natural en Configuración (no forman parte de la preparación
sin conexión básica). Todo corre en el dispositivo: el texto nunca sale a internet.

| Archivo | Origen | Licencia |
|---|---|---|
| `ort.wasm.min.mjs`, `ort-wasm-simd.wasm` | ONNX Runtime Web 1.18.0 (Microsoft) — https://github.com/microsoft/onnxruntime | MIT |
| `piper-phonemize.mjs` | Envoltorio ESM de `@mintplex-labs/piper-tts-web` 1.0.5 — https://github.com/Mintplex-Labs/piper-tts-web | MIT |
| `piper_phonemize.wasm`, `piper_phonemize.data` | `@diffusionstudio/piper-wasm` 1.0.0, compilado de piper-phonemize (https://github.com/rhasspy/piper-phonemize, MIT) con eSpeak NG | eSpeak NG: GPL-3.0 — código fuente: https://github.com/espeak-ng/espeak-ng |

Voces (se bajan de https://huggingface.co/rhasspy/piper-voices, modelos con licencia MIT):

- `es_AR-daniela-high` — datos de entrenamiento: "Crowdsourced high-quality Argentinian Spanish speech data set"
  (Google, https://www.openslr.org/61/), CC BY-SA 4.0. Entrenada por larcanio.
- `es_MX-ald-medium` — datos: "Ald Mexican Spanish speech dataset" (rmcpantoja), dominio público (Unlicense). Ajustada desde la voz davefx.
