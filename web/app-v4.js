// --- Configuración de Supabase ---
const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

// Initialize Supabase Client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

// Referencias a UI de Auth
const authView = document.getElementById('auth-view');
const homeView = document.getElementById('home-view');
const authStepEmail = document.getElementById('auth-step-email');
const authStepOtp = document.getElementById('auth-step-otp');
const authLoading = document.getElementById('auth-loading');
const inputEmail = document.getElementById('auth-email-input');
const inputOtp = document.getElementById('auth-otp-input');
const btnSendOtp = document.getElementById('btn-send-otp');
const btnVerifyOtp = document.getElementById('btn-verify-otp');
const btnBackEmail = document.getElementById('btn-back-email');
const lblOtpEmail = document.getElementById('lbl-otp-email');
const btnLogout = document.querySelector('.btn-logout');
const userNameDisplay = document.querySelector('.user-name');
const userAvatarDisplay = document.querySelector('.user-avatar');

// --- Lógica de Autenticación (Supabase) ---
async function checkSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    handleAuthChange(session);
}

function handleAuthChange(session) {
    // --- BYPASS LOGIN (MVP LOCAL MODE) ---
    currentUser = { id: "local-user", email: "invitado@miravoz.local" };
    authView.style.display = 'none';
    homeView.style.display = 'block';
    topBar.style.display = 'flex';
    bottomBar.style.display = 'flex';
    
    userNameDisplay.innerText = "Usuario Local"; 
    userAvatarDisplay.textContent = "IN";
    
    (async () => {
        await loadCalibrationProfiles();
        loadSavedBoards(); // Forzar carga local ya que no hay sync
    })();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    handleAuthChange(session);
});

// Enviar OTP
btnSendOtp.addEventListener('click', async () => {
    const email = inputEmail.value.trim();
    if (!email) {
        customAlert("Por favor ingresa un correo electrónico.");
        return;
    }
    
    authStepEmail.style.display = 'none';
    authLoading.style.display = 'block';
    
    const { data, error } = await supabaseClient.auth.signInWithOtp({
        email: email,
        options: {
            shouldCreateUser: true // Permitir creación automática por ahora para facilitar el registro inicial
        }
    });
    
    authLoading.style.display = 'none';
    
    if (error) {
        authStepEmail.style.display = 'block';
        if (error.message.includes("Signups not allowed") || error.message.includes("User not found")) {
            customAlert("Este correo no está registrado en el sistema. Contacta al administrador.");
        } else {
            customAlert("Error al enviar código: " + error.message);
        }
    } else {
        lblOtpEmail.innerText = email;
        authStepOtp.style.display = 'block';
    }
});

// Volver a pedir email
btnBackEmail.addEventListener('click', () => {
    authStepOtp.style.display = 'none';
    authStepEmail.style.display = 'block';
    inputOtp.value = '';
});

// Verificar OTP
btnVerifyOtp.addEventListener('click', async () => {
    const email = inputEmail.value.trim();
    const token = inputOtp.value.trim();
    
    if (token.length !== 6) {
        customAlert("El código debe tener 6 dígitos.");
        return;
    }
    
    authStepOtp.style.display = 'none';
    authLoading.style.display = 'block';
    
    const { data, error } = await supabaseClient.auth.verifyOtp({
        email,
        token,
        type: 'magiclink' // En Supabase, OTP por email usa el tipo 'magiclink' o 'email'
    });
    
    authLoading.style.display = 'none';
    
    if (error) {
        authStepOtp.style.display = 'block';
        customAlert("Código inválido o expirado. Intenta nuevamente.");
    }
});

// Cerrar sesión
btnLogout.addEventListener('click', async (e) => {
    e.preventDefault();
    await supabaseClient.auth.signOut();
    window.location.reload();
});

// Sincronización en la nube
async function syncCloudData() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    try {
        console.log("Iniciando sincronización de tableros desde la nube...");
        showSyncToast("Descargando tableros...");
        const { data, error } = await supabaseClient.storage.from('boards').list(user.id);
        
        if (error) {
            console.error("Error al listar tableros desde Supabase:", error);
            hideSyncToast();
            return;
        }

        if (data && data.length > 0) {
            for (let file of data) {
                if (!file.name.endsWith('.json')) continue;
                const bundleId = file.name.replace('.json', '');
                
                // Evitamos volver a descargar si ya existe localmente
                const local = await localforage.getItem(bundleId);
                if (!local) {
                    const filePath = `${user.id}/${file.name}`;
                    const { data: fileData, error: downloadError } = await supabaseClient.storage.from('boards').download(filePath);
                    if (fileData) {
                        const text = await fileData.text();
                        try {
                            const bundle = JSON.parse(text);
                            await localforage.setItem(bundleId, bundle);
                        } catch(e) {
                            console.error("Error parseando tablero descargado", e);
                        }
                    }
                }
            }
        }
        loadSavedBoards();
        hideSyncToast();
    } catch (e) {
        console.error("Sync cloud error:", e);
        hideSyncToast();
    }
}

async function uploadBoardToSupabase(bundle) {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    try {
        showSyncToast("Guardando en la nube...");
        const filePath = `${user.id}/${bundle.id}.json`;
        const jsonContent = JSON.stringify(bundle);
        const { data, error } = await supabaseClient.storage.from('boards').upload(filePath, jsonContent, {
            contentType: 'application/json',
            upsert: true
        });
        if (error) {
            console.error("Error subiendo tablero a Supabase:", error);
        } else {
            console.log("Tablero subido a Supabase exitosamente.");
        }
        hideSyncToast();
    } catch (e) {
        console.error("Error uploadBoardToSupabase:", e);
        hideSyncToast();
    }
}

async function deleteBoardFromSupabase(bundleId) {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    try {
        showSyncToast("Borrando de la nube...");
        const filePath = `${user.id}/${bundleId}.json`;
        const { error } = await supabaseClient.storage.from('boards').remove([filePath]);
        if (error) {
            console.error("Error borrando tablero de Supabase:", error);
        } else {
            console.log("Tablero borrado de Supabase exitosamente.");
        }
        hideSyncToast();
    } catch (e) {
        console.error("Error deleteBoardFromSupabase:", e);
        hideSyncToast();
    }
}

// Inicializar
checkSession();

// --- Configuración ---
const CONFIG = {
    DWELL_MS: 1200,
    DWELL_COOLDOWN_MS: 800,
    COUNTDOWN_MS: 1500,
    SAMPLING_MS: 1000,
    HYSTERESIS_MS: 150
};

// --- Variables Globales ---
let state = "HOME"; // HOME, CALIBRATING_COUNTDOWN, CALIBRATING_SAMPLING, BOARD
let trackingMode = "CLICKS"; // OJOS, CARA, CLICKS
let isCalibrated = false;

// Estado de Gaze
let rawX = null;
let rawY = null;
let smoothGazeX = null;
let smoothGazeY = null;
let currentCell = null;
let dwellStartTime = 0;
let lastClickTime = 0;
let candidateCell = null;
let candidateSince = 0;
let activeHomeElements = [];

// Variables de Calibración
let currentPointIdx = 0;
let calibTimer = 0;
let calibDataX = [];

let calibTargetX = [];
let calibTargetY = [];
let weightX = [0, 0, 0];
let weightY = [0, 0, 0];

let calibrationProfiles = {
    "OJOS": null,
    "CARA": null
};

async function loadCalibrationProfiles() {
    try {
        const stored = await localforage.getItem('miravoz_calibration');
        if (stored) {
            calibrationProfiles = stored;
            console.log("Perfiles de calibración cargados:", calibrationProfiles);
        }
    } catch(e) {
        console.error("Error al cargar perfiles de calibración:", e);
    }
}

// Forzar la carga de voces asíncrona en Chrome
if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => {
        console.log("Voces TTS listas");
    };
}

// Variables del Tablero
let currentBundle = null;
let currentGridId = null;
let activeGridElements = []; 
let navigationHistory = [];
let sentenceAccumulator = [];

// DOM Elements
const videoElement = document.getElementById('input-video');
const canvasUI = document.getElementById('ui-layer');
const ctxUI = canvasUI.getContext('2d');

const topBar = document.getElementById('top-bar');
const bottomBar = document.getElementById('bottom-bar'); // Added
const boardView = document.getElementById('board-view');
const gridContainer = document.getElementById('grid-container');
const instructionBox = document.getElementById('instruction-box');
const boardList = document.getElementById('board-list');

const modeSelect = document.getElementById('mode-select');
const dwellSelect = document.getElementById('dwell-select');
const optOjos = document.getElementById('opt-ojos');

if (optOjos && new URLSearchParams(window.location.search).get('iris') !== '1') {
    optOjos.remove();
}

const savedDwell = localStorage.getItem('miravoz_dwell');
if (savedDwell) {
    CONFIG.DWELL_MS = parseInt(savedDwell, 10);
    if (dwellSelect) dwellSelect.value = savedDwell;
}

if (dwellSelect) {
    dwellSelect.addEventListener('change', (e) => {
        const newDwell = parseInt(e.target.value, 10);
        CONFIG.DWELL_MS = newDwell;
        localStorage.setItem('miravoz_dwell', newDwell.toString());
    });
}

const btnRecalibrar = document.getElementById('btn-recalibrar');
const btnIniciarCalibracion = document.getElementById('btn-iniciar-calibracion');

// Import elements
const fileImport = document.getElementById('file-import');
const importModal = document.getElementById('import-modal');
const btnOpenImport = document.getElementById('btn-open-import');
const btnCloseImport = document.getElementById('btn-close-import');
const btnTestBoard = document.getElementById('btn-test-board');
const searchInput = document.getElementById('board-search');

// DOM Elements Acumulador
const sentenceContainer = document.getElementById('sentence-container');
const btnAccHome = document.getElementById('btn-acc-home');
const btnAccBack = document.getElementById('btn-acc-back');
const btnAccPlay = document.getElementById('btn-acc-play');
const btnAccDelete = document.getElementById('btn-acc-delete');
const btnAccClear = document.getElementById('btn-acc-clear');

// --- Inicialización de Base de Datos Local ---
localforage.config({
    name: 'Miravoz',
    storeName: 'boards'
});

// --- Utilidades de Interfaz (Custom Modals) ---
function customAlert(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');
    
    msg.innerText = message;
    btnCancel.style.display = 'none';
    dialog.style.display = 'flex';
    
    return new Promise(resolve => {
        btnOk.onclick = () => {
            dialog.style.display = 'none';
            resolve();
        };
    });
}

function customConfirm(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');
    
    msg.innerText = message;
    btnCancel.style.display = 'inline-block';
    dialog.style.display = 'flex';
    
    return new Promise(resolve => {
        btnOk.onclick = () => {
            dialog.style.display = 'none';
            resolve(true);
        };
        btnCancel.onclick = () => {
            dialog.style.display = 'none';
            resolve(false);
        };
    });
}

function showSyncToast(message = "Sincronizando...") {
    const toast = document.getElementById('sync-toast');
    if (toast) {
        document.getElementById('sync-message').textContent = message;
        toast.style.display = 'flex';
    }
}

function hideSyncToast() {
    const toast = document.getElementById('sync-toast');
    if (toast) toast.style.display = 'none';
}

let isRenderingBoards = false;
async function loadSavedBoards() {
    if (isRenderingBoards) return;
    isRenderingBoards = true;
    try {
        const keys = await localforage.keys();
        boardList.innerHTML = '';
        
        if (keys.length === 0) {
            boardList.innerHTML = '<p style="color: #aaa;">No hay tableros guardados. Importa uno para comenzar.</p>';
            return;
        }
        
        currentCell = null;
        candidateCell = null;
        activeHomeElements = [];
        const fragment = document.createDocumentFragment();
        let boardCount = 0;
        for (let key of keys) {
            if (key === 'miravoz_calibration') continue;
            
            const bundle = await localforage.getItem(key);
            if (!bundle || !bundle.name) continue;
            
            boardCount++;
            const card = document.createElement('div');
            card.className = 'board-card glass-box'; // Added glass-box for masonry styling
            card.style.flexDirection = 'column'; // Adjust layout for grid
            card.style.alignItems = 'flex-start';
            card.style.gap = '15px';
            
            let previewText = "Sin opciones";
            let optionsCount = 0;
            if (bundle.boards && bundle.mainBoard && bundle.boards[bundle.mainBoard]) {
                const mainElements = bundle.boards[bundle.mainBoard].gridElements || [];
                optionsCount = mainElements.length;
                const labels = mainElements.map(e => e.label ? (e.label.es || e.label.en) : "").filter(Boolean).slice(0, 5);
                if (labels.length > 0) {
                    previewText = labels.join(', ') + (optionsCount > 5 ? '...' : '');
                }
            }
            
            // Add data-name for filtering
            card.setAttribute('data-name', bundle.name.toLowerCase());

            const infoDiv = document.createElement('div');
            const h3 = document.createElement('h3');
            h3.style.cssText = "margin:0; font-size:1.2rem; color:white;";
            h3.textContent = bundle.name;
            const pType = document.createElement('p');
            pType.style.cssText = "font-size:0.85rem; color:#aaa; margin:5px 0 0 0;";
            pType.textContent = `Tipo: ${(bundle.type || '').toUpperCase()} | Opciones: ${optionsCount}`;
            const pPrev = document.createElement('p');
            pPrev.style.cssText = "font-size:0.8rem; color:#888; margin:2px 0 0 0; font-style:italic;";
            pPrev.textContent = previewText;
            infoDiv.append(h3, pType, pPrev);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-card';
            deleteBtn.style.alignSelf = 'flex-end'; // Move button to bottom right
            deleteBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
            deleteBtn.className = 'btn-delete-card';
            
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await customConfirm(`¿Estás seguro de que quieres eliminar el tablero "${bundle.name}"?`);
                if (confirmed) {
                    await localforage.removeItem(key);
                    deleteBoardFromSupabase(key); // Async background delete
                    loadSavedBoards();
                }
            };
            
            card.appendChild(infoDiv);
            card.appendChild(deleteBtn);
            
            card.style.position = 'relative';
            card.style.overflow = 'hidden';
            
            // Barra de progreso para dwell
            const progress = document.createElement('div');
            progress.style.position = 'absolute';
            progress.style.bottom = '0';
            progress.style.left = '0';
            progress.style.height = '10px';
            progress.style.background = 'rgba(0, 255, 136, 0.5)';
            progress.style.width = '0%';
            progress.style.transition = 'width 0.1s linear';
            progress.className = 'progress-bar';
            card.appendChild(progress);
            
            card.onclick = () => openBundle(bundle);
            fragment.appendChild(card);
            
            activeHomeElements.push({ element: card, data: bundle, isBoardCard: true });
        }
        
        if (boardCount === 0) {
            boardList.innerHTML = '<p style="color: #aaa;">No hay tableros guardados. Importa uno para comenzar.</p>';
        } else {
            boardList.appendChild(fragment);
        }
    } finally {
        isRenderingBoards = false;
    }
}


// --- Importación de Archivos (AsTeRICS Grid) ---
fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'grd') {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                const firstGridId = json.grids[0].id;
                
                const bundle = {
                    id: 'bundle_' + Date.now(),
                    name: file.name.replace('.grd', ''),
                    type: 'grd',
                    importerVersion: 1,
                    mainBoard: firstGridId,
                    boards: {}
                };
                
                // Guardar todos los tableros dentro del GRD
                json.grids.forEach(g => {
                    bundle.boards[g.id] = g;
                });
                
                // Inteligencia para inferir el tablero raíz en GRD multipágina
                if (Object.keys(bundle.boards).length > 1) {
                    const referencedBoards = new Set();
                    Object.values(bundle.boards).forEach(board => {
                        if (board.gridElements) {
                            board.gridElements.forEach(el => {
                                if (el.actions) {
                                    el.actions.forEach(action => {
                                        // En el raw JSON de GRD, las acciones de navegación tienen modelName y toGridId
                                        if ((action.navType === 'navigateToGrid' || action.modelName === 'GridActionNavigate') && action.toGridId) {
                                            referencedBoards.add(action.toGridId);
                                        }
                                    });
                                }
                            });
                        }
                    });
                    
                    const unreferenced = Object.keys(bundle.boards).filter(id => !referencedBoards.has(id));
                    if (unreferenced.length === 1) {
                        bundle.mainBoard = unreferenced[0];
                    } else if (unreferenced.length > 1) {
                        const normalizedBundleName = bundle.name.toLowerCase();
                        let bestMatch = unreferenced.find(id => {
                            let boardName = bundle.boards[id].name || "";
                            if (!boardName && bundle.boards[id].label) {
                                boardName = bundle.boards[id].label.es || bundle.boards[id].label.en || "";
                            }
                            return typeof boardName === 'string' && boardName.toLowerCase().includes(normalizedBundleName);
                        });
                        
                        if (bestMatch) {
                            bundle.mainBoard = bestMatch;
                        } else {
                            bundle.mainBoard = unreferenced[0];
                        }
                    }
                }
                
                await localforage.setItem(bundle.id, bundle);
                uploadBoardToSupabase(bundle); // Background async upload
                loadSavedBoards();
                importModal.style.display = 'none';
                customAlert("¡Tablero .grd importado exitosamente!");
            } catch (err) {
                console.error("Error importando GRD:", err);
                customAlert("Hubo un error importando el GRD: " + err.message);
            }
        
    } else if (ext === 'obz') {
        try {
            const buffer = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(buffer);
            
            // Buscar manifest
            const manifestFile = zip.file('manifest.json');
            if (!manifestFile) {
                customAlert("El archivo .obz no tiene un manifest.json válido.");
                return;
            }
            const manifestText = await manifestFile.async('text');
            const manifest = JSON.parse(manifestText);
            
            // Encontrar el tablero raíz inicial (puede ser sobrescrito por el algoritmo inteligente luego)
            let rootBoardId = manifest.root;
            if (!rootBoardId && manifest.paths && manifest.paths.boards) {
                rootBoardId = Object.keys(manifest.paths.boards)[0];
            }
            
            const bundle = {
                id: 'bundle_' + Date.now(),
                name: file.name.replace('.obz', ''),
                type: 'obz',
                importerVersion: 1,
                mainBoard: rootBoardId,
                boards: {}
            };
            
            // Extraer imágenes y convertirlas a Base64
            const imageMap = {};
            const imgPromises = [];
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && /\.(png|jpe?g|gif|svg|webp)$/i.test(relativePath)) {
                    imgPromises.push((async function() {
                        const blob = await zipEntry.async('blob');
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                // Guardar con la ruta relativa tal como aparece en img.url/img.path
                                imageMap[relativePath] = reader.result;
                                resolve();
                            };
                            reader.readAsDataURL(blob);
                        });
                    })());
                }
            });
            await Promise.all(imgPromises);
            
            // Extraer todos los .obf en la carpeta boards/
            const folder = zip.folder('boards');
            const filePromises = [];
            folder.forEach((relativePath, zipEntry) => {
                if (zipEntry.name.endsWith('.obf')) {
                    filePromises.push(async function() {
                        const obfText = await zipEntry.async('text');
                        const obfJson = JSON.parse(obfText);
                        
                        // Normalizar formato OBF a formato GRD
                        const rows = obfJson.grid.rows || 3;
                        const cols = obfJson.grid.columns || 4;
                        const gridElements = [];
                        const processed = new Set();
                        for (let y = 0; y < rows; y++) {
                            for (let x = 0; x < cols; x++) {
                                if (processed.has(`${x},${y}`)) continue;
                                
                                const btnId = obfJson.grid.order[y][x];
                                if (btnId) {
                                    // Calcular width por repetición de btnId en la misma fila
                                    let w = 1;
                                    while (x + w < cols && obfJson.grid.order[y][x + w] === btnId) {
                                        w++;
                                    }
                                    
                                    // Calcular height comprobando si la fila entera de 'w' columnas se repite abajo
                                    let h = 1;
                                    let canExpandHeight = true;
                                    while (y + h < rows && canExpandHeight) {
                                        for (let ix = 0; ix < w; ix++) {
                                            if (obfJson.grid.order[y + h][x + ix] !== btnId) {
                                                canExpandHeight = false;
                                                break;
                                            }
                                        }
                                        if (canExpandHeight) h++;
                                    }
                                    
                                    // Marcar las celdas como procesadas
                                    for (let iy = 0; iy < h; iy++) {
                                        for (let ix = 0; ix < w; ix++) {
                                            processed.add(`${x + ix},${y + iy}`);
                                        }
                                    }
                                    
                                    const btn = obfJson.buttons.find(b => b.id === btnId);
                                    if (btn) {
                                        const img = obfJson.images ? obfJson.images.find(i => i.id === btn.image_id) : null;
                                        let finalUrl = null;
                                        if (img) {
                                            let localPath = img.path || img.url;
                                            if (localPath && imageMap[localPath]) {
                                                finalUrl = imageMap[localPath];
                                            } else {
                                                let cleanPath = localPath ? localPath.replace(/^\.\//, '') : null;
                                                if (cleanPath && imageMap[cleanPath]) {
                                                    finalUrl = imageMap[cleanPath];
                                                } else if (img.url && (img.url.startsWith('http') || img.url.startsWith('data:'))) {
                                                    finalUrl = img.url;
                                                }
                                            }
                                        }
                                        const actions = [];
                                        if (btn.load_board) {
                                            let pathStr = typeof btn.load_board === 'string' ? btn.load_board : (btn.load_board.path || btn.load_board.id);
                                            if (pathStr) {
                                                const toId = pathStr.split('/').pop().replace('.obf', '');
                                                actions.push({ navType: 'navigateToGrid', toGridId: toId });
                                            }
                                        }
                                        let parsedBg = null;
                                        if (Array.isArray(btn.background_color)) {
                                            parsedBg = `rgb(${btn.background_color[0]}, ${btn.background_color[1]}, ${btn.background_color[2]})`;
                                        } else if (typeof btn.background_color === 'string') {
                                            parsedBg = btn.background_color;
                                        }

                                        const elData = {
                                            x: x,
                                            y: y,
                                            width: w,
                                            height: h,
                                            label: { es: btn.label, en: btn.label },
                                            backgroundColor: parsedBg,
                                            actions: actions
                                        };
                                        if (finalUrl) {
                                            elData.image = { url: finalUrl };
                                        }
                                        gridElements.push(elData);
                                    }
                                } else {
                                    processed.add(`${x},${y}`);
                                }
                            }
                        }
                        
                        const normalizedGrd = {
                            id: obfJson.id,
                            name: obfJson.name,
                            rowCount: rows,
                            minColumnCount: cols,
                            gridElements: gridElements
                        };
                        
                        bundle.boards[obfJson.id] = normalizedGrd;
                    }());
                }
            });
            
            await Promise.all(filePromises);
            
            // Inteligencia para inferir el tablero raíz si no viene declarado en el manifest.json
            if (!manifest.root && Object.keys(bundle.boards).length > 1) {
                const referencedBoards = new Set();
                Object.values(bundle.boards).forEach(board => {
                    if (board.gridElements) {
                        board.gridElements.forEach(el => {
                            if (el.actions) {
                                el.actions.forEach(action => {
                                    if (action.navType === 'navigateToGrid') {
                                        referencedBoards.add(action.toGridId);
                                    }
                                });
                            }
                        });
                    }
                });
                
                const unreferenced = Object.keys(bundle.boards).filter(id => !referencedBoards.has(id));
                if (unreferenced.length === 1) {
                    bundle.mainBoard = unreferenced[0];
                } else if (unreferenced.length > 1) {
                    const normalizedBundleName = bundle.name.toLowerCase();
                    // Buscar un tablero cuyo nombre interno de OBF contenga el nombre del archivo OBZ
                    let bestMatch = unreferenced.find(id => {
                        let boardName = bundle.boards[id].name || "";
                        if (!boardName && bundle.boards[id].label) {
                            boardName = bundle.boards[id].label.es || bundle.boards[id].label.en || "";
                        }
                        return typeof boardName === 'string' && boardName.toLowerCase().includes(normalizedBundleName);
                    });
                    
                    if (bestMatch) {
                        bundle.mainBoard = bestMatch;
                    } else {
                        bundle.mainBoard = unreferenced[0];
                    }
                }
            }

            await localforage.setItem(bundle.id, bundle);
            uploadBoardToSupabase(bundle); // Background async upload
            loadSavedBoards();
            importModal.style.display = 'none';
            customAlert("¡Tablero .obz importado exitosamente!");
        } catch(err) {
            console.error("Error importando OBZ:", err);
            customAlert("Hubo un error importando el OBZ: " + err.message);
        }
    }
    
    fileImport.value = ''; // Reset
});

btnOpenImport.addEventListener('click', () => {
    importModal.style.display = 'flex';
});

btnCloseImport.addEventListener('click', () => {
    importModal.style.display = 'none';
});

btnTestBoard.addEventListener('click', () => {
    const testElements = [];
    for (let i = 1; i <= 9; i++) {
        testElements.push({
            x: (i - 1) % 3,
            y: Math.floor((i - 1) / 3),
            label: { es: i.toString() },
            image: null,
            actions: []
        });
    }
    
    const testBundle = {
        id: 'test_board_123',
        name: 'Tablero de Prueba (1 al 9)',
        type: 'test',
        mainBoard: 'main',
        boards: {
            'main': {
                id: 'main',
                rowCount: 3,
                minColumnCount: 3,
                gridElements: testElements
            }
        }
    };
    
    openBundle(testBundle);
});

// Search filter
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.board-card');
        
        cards.forEach(card => {
            const name = card.getAttribute('data-name') || "";
            if (name.includes(query)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    });
}

// --- Lógica del Acumulador y Navegación ---
function renderSentence() {
    sentenceContainer.innerHTML = '';
    sentenceAccumulator.forEach(item => {
        const el = document.createElement('div');
        el.className = 'sentence-item';
        
        let bgColor = '#fff';
        if (item.elData) {
            const data = item.elData;
            const labelStr = typeof data.label === 'string' ? data.label : (data.label ? (data.label.es || data.label.en) : "");
            const autoColor = data.colorCategory ? getCategoryColor(data.colorCategory) : (labelStr ? getAutoColor(labelStr) : null);
            bgColor = data.backgroundColor || autoColor || '#fff';
        }
        el.style.setProperty('background-color', bgColor, 'important');

        if (item.imageUrl) {
            const img = document.createElement('img');
            img.src = item.imageUrl;
            el.appendChild(img);
        } else if (item.text) {
            const span = document.createElement('span');
            span.textContent = item.text;
            el.appendChild(span);
        }
        sentenceContainer.appendChild(el);
    });
    sentenceContainer.scrollLeft = sentenceContainer.scrollWidth;
}

btnAccHome.addEventListener('click', () => {
    // Navigate back to Home view (Mis Tableros)
    state = "HOME";
    currentBundle = null;
    boardView.style.display = 'none';
    homeView.style.display = 'flex';
    topBar.style.display = 'flex';
    bottomBar.style.display = 'flex';
    instructionBox.style.display = 'none';
    ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
});

btnAccBack.addEventListener('click', () => {
    if (navigationHistory.length > 0) {
        const prevId = navigationHistory.pop();
        renderGrid(prevId);
    }
});

btnAccPlay.addEventListener('click', () => {
    if (sentenceAccumulator.length === 0) return;
    btnAccPlay.classList.add('active');
    setTimeout(() => btnAccPlay.classList.remove('active'), 200);

    const fullText = sentenceAccumulator.map(i => i.text).join(', ');
    speak(fullText);
});

btnAccDelete.addEventListener('click', () => {
    btnAccDelete.classList.add('active');
    setTimeout(() => btnAccDelete.classList.remove('active'), 200);

    if (sentenceAccumulator.length > 0) {
        sentenceAccumulator.pop();
        renderSentence();
    }
});

btnAccClear.addEventListener('click', () => {
    btnAccClear.classList.add('active');
    setTimeout(() => btnAccClear.classList.remove('active'), 200);

    sentenceAccumulator = [];
    renderSentence();
});


// --- Lógica del Tablero Dinámico ---
function openBundle(bundle) {
    try {
        if (!bundle.importerVersion || bundle.importerVersion < 1) {
            customAlert("Este tablero fue importado con una versión anterior — reimportalo para corregir posibles errores de imágenes y navegación.");
        }
        currentBundle = bundle;
        navigationHistory = [];
        sentenceAccumulator = [];
        renderSentence();
        
        homeView.style.display = 'none';
        topBar.style.display = 'none';
        bottomBar.style.display = 'none';
        boardView.style.display = 'flex';
        
        renderGrid(bundle.mainBoard);
        
        if (trackingMode !== "CLICKS") {
            if (!isCalibrated) {
                startCalibration();
            } else {
                state = "BOARD";
            }
        } else {
            state = "BOARD";
        }
    } catch(err) {
        console.error("Error en openBundle:", err);
        customAlert("Error al intentar abrir el tablero: " + err.message);
    }
}

// btnVolverInicio logic removed, now handled by btnAccHome

function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    
    const voices = speechSynthesis.getVoices();
    const spanishVoices = voices.filter(v => v.lang.startsWith('es'));
    
    if (spanishVoices.length > 0) {
        // Buscar preferentemente voces femeninas de alta calidad y que sean explícitamente en español
        let preferredVoice = spanishVoices.find(v => 
            v.name.includes('Google español') ||
            v.name.includes('Google Español') ||
            v.name.includes('Paulina') || 
            v.name.includes('Mónica') || 
            v.name.includes('Luciana') ||
            v.name.includes('Elena')
        );
        
        // Si no encuentra la preferida, usa la primera voz en español que encuentre
        if (!preferredVoice) {
            preferredVoice = spanishVoices[0];
        }
        
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
    }
    
    speechSynthesis.speak(utterance);
}

function handleCellClick(cellElement, elementData) {
    // Evitar doble clicks rápidos
    const now = performance.now();
    if (now - lastClickTime < 500) return;
    lastClickTime = now;
    
    // Efecto visual
    cellElement.style.transform = 'scale(0.95)';
    setTimeout(() => cellElement.style.transform = '', 150);

    let hasNavigation = false;

    // Check navigation
    if (elementData.actions) {
        for (const action of elementData.actions) {
            if ((action.navType === 'navigateToGrid' || action.modelName === 'GridActionNavigate') && action.toGridId) {
                hasNavigation = true;
                setTimeout(() => {
                    navigationHistory.push(currentGridId);
                    renderGrid(action.toGridId);
                }, 100);
            }
        }
    }

    // Si NO es botón de navegación, es una palabra
    if (!hasNavigation) {
        const text = elementData.label ? (elementData.label.es || elementData.label.en) : "";
        if (text) {
            console.log("Hablando:", text);
            speak(text);
            
            // Añadir al acumulador
            sentenceAccumulator.push({
                text: text,
                imageUrl: elementData.image ? (elementData.image.data || elementData.image.url) : null,
                elData: elementData
            });
            // Sin límite de tamaño

            renderSentence();
        }
    }
}

function getCategoryColor(category) {
    if (!category) return null;
    const colors = {
        'CC_PRONOUN_PERSON_NAME': '#fff176',
        'CC_VERB': '#81c784',
        'CC_DESCRIPTOR': '#64b5f6',
        'CC_NOUN': '#ffb74d',
        'CC_IMPORTANT': '#ff8a80',
        'CC_SOCIAL_EXPRESSIONS': '#f48fb1',
        'CC_PLACE': '#ba68c8',
        'CC_OTHERS': '#9e9e9e'
    };
    return colors[category] || null;
}

function getAutoColor(label) {
    if (!label) return null;
    const l = label.trim().toUpperCase();
    if (["YO", "TÚ", "PERSONAS"].includes(l)) return "#fff176"; // Yellow
    if (["QUIERO", "VERBOS"].includes(l)) return "#81c784"; // Green
    if (["SÍ", "NO", "BIEN", "MAL"].includes(l)) return "#64b5f6"; // Blue
    if (["BAÑO", "ME GUSTA", "NO ME GUSTA", "HABLAR CON", "AYUDA", "DAME", "DESCANSO", "VOLVER", "EXPRESIONES", "SOBRE MÍ", "PARAR", "QUIERO IR AL BAÑO", "ME ENCUENTRO MAL", "ME ESTOY MAREANDO", "QUIERO DESCANSAR", "TENGO CALOR", "TENGO FRÍO", "TENGO HAMBRE", "TENGO SED", "ESTÁ ROTO", "NO ENTIENDO", "NO SÉ QUÉ PASA", "HAY MUCHO RUIDO"].includes(l)) return "#ff8a80"; // Pink
    if (["COMIDA", "BEBIDA", "ROPA", "LUGARES", "TRANSPORTES", "CASA", "COLEGIO", "OBJETOS", "APARATOS", "JUGUETES", "CLIMA", "COLORES", "CUERPO", "ESTADOS", "ASEO", "TIEMPO", "FORMAS", "ANIMALES", "DEPORTES", "OCIO", "FIESTAS", "CONCEPTOS", "DESCRIPCIÓN", "PLANTAS"].includes(l)) return "#ffb74d"; // Orange
    if (["CORE 50"].includes(l)) return "#ba68c8"; // Purple
    if (["NÚMEROS", "PALABRAS", "TECLADO", "RADIO", "YOUTUBE"].includes(l)) return "#9e9e9e"; // Gray
    return null;
}

function renderGrid(gridId) {
    if (!currentBundle || !currentBundle.boards[gridId]) {
        console.error("No se encontró el grid:", gridId);
        return;
    }
    
    currentGridId = gridId;
    const gridData = currentBundle.boards[gridId];
    gridContainer.innerHTML = ''; // Limpiar grilla anterior
    activeGridElements = [];
    
    const rows = gridData.rowCount || 3;
    const cols = gridData.minColumnCount || 4;
    
    // Dynamic gap based on column density
    if (cols > 8) {
        gridContainer.style.gap = '4px';
        gridContainer.style.padding = '5px 10px';
        gridContainer.classList.add('dense-grid');
    } else {
        gridContainer.style.gap = '15px';
        gridContainer.style.padding = '10px 30px';
        gridContainer.classList.remove('dense-grid');
    }
    
    gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    
    // Crear una matriz vacía para rellenar huecos si es necesario
    const cellsMatrix = Array(rows).fill(null).map(() => Array(cols).fill(null));
    
    if (gridData.gridElements) {
        gridData.gridElements.forEach(el => {
            if (el.y < rows && el.x < cols) {
                cellsMatrix[el.y][el.x] = el;
            }
        });
    }
    
    const renderedCells = new Set();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (renderedCells.has(`${x},${y}`)) continue;

            const elData = cellsMatrix[y][x];
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            const w = elData && elData.width ? elData.width : 1;
            const h = elData && elData.height ? elData.height : 1;
            
            if (elData) {
                for (let iy = 0; iy < h; iy++) {
                    for (let ix = 0; ix < w; ix++) {
                        renderedCells.add(`${x + ix},${y + iy}`);
                    }
                }
            } else {
                renderedCells.add(`${x},${y}`);
            }

            // Asignar posición explícita en CSS Grid
            cell.style.gridColumn = `${x + 1} / span ${w}`;
            cell.style.gridRow = `${y + 1} / span ${h}`;
            
            if (elData && !elData.hidden) {
                cell.id = `cell-${x}-${y}`;
                
                // Color de fondo si existe o auto-color por categoría
                const labelStr = typeof elData.label === 'string' ? elData.label : (elData.label ? (elData.label.es || elData.label.en) : "");
                const autoColor = elData.colorCategory ? getCategoryColor(elData.colorCategory) : (labelStr ? getAutoColor(labelStr) : null);
                const finalBgColor = elData.backgroundColor || autoColor;

                if (finalBgColor) {
                    // Aplicamos directamente el backgroundColor con !important para sobreescribir CSS
                    cell.style.setProperty('background-color', finalBgColor, 'important');
                    cell.style.opacity = '0.9';
                    // Si es auto-color, forzar texto negro para asegurar legibilidad como en Asterics
                    if (autoColor && !elData.textColor) {
                        elData.textColor = "#000000";
                    }
                }
                
                // Color de borde si existe
                if (elData.borderColor) {
                    cell.style.borderColor = elData.borderColor;
                    cell.style.borderWidth = '3px';
                }
                
                // Imagen
                if (elData.image) {
                    const img = document.createElement('img');
                    img.className = 'picto-img';
                    let imgSrc = elData.image.data || elData.image.url;
                    if (imgSrc && !imgSrc.startsWith('data:') && !imgSrc.startsWith('http') && !imgSrc.startsWith('./')) {
                        imgSrc = 'data:' + (elData.image.contentType || 'image/jpeg') + ';base64,' + imgSrc;
                    }
                    img.src = imgSrc;
                    img.alt = elData.label ? (elData.label.es || "") : "";
                    cell.appendChild(img);
                }
                
                // Texto
                if (elData.label) {
                    const label = document.createElement('div');
                    label.className = 'picto-label';
                    label.innerText = elData.label.es || elData.label.en || "";
                    if (elData.textColor) {
                        label.style.color = elData.textColor;
                    }
                    cell.appendChild(label);
                }
                
                // Progress Bar (para tracking ocular)
                const progress = document.createElement('div');
                progress.className = 'progress-bar';
                cell.appendChild(progress);
                
                // Evento Click físico
                cell.onclick = () => handleCellClick(cell, elData);
                
                activeGridElements.push({ element: cell, data: elData, isAccBtn: false });
            } else {
                cell.classList.add('empty-cell');
            }
            
            gridContainer.appendChild(cell);
        }
    }
    
    // Add accumulator buttons to active grid elements for Dwell control
    const accBtns = document.querySelectorAll('.btn-acc');
    accBtns.forEach(btn => {
        // Add progress bar if it doesn't exist
        if (!btn.querySelector('.progress-bar')) {
            const progress = document.createElement('div');
            progress.className = 'progress-bar';
            btn.appendChild(progress);
            btn.style.position = 'relative';
            btn.style.overflow = 'hidden';
        }
        activeGridElements.push({ element: btn, data: null, isAccBtn: true });
    });
}

// --- Tracking Ocular (Dwell) ---
function handleGazeInteraction(x, y) {
    if ((state !== "BOARD" && state !== "HOME") || trackingMode === "CLICKS") return;
    
    let hoveredCellObj = null;
    const elementsToCheck = (state === "HOME") ? activeHomeElements : activeGridElements;
    for (const obj of elementsToCheck) {
        const rect = obj.element.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            hoveredCellObj = obj;
            break;
        }
    }

    const now = performance.now();
    
    if (hoveredCellObj !== currentCell) {
        if (hoveredCellObj !== candidateCell) {
            candidateCell = hoveredCellObj;
            candidateSince = now;
        }
        if (now - candidateSince > CONFIG.HYSTERESIS_MS) {
            // Soltar currentCell
            if (currentCell) {
                currentCell.element.classList.remove('active', 'clicked');
                const bar = currentCell.element.querySelector('.progress-bar');
                if (bar) bar.style.width = `0%`;
            }
            // Adoptar candidateCell
            currentCell = candidateCell;
            if (currentCell) {
                currentCell.element.classList.add('active');
                dwellStartTime = now;
            }
        }
    } else {
        candidateCell = null;
    }

    if (currentCell) {
        if (now - lastClickTime <= CONFIG.DWELL_COOLDOWN_MS) {
            // Mientras esté en cooldown, no acumula progreso
            dwellStartTime = now;
            const bar = currentCell.element.querySelector('.progress-bar');
            if (bar) bar.style.width = `0%`;
        } else {
            const dwellTime = now - dwellStartTime;
            if (dwellTime >= CONFIG.DWELL_MS) {
                currentCell.element.classList.add('clicked');
                if (currentCell.isBoardCard) {
                    openBundle(currentCell.data);
                } else if (currentCell.isAccBtn) {
                    currentCell.element.click();
                } else {
                    handleCellClick(currentCell.element, currentCell.data);
                }
                dwellStartTime = now; // reset
                const bar = currentCell.element.querySelector('.progress-bar');
                if (bar) bar.style.width = `0%`;
                lastClickTime = performance.now();
            } else {
                const bar = currentCell.element.querySelector('.progress-bar');
                if (bar) bar.style.width = `${(dwellTime / CONFIG.DWELL_MS) * 100}%`;
            }
        }
    }
}


// --- Eventos de Selector de Modo y Calibración ---
modeSelect.addEventListener('change', (e) => {
    const newMode = e.target.value;
    trackingMode = newMode;
    const dwellContainer = document.getElementById('dwell-container');
    
    if (trackingMode === "CLICKS") {
        if (dwellContainer) dwellContainer.style.display = 'none';
        isCalibrated = false;
        // Apagar cámara si existe
        if (camera) {
            camera.stop();
            isMediaPipeRunning = false;
        }
        ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
        instructionBox.style.display = 'none';
        
        if (currentBundle) {
            state = "BOARD";
            boardView.style.display = 'flex';
        } else {
            state = "HOME";
            homeView.style.display = 'flex';
        }
        
    } else {
        if (dwellContainer) dwellContainer.style.display = '';
        // OJOS o CARA
        startMediaPipe();
        
        // Verificar si hay calibración guardada
        if (calibrationProfiles && calibrationProfiles[trackingMode]) {
            weightX = calibrationProfiles[trackingMode].weightX;
            weightY = calibrationProfiles[trackingMode].weightY;
            isCalibrated = true;
            console.log(`Calibración cargada para ${trackingMode}`);
        } else {
            isCalibrated = false;
            // Se debe iniciar calibración para este modo
            startCalibration();
        }
    }
});

btnRecalibrar.addEventListener('click', () => {
    if (trackingMode === "OJOS" || trackingMode === "CARA") {
        if (calibrationProfiles) {
            calibrationProfiles[trackingMode] = null;
            localforage.setItem('miravoz_calibration', calibrationProfiles);
        }
        startCalibration();
    } else {
        customAlert("La calibración no es necesaria en el Modo Manual (Clicks).");
    }
});

btnIniciarCalibracion.addEventListener('click', () => {
    state = "CALIBRATING_COUNTDOWN";
    instructionBox.style.display = 'none';
    currentPointIdx = 0;
    calibDataX = [];
    calibTargetX = [];
    calibTargetY = [];
    calibTimer = performance.now();
});

// --- Kalman Filter ---
class KalmanFilter {
    constructor(q, r, p, initial_value) {
        this.q = q; this.r = r; this.p = p; this.x = initial_value;
    }
    update(measurement) {
        this.p = this.p + this.q;
        let k = this.p / (this.p + this.r);
        this.x = this.x + k * (measurement - this.x);
        this.p = (1 - k) * this.p;
        return this.x;
    }
    reset() {
        this.x = null;
        this.p = 1;
    }
}
const kfX = new KalmanFilter(0.005, 0.5, 1, 0);
const kfY = new KalmanFilter(0.005, 0.5, 1, 0);

// --- Puntos de Calibración ---
let calibPoints = [];
function updateCalibPoints() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const marginX = w * 0.15;
    const marginY = h * 0.15;
    const cx = w / 2;
    const cy = h / 2;
    
    calibPoints = [
        [marginX, marginY], [cx, marginY], [w - marginX, marginY],
        [marginX, cy],      [cx, cy],      [w - marginX, cy],
        [marginX, h - marginY], [cx, h - marginY], [w - marginX, h - marginY]
    ];
}
updateCalibPoints();
window.addEventListener('resize', () => {
    canvasUI.width = window.innerWidth;
    canvasUI.height = window.innerHeight;
    updateCalibPoints();
});
canvasUI.width = window.innerWidth;
canvasUI.height = window.innerHeight;

// --- Funciones del Motor ---
function startCalibration() {
    if (trackingMode === "CLICKS") return;
    
    updateCalibPoints();
    calibDataX = [];
    calibTargetX = [];
    calibTargetY = [];
    currentPointIdx = 0;
    state = "CALIBRATING_PENDING"; // Esperando que el usuario haga clic en el boton
    
    boardView.style.opacity = '0'; // Ocultar grilla temporalmente
    setTimeout(() => boardView.style.display = 'none', 500);
    homeView.style.display = 'none';
    topBar.style.display = 'none';
    bottomBar.style.display = 'none';
    
    calibTimer = performance.now();
    smoothGazeX = null;
    smoothGazeY = null;
    kfX.reset();
    kfY.reset();
    
    instructionBox.style.display = 'block';
}

function trainRidgeRegression() {
    try {
        const X = math.matrix(calibDataX);
        const Y = math.matrix(calibTargetX);
        const Z = math.matrix(calibTargetY);
        const num_features = calibDataX[0].length;
        const XT = math.transpose(X);
        const XTX = math.multiply(XT, X);
        const I = math.identity(num_features);
        // Lambda ajustada para CARA mode para evitar singularidad y mejorar suavidad
        const lambda = (trackingMode === "OJOS") ? 0.001 : 0.1;
        const lambdaI = math.multiply(lambda, I);
        const XTX_plus_lambdaI = math.add(XTX, lambdaI);
        const XTX_inv = math.inv(XTX_plus_lambdaI);
        const XTX_inv_XT = math.multiply(XTX_inv, XT);
        const Wx = math.multiply(XTX_inv_XT, Y);
        const Wy = math.multiply(XTX_inv_XT, Z);
        weightX = Wx.toArray();
        weightY = Wy.toArray();
        console.log(`Modelo entrenado (${trackingMode}). Wx:`, weightX, "Wy:", weightY);
        
        // Guardar perfil de calibracion
        if (calibrationProfiles) {
            calibrationProfiles[trackingMode] = {
                weightX: weightX,
                weightY: weightY
            };
            localforage.setItem('miravoz_calibration', calibrationProfiles).catch(e => console.error("Error guardando calibracion", e));
        }
        
    } catch(e) {
        console.error("Error entrenando modelo:", e);
    }
}

function extractFeatures(landmarks) {
    const avg_pupil_x = (landmarks[473].x + landmarks[468].x) / 2;
    const avg_pupil_y = (landmarks[473].y + landmarks[468].y) / 2;
    if (trackingMode === "OJOS") {
        const anchor_x = (landmarks[33].x + landmarks[263].x) / 2;
        const anchor_y = (landmarks[33].y + landmarks[263].y) / 2;
        const inter_ocular = landmarks[263].x - landmarks[33].x;
        const vector_x = (avg_pupil_x - anchor_x) / inter_ocular;
        const vector_y = (avg_pupil_y - anchor_y) / inter_ocular;
        return [1, vector_x, vector_y];
    } else {
        const nose_x = landmarks[1].x;
        const nose_y = landmarks[1].y;
        return [1, nose_x, nose_y];
    }
}

let currentFeatures = null;

// --- Bucle de Dibujo ---
function appLoop() {
    ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
    const now = performance.now();
    
    if (state === "CALIBRATING_COUNTDOWN") {
        if (now - calibTimer > CONFIG.COUNTDOWN_MS) {
            state = "CALIBRATING_SAMPLING";
            calibTimer = now;
        }
    }
    else if (state === "CALIBRATING_SAMPLING") {
        const [tx, ty] = calibPoints[currentPointIdx];
        if (currentFeatures) {
            calibDataX.push(currentFeatures);
            calibTargetX.push(tx);
            calibTargetY.push(ty);
        }
        if (now - calibTimer > CONFIG.SAMPLING_MS) {
            currentPointIdx++;
            if (currentPointIdx >= calibPoints.length) {
                trainRidgeRegression();
                isCalibrated = true;
                
                if (currentBundle) {
                    state = "BOARD";
                    boardView.style.display = 'flex';
                    topBar.style.display = 'none';
                    bottomBar.style.display = 'none';
                    setTimeout(() => boardView.style.opacity = '1', 50);
                } else {
                    state = "HOME";
                    homeView.style.display = 'flex';
                    topBar.style.display = 'flex';
                    bottomBar.style.display = 'flex';
                }
                speak("Calibración completada");
                instructionBox.style.display = 'none';
            } else {
                state = "CALIBRATING_COUNTDOWN";
                calibTimer = now;
            }
        }
    }
    else if ((state === "BOARD" || state === "HOME") && trackingMode !== "CLICKS") {
        if (rawX !== null && rawY !== null && !isNaN(rawX) && !isNaN(rawY)) {
            if (kfX.x === null || isNaN(kfX.x)) {
                kfX.x = rawX;
                kfY.x = rawY;
            }
            smoothGazeX = kfX.update(rawX);
            smoothGazeY = kfY.update(rawY);
            
            if (!isNaN(smoothGazeX) && !isNaN(smoothGazeY)) {
                handleGazeInteraction(smoothGazeX, smoothGazeY);
            }
        }
    }
    
    // Rendering de UI Ocular
    if (state === "CALIBRATING_COUNTDOWN" || state === "CALIBRATING_SAMPLING") {
        if (currentPointIdx < calibPoints.length) {
            const [tx, ty] = calibPoints[currentPointIdx];
            ctxUI.beginPath();
            ctxUI.arc(tx, ty, 25, 0, 2 * Math.PI);
            ctxUI.fillStyle = (state === "CALIBRATING_SAMPLING") ? "#00ff88" : "#ff3366";
            ctxUI.fill();
            ctxUI.lineWidth = 4;
            ctxUI.strokeStyle = "#ffffff";
            ctxUI.stroke();
            
            if (state === "CALIBRATING_COUNTDOWN") {
                const progress = (now - calibTimer) / CONFIG.COUNTDOWN_MS;
                ctxUI.beginPath();
                ctxUI.arc(tx, ty, 35, -Math.PI / 2, (-Math.PI / 2) + (progress * 2 * Math.PI));
                ctxUI.strokeStyle = "#ff3366";
                ctxUI.stroke();
            }
            
            ctxUI.fillStyle = "#ffffff";
            ctxUI.font = "bold 20px Inter";
            ctxUI.textAlign = "center";
            ctxUI.textBaseline = "middle";
            ctxUI.fillText(`${currentPointIdx + 1}/9`, tx, ty);
        }
    }
    
    if ((state === "BOARD" || state === "HOME") && trackingMode !== "CLICKS" && smoothGazeX !== null && smoothGazeY !== null) {
        ctxUI.beginPath();
        ctxUI.arc(smoothGazeX, smoothGazeY, 15, 0, 2 * Math.PI);
        ctxUI.fillStyle = "rgba(0, 255, 136, 0.8)";
        ctxUI.fill();
        ctxUI.lineWidth = 2;
        ctxUI.strokeStyle = "#ffffff";
        ctxUI.stroke();
    }
    
    requestAnimationFrame(appLoop);
}
requestAnimationFrame(appLoop);

// --- MediaPipe Inicialización ---
let faceMesh, camera;
let isMediaPipeRunning = false;

function startMediaPipe() {
    if (trackingMode === "CLICKS") return;
    if (isMediaPipeRunning) return; // No reiniciar si ya corre
    
    if (!faceMesh) {
        faceMesh = new FaceMesh({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }});
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        faceMesh.onResults((results) => {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                currentFeatures = extractFeatures(landmarks);
                
                if (state === "BOARD" || state === "HOME") {
                    if (trackingMode === "OJOS" && weightX.length === 3) {
                        rawX = weightX[0] * currentFeatures[0] + weightX[1] * currentFeatures[1] + weightX[2] * currentFeatures[2];
                        rawY = weightY[0] * currentFeatures[0] + weightY[1] * currentFeatures[1] + weightY[2] * currentFeatures[2];
                        
                        const cx = window.innerWidth / 2;
                        const cy = window.innerHeight / 2;
                        rawX = cx + (rawX - cx) * 1.5;  
                        rawY = cy + (rawY - cy) * 2.0;  
                    } 
                    else if (trackingMode === "CARA" && weightX.length === 3) {
                        rawX = weightX[0] * currentFeatures[0] + weightX[1] * currentFeatures[1] + weightX[2] * currentFeatures[2];
                        rawY = weightY[0] * currentFeatures[0] + weightY[1] * currentFeatures[1] + weightY[2] * currentFeatures[2];
                        
                        // Escalado también para modo dinámico para hacerlo más sensible en los bordes
                        const cx = window.innerWidth / 2;
                        const cy = window.innerHeight / 2;
                        rawX = cx + (rawX - cx) * 1.5;  
                        rawY = cy + (rawY - cy) * 1.5;
                    }
                }
            } else {
                currentFeatures = null;
            }
        });
    }

    if (!camera) {
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await faceMesh.send({image: videoElement});
            },
            width: 640,
            height: 480
        });
    }
    
    camera.start();
    isMediaPipeRunning = true;
}

startMediaPipe();

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');

btnSettings.addEventListener('click', (e) => {
    e.preventDefault();
    settingsModal.style.display = 'flex';
});

btnCloseSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});
