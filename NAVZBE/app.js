// --- Firebase Configuration ---
// TO THE USER: Replace this placeholder with your real Firebase config from the Firebase Console.
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// --- Global State ---
let map;
let userMarker = null;
let isAdminMode = window.isAplicationAdmin || false;
let trafficRules = []; // Array of objects: {id, lat, lng, type, angle}
let ruleMarkers = [];
let accuracyCircle = null; // Visual circle for GPS precision
let tempClickLocation = null;
let audioCtx = null; // Web Audio API context
let isMapCentered = true; // Tracking if the map should follow the user
let isAdminGPSPaused = false; // Admin can pause GPS to edit map
let wakeLock = null; // Screen Wake Lock instance
let noSleepVideo = null; // Video fallback
let noSleepAudio = null; // Audio fallback (Web Audio API)
let db = null; // Firebase Database instance
let gpsHeartbeat = Date.now();
let gpsRetryCount = 0;
let gpsStartTime = Date.now();
let informedAboutPrecision = false;
let consecutiveTimeouts = 0;
let allowCoarseLocation = false;

// --- Initialization ---
async function init() {
    let startView = [40.4168, -3.7038]; // Madrid Default
    let startZoom = 13; // Starting wider
    let initialPosition = null;

    // Check GPS Permissions (Native or Browser)
    document.getElementById('status-pill').innerText = "🛰️ Buscando GPS...";

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;
            let status = await Geolocation.checkPermissions();

            if (status.location !== 'granted') {
                status = await Geolocation.requestPermissions({ permissions: ['location'] });
            }

            if (status.location === 'granted') {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
                if (position && position.coords) {
                    startView = [position.coords.latitude, position.coords.longitude];
                    startZoom = 15;
                    initialPosition = position.coords;
                }
            } else {
                document.getElementById('status-pill').innerText = "⚠️ Permisos de ubicación necesarios.";
            }
        } catch (e) {
            console.error("Error en GPS Check Nativo:", e);
        }
    } else if (!window.Capacitor && navigator.geolocation) {
        // Hyper-Robust Fallback for Android Chrome
        console.log("Iniciando búsqueda inicial de GPS (Hyper-Robust)...");

        try {
            // Try up to 2 times for the initial lock with long timeout
            let fetchAttempt = async (timeout) => {
                return new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: timeout,
                        maximumAge: 0
                    });
                });
            };

            let position = null;
            try {
                position = await fetchAttempt(10000); // 10s first try
            } catch (e) {
                console.warn("Primer intento GPS fallido, reintentando con 60s (v1.14)...");
                position = await fetchAttempt(60000); // 60s second try for cold start
            }

            if (position && position.coords) {
                startView = [position.coords.latitude, position.coords.longitude];
                startZoom = 15;
                initialPosition = position.coords;
                console.log("Posición inicial fijada (v1.7):", startView);
            }
        } catch (e) {
            console.error("Fallo definitivo en búsqueda inicial GPS:", e.message);
            document.getElementById('status-pill').innerText = "❌ No se pudo fijar GPS inicial.";
        }
    }

    // Initialize map with determined start location
    map = L.map('map').setView(startView, startZoom);

    // Show car immediately if we have the location
    if (initialPosition) {
        updateUserPosition(L.latLng(initialPosition.latitude, initialPosition.longitude), initialPosition.heading || 0, initialPosition.accuracy || 0);
        document.getElementById('status-pill').innerText = "✅ GPS Iniciado";
    }

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Load rules immediately (from LocalStorage or rules.js fallback)
    loadRulesFromStorage();

    // Start Firebase Sync (will update rules if cloud data exists)
    initFirebaseSync();

    // Map Click Listener (Only active in Admin Mode)
    map.on('click', onMapClick);

    // Start GPS
    startGPSTracking();

    // Map Interaction Listeners
    map.on('dragstart', handleMapDrag);
    map.on('zoomstart', handleMapDrag);

    // Request Wake Lock
    requestWakeLock();

    // iOS Audio Unlock: silently hook into ALL natural app interactions
    // (map taps, button presses, GPS interactions) - user never needs to do anything explicit
    const unlockAudio = async () => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            try {
                await audioCtx.resume();
                console.log('✅ AudioContext desbloqueado automáticamente (iOS fix)');
            } catch (e) { /* silently ignore */ }
        }
    };
    // Attach to every possible user interaction - silently transparent
    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(evt => {
        document.addEventListener(evt, unlockAudio, { once: false, passive: true });
    });
}

let watchId = null;

async function startGPSTracking() {
    // Check if we are in a Capacitor environment with Geolocation plugin
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;

            if (watchId != null) {
                try { await Geolocation.clearWatch({ id: watchId }); } catch (e) { }
            }

            console.log("Iniciando seguimiento GPS nativo...");
            watchId = await Geolocation.watchPosition({
                timeout: 30000,
                maximumAge: 5000
            }, (position, err) => {
                if (err) {
                    onLocationError(err);
                    return;
                }
                if (position && position.coords) {
                    gpsHeartbeat = Date.now();
                    onLocationFound({
                        latlng: L.latLng(position.coords.latitude, position.coords.longitude),
                        heading: position.coords.heading || 0,
                        accuracy: position.coords.accuracy
                    });
                }
            });
        } catch (e) {
            console.error("Error GPS Nativo:", e);
            document.getElementById('status-pill').innerText = "❌ Error GPS Nativo";
        }
    } else if (navigator.geolocation) {
        console.log("Iniciando GPS Web (v1.18)...");

        // Simple Watch with High Accuracy
        watchId = navigator.geolocation.watchPosition((position) => {
            gpsHeartbeat = Date.now();
            onLocationFound({
                latlng: L.latLng(position.coords.latitude, position.coords.longitude),
                heading: position.coords.heading || 0,
                accuracy: position.coords.accuracy
            });
        }, (err) => {
            gpsHeartbeat = Date.now();
            onLocationError(err);
            if (err.code === 3) setTimeout(startGPSTracking, 3000);
        }, {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
        });

        // Precision Watchdog (v1.18)
        if (window.precisionTimer) clearInterval(window.precisionTimer);
        window.precisionTimer = setInterval(() => {
            const now = Date.now();

            // Check for Heartbeat (GPS stopped talking entirely)
            if (now - gspHeartbeat > 20000) {
                console.warn("GPS Heartbeat fail. Restarting...");
                startGPSTracking();
                return;
            }

            // Check for Poor Accuracy (likely "Google Location Accuracy" disabled)
            const isAndroid = /Android/i.test(navigator.userAgent);
            const timeSinceStart = now - gpsStartTime;

            if (isAndroid && !informedAboutPrecision && timeSinceStart > 15000) {
                // If we haven't found a single good position yet, or if accuracy is consistently bad
                if (!userMarker || (userMarker && accuracyCircle && accuracyCircle.getRadius() > 200)) {
                    console.warn("Posible falta de 'Precisión de ubicación' en Android.");
                    showPrecisionAlert();
                    informedAboutPrecision = true;
                }
            }
        }, 10000);
    }
}

function showPrecisionAlert() {
    const statusPill = document.getElementById('status-pill');
    statusPill.style.height = "auto";
    statusPill.style.background = "#d32f2f";
    statusPill.innerHTML = `
        <div style="padding: 10px; line-height: 1.4;">
            <strong>⚠️ POSIBLE ERROR DE PRECISIÓN</strong><br>
            <small>Si el vehículo no se mueve, actívalo así:</small><br>
            <div style="text-align: left; margin-top: 5px; font-size: 11px;">
                1. Ajustes del Teléfono<br>
                2. Ubicación<br>
                3. Servicios de ubicación<br>
                4. <b>Precisión de la ubicación de Google</b> -> <span style="color:yellow">ACTIVAR</span>
            </div>
            <button onclick="this.parentElement.parentElement.style.height=''; informedAboutPrecision=true; renderStatusPill();" style="margin-top:5px; background:white; color:black; border:none; padding:2px 10px; border-radius:10px; font-size:10px;">Entendido</button>
        </div>
    `;
}

function renderStatusPill() {
    // Helper to restore pill state
    const statusPill = document.getElementById('status-pill');
    statusPill.style.background = "";
    statusPill.innerText = "🛰️ Buscando GPS...";
}


// --- Icons ---
const carIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

// Custom SVG Icons
function getRuleIcon(type, angle) {
    let htmlContent = '';

    if (type === 'forbidden') {
        // No Entry Sign
        htmlContent = `
            <div style="transform: rotate(${angle}deg); width: 15px; height: 15px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 100 100" style="width: 15px; height: 15px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                    <circle cx="50" cy="50" r="48" fill="#C00" stroke="white" stroke-width="2"/>
                    <rect x="20" y="40" width="60" height="20" fill="white"/>
                    <path d="M 50 2 L 60 15 L 40 15 Z" fill="white" stroke="none"/>
                </svg>
            </div>
        `;
    } else {
        // Mandatory Direction
        htmlContent = `
            <div style="transform: rotate(${angle}deg); width: 15px; height: 15px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 100 100" style="width: 15px; height: 15px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                    <circle cx="50" cy="50" r="48" fill="#0055A4" stroke="white" stroke-width="2"/>
                    <path d="M50 20 L20 60 L40 60 L40 85 L60 85 L60 60 L80 60 Z" fill="white"/>
                </svg>
            </div>
        `;
    }

    return L.divIcon({
        className: 'traffic-marker',
        html: htmlContent,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5]
    });
}

let editingRuleId = null;

// --- Admin Section ---
function toggleAdminMode() {
    isAdminMode = document.getElementById('admin-mode-toggle').checked;

    // UI Feedback
    document.body.style.border = isAdminMode ? "3px solid orange" : "none";
    document.getElementById('admin-controls').style.display = isAdminMode ? 'block' : 'none';

    // Show/hide simulation button
    const simControls = document.getElementById('simulation-controls');
    if (simControls) simControls.classList.toggle('hidden', !isAdminMode);

    // Change Admin icon/label style
    const adminToggleLabel = document.querySelector('.admin-toggle-label');
    if (adminToggleLabel) {
        adminToggleLabel.style.backgroundColor = isAdminMode ? 'orange' : '';
    }

    // Reset GPS pause and simulation when leaving admin mode
    if (!isAdminMode) {
        isAdminGPSPaused = false;
        const gpsBtn = document.getElementById('btn-pause-gps');
        if (gpsBtn) {
            gpsBtn.innerHTML = "📍";
            gpsBtn.style.backgroundColor = "";
        }
        stopSimulated(); // Always stop simulation when leaving admin
    }

    renderRules(); // Re-render to show/hide admin buttons
}

function toggleAdminGPS() {
    isAdminGPSPaused = !isAdminGPSPaused;
    const btn = document.getElementById('btn-pause-gps');
    if (isAdminGPSPaused) {
        btn.innerHTML = "⏸️";
        btn.style.backgroundColor = "#ff9800";
        document.getElementById('status-pill').innerText = "⏸️ GPS Pausado para Edición";
    } else {
        btn.innerHTML = "📍";
        btn.style.backgroundColor = "";
        document.getElementById('status-pill').innerText = "🛰️ GPS Reanudado";

        // Return to car if it exists
        if (userMarker) {
            isMapCentered = true;
            map.setView(userMarker.getLatLng(), 15);
        }
    }
}

let isUIVisible = true;
function toggleUI() {
    isUIVisible = !isUIVisible;
    const controls = document.getElementById('main-controls');
    const centerBtn = document.getElementById('center-btn');
    const toggleBtn = document.getElementById('ui-toggle-btn');

    if (isUIVisible) {
        if (controls) controls.style.display = 'block';
        if (centerBtn) centerBtn.style.display = 'flex';
        toggleBtn.innerText = '👁️';
        if (toggleBtn.style) toggleBtn.style.opacity = '1';
    } else {
        if (controls) controls.style.display = 'none';
        if (centerBtn) centerBtn.style.display = 'none';
        toggleBtn.innerText = '👁️‍🗨️';
        if (toggleBtn.style) toggleBtn.style.opacity = '0.5';
    }
}
// (Replaced alert with simplified toggle logic to avoid annoying popups)

function onMapClick(e) {
    if (!isAdminMode) return;

    // New Rule Mode
    editingRuleId = null;
    tempClickLocation = e.latlng;

    // Reset form
    document.getElementById('rule-type').value = 'forbidden';
    document.getElementById('rule-angle').value = 0;
    updateAnglePreview(); // Reset preview

    document.getElementById('rule-modal').classList.remove('hidden');
}

function editRule(id) {
    if (!isAdminMode) return;
    const rule = trafficRules.find(r => r.id === id);
    if (!rule) return;

    // Edit Mode
    editingRuleId = id;
    tempClickLocation = null; // We are not moving it, just editing props

    // Populate form
    document.getElementById('rule-type').value = rule.type;
    document.getElementById('rule-angle').value = rule.angle;
    updateAnglePreview(); // Show correct angle

    document.getElementById('rule-modal').classList.remove('hidden');

    // Close popup so it doesn't obstruct
    map.closePopup();
}

function updateAnglePreview() {
    const angle = document.getElementById('rule-angle').value;
    document.getElementById('angle-display').innerText = angle;
    document.getElementById('angle-arrow').style.transform = `rotate(${angle}deg)`;
}

function closeModal() {
    document.getElementById('rule-modal').classList.add('hidden');
    tempClickLocation = null;
    editingRuleId = null;
}

function saveRule() {
    const type = document.getElementById('rule-type').value;
    const angle = parseInt(document.getElementById('rule-angle').value) || 0;

    if (editingRuleId) {
        // Update existing rule
        const ruleIndex = trafficRules.findIndex(r => r.id === editingRuleId);
        if (ruleIndex !== -1) {
            trafficRules[ruleIndex].type = type;
            trafficRules[ruleIndex].angle = angle;
        }
    } else {
        // Create new rule
        if (!tempClickLocation) return;
        const newRule = {
            id: Date.now(),
            lat: tempClickLocation.lat,
            lng: tempClickLocation.lng,
            type: type,
            angle: angle
        };
        trafficRules.push(newRule);
    }

    saveRulesToStorage();
    renderRules();

    // Feedback: Trigger alarm as requested for admin action
    startAlert();
    // Stop it automatically after 2 seconds to avoid permanent deafness
    setTimeout(() => stopAlert(), 2000);

    closeModal();
}

function deleteRule(id) {
    if (!isAdminMode) return;
    if (confirm("¿Borrar esta señal permanentemente?")) {
        trafficRules = trafficRules.filter(r => r.id !== id);
        saveRulesToStorage();
        renderRules();
    }
}

// --- OSM Import Integration ---
async function importOSMRules() {
    if (!isAdminMode) return;

    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

    document.getElementById('status-pill').innerText = "⏳ Consultando OpenStreetMap...";

    // Overpass API Query: "oneway=yes" streets
    const query = `
        [out:json][timeout:25];
        way["oneway"="yes"](${bbox});
        (._;>;);
        out;
    `;

    const url = 'https://overpass-api.de/api/interpreter';

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: query
        });

        if (!response.ok) throw new Error("Error en conexión OSM");

        const data = await response.json();
        processOSMData(data);

    } catch (error) {
        console.error(error);
        document.getElementById('status-pill').innerText = "❌ Error al importar: " + error.message;
    }
}

function processOSMData(data) {
    let newRulesCount = 0;
    const nodes = {};
    const ways = [];

    data.elements.forEach(el => {
        if (el.type === 'node') nodes[el.id] = { lat: el.lat, lng: el.lon };
        else if (el.type === 'way') ways.push(el);
    });

    ways.forEach(way => {
        if (!way.nodes || way.nodes.length < 2) return;

        // "oneway=yes" means traffic flows from first node to last.
        // Forbidden direction is entering from the end (Last -> SecondLast)
        const lastNodeId = way.nodes[way.nodes.length - 1];
        const secondLastNodeId = way.nodes[way.nodes.length - 2];

        const lastNode = nodes[lastNodeId];
        const secondLastNode = nodes[secondLastNodeId];

        if (lastNode && secondLastNode) {
            const angle = calculateBearing(lastNode.lat, lastNode.lng, secondLastNode.lat, secondLastNode.lng);

            // Check for duplicates
            const isDuplicate = trafficRules.some(r => {
                const dist = getDistance(r.lat, r.lng, lastNode.lat, lastNode.lng);
                return dist < 10;
            });

            if (!isDuplicate) {
                trafficRules.push({
                    id: Date.now() + Math.random(),
                    lat: lastNode.lat,
                    lng: lastNode.lng,
                    type: 'forbidden',
                    angle: Math.round(angle)
                });
                newRulesCount++;
            }
        }
    });

    saveRulesToStorage();
    renderRules();
    document.getElementById('status-pill').innerText = `✅ Importación completada. ${newRulesCount} nuevas señales.`;
}

function calculateBearing(startLat, startLng, destLat, destLng) {
    const startLatRad = startLat * Math.PI / 180;
    const startLngRad = startLng * Math.PI / 180;
    const destLatRad = destLat * Math.PI / 180;
    const destLngRad = destLng * Math.PI / 180;

    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
        Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);

    let brng = Math.atan2(y, x);
    brng = brng * 180 / Math.PI;
    return (brng + 360) % 360;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// --- Firebase Sync Logic ---
function initFirebaseSync() {
    if (!window.FirebaseSDK) {
        console.warn("⚠️ Firebase SDK no detectado aún. Esperando...");
        window.onFirebaseSDKLoaded = () => {
            console.log("🔥 Firebase SDK cargado, iniciando sincronización...");
            initFirebaseSync();
        };
        return;
    }

    const { initializeApp, getDatabase, ref, onValue } = window.FirebaseSDK;

    try {
        const app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        const rulesRef = ref(db, 'traffic_rules');

        // Real-time synchronization:
        // This function triggers every time the database changes in the cloud!
        onValue(rulesRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Firebase stores objects, we need an array
                trafficRules = Object.values(data);
                console.log("🔄 Reglas sincronizadas desde la nube:", trafficRules.length);
                renderRules();
            } else {
                console.log("ℹ️ La nube está vacía. Cargando locales...");
                loadRulesFromStorage();
            }
        });
    } catch (err) {
        console.error("❌ Error Firebase:", err);
        loadRulesFromStorage();
    }
}

// --- Data Storage ---
function saveRulesToStorage() {
    // 1. Save locally as fallback
    localStorage.setItem('traffic_rules', JSON.stringify(trafficRules));

    // 2. Save to Cloud if in Admin Mode
    if (isAdminMode && db && window.FirebaseSDK) {
        const { set, ref } = window.FirebaseSDK;
        const rulesRef = ref(db, 'traffic_rules');

        // Convert array to object for Firebase (indexed by ID)
        const rulesObject = {};
        trafficRules.forEach(r => { rulesObject[r.id.toString().replace('.', '_')] = r; });

        set(rulesRef, rulesObject)
            .then(() => console.log("☁️ Cambios guardados en la nube"))
            .catch(err => console.error("❌ Error al guardar en la nube:", err));
    }
}

function loadRulesFromStorage() {
    const localData = localStorage.getItem('traffic_rules');
    let loadedRules = [];

    if (localData) {
        loadedRules = JSON.parse(localData);
        console.log("Reglas intentadas cargar desde LocalStorage:", loadedRules.length);
    }

    // Fallback or Merge: If local storage is empty, use PRELOADED_RULES from rules.js
    if (loadedRules.length === 0 && typeof PRELOADED_RULES !== 'undefined' && PRELOADED_RULES.length > 0) {
        loadedRules = [...PRELOADED_RULES];
        console.log("Reglas cargadas desde rules.js (fallback/inicial)");
        // Don't save yet, wait for user action or sync
    }

    trafficRules = loadedRules;
    renderRules();
}

function resetRulesFromFile() {
    if (!isAdminMode) return;

    if (confirm("⚠️ ¿RECARGAR DESDE ARCHIVO?\n\nEsto borrará los cambios locales no guardados en 'rules.js' y cargará las señales que estén en el archivo físico.\n\n¿Continuar?")) {
        localStorage.removeItem('traffic_rules');
        if (typeof PRELOADED_RULES !== 'undefined') {
            trafficRules = [...PRELOADED_RULES];
            saveRulesToStorage();
            renderRules();
            document.getElementById('status-pill').innerText = "🔄 Reglas recargadas desde archivo.";
        } else {
            alert("Error: No se encontró PRELOADED_RULES en rules.js");
        }
    }
}

function renderRules() {
    // Clear existing markers
    ruleMarkers.forEach(m => map.removeLayer(m));
    ruleMarkers = [];

    // Draw new ones
    trafficRules.forEach(rule => {
        const marker = L.marker([rule.lat, rule.lng], {
            icon: getRuleIcon(rule.type, rule.angle)
        })
            .addTo(map);

        // Build Popup Content
        let popupContent = `
            <div style="text-align:center;">
                <b>${rule.type === 'forbidden' ? '⛔ PROHIBIDO' : '⬇️ OBLIGATORIO'}</b><br>
                Rumbo: ${rule.angle}°
            </div>
        `;

        // Only add buttons if in Admin Mode
        if (isAdminMode) {
            popupContent += `
                <div style="margin-top:10px; display:flex; gap:5px; justify-content:center;">
                    <button onclick="editRule(${rule.id})" style="background:#2196F3; padding:5px 10px; font-size:12px;">Editar</button>
                    <button onclick="deleteRule(${rule.id})" style="background:#f44336; padding:5px 10px; font-size:12px;">Borrar</button>
                </div>
            `;
        }

        marker.bindPopup(popupContent);
        ruleMarkers.push(marker);
    });
}

// --- Persistence Helpers ---
function downloadConfig() {
    if (!isAdminMode) return;

    const content = `// Título: Configuración de Reglas de Tráfico
// Fecha: ${new Date().toLocaleString()}
// Descarga este archivo al directorio de tu proyecto (reemplazando el anterior) para guardar los cambios.

const PRELOADED_RULES = ${JSON.stringify(trafficRules, null, 4)};
`;

    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rules.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert("Archivo 'rules.js' descargado. \n\nPara hacer los cambios PERMANENTES:\n1. Ve a tu carpeta de descargas.\n2. Mueve el archivo 'rules.js' a la carpeta del proyecto.\n3. Reemplaza el archivo existente.");
}

function clearAllRules() {
    if (!isAdminMode) return;

    if (confirm("⚠️ ¿ESTÁS SEGURO?\n\nEsto borrará TODAS las señales del mapa.\nEsta acción no se puede deshacer a menos que tengas un backup en 'rules.js'.")) {
        trafficRules = [];
        saveRulesToStorage();
        renderRules();
        document.getElementById('status-pill').innerText = "🗑️ Todas las señales han sido eliminadas.";
    }
}

// --- Navigation Logic & Alerts ---
let currentHeading = 0; // Current car heading (0-360)

function onLocationFound(e) {
    // If Admin paused GPS, ignore everything
    if (isAdminMode && isAdminGPSPaused) return;

    // If Simulating, ignore real GPS updates to prevent jumping
    if (isSimulating) return;

    const accuracy = e.accuracy || 0;

    // v1.13/v1.14/v1.17 Accuracy Lockdown
    // If we get a very poor accuracy (>200m) and we already have a previous reasonable position, ignore it.
    if (accuracy > 200 && userMarker && !allowCoarseLocation) {
        console.log(`Rechazando ubicación poco precisa (${Math.round(accuracy)}m)`);
        document.getElementById('status-pill').innerHTML = `📡 Baja precisión (${Math.round(accuracy)}m). Buscando satélites...`;
        return;
    }

    // v1.14/v1.17 Initial Filter: If accuracy is 2000m (tower), don't show the marker yet UNLESS we are in recovery mode
    if (accuracy >= 1500 && !userMarker && !allowCoarseLocation) {
        let waitMsg = `🛰️ Esperando señal satélite segura (${Math.round(accuracy)}m)...`;

        // v1.16 Hint if stuck
        if (Date.now() - gpsStartTime > 25000) {
            waitMsg = `🛰️ Calentando GPS (${Math.round(accuracy)}m)...<br><small>Si no baja, activa 'Ubicación Precisa' en Android.</small>`;
        }

        document.getElementById('status-pill').innerHTML = waitMsg;
        return;
    }

    // Reset recovery if we finally get a good fix
    if (accuracy < 100) {
        allowCoarseLocation = false;
        consecutiveTimeouts = 0;
    }

    // Update user marker
    updateUserPosition(L.latLng(e.latlng.lat, e.latlng.lng), e.heading || 0, accuracy);

    if (isMapCentered) {
        map.setView(userMarker.getLatLng(), 15);
    }

    // Update status bar
    const accuracyText = accuracy > 0 ? ` (${Math.round(accuracy)}m)` : "";
    let statusPrefix = "✅ GPS Activo";

    if (accuracy > 200) {
        statusPrefix = "⚠️ Ubicación Red (Buscando Satélites)";
    }

    document.getElementById('status-pill').innerHTML = `${statusPrefix}${accuracyText} <span id="aw-status" title="Keep-Awake Layers"></span>`;
    updateAwakeStatus();
}

function centerMap() {
    isMapCentered = true;
    if (userMarker) {
        map.setView(userMarker.getLatLng(), 15);
    }
}

// Add map interaction listener to stop auto-centering
function handleMapDrag() {
    if (isMapCentered) {
        isMapCentered = false;
        // Button is now permanent, so no display toggle needed here
    }
}

function updateUserPosition(latlng, heading, accuracy = 0) {
    currentHeading = heading;

    // 1. Rotate arrow icon
    const rotatedIcon = L.divIcon({
        className: 'car-marker',
        html: `
            <div style="transform: rotate(${heading}deg); width: 40px; height: 40px; display: flex; justify-content: center; align-items: center;">
                <svg viewBox="0 0 100 100" style="width: 40px; height: 40px; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.5));">
                    <path d="M50 5 L10 85 L50 70 L90 85 Z" fill="#2196F3" stroke="white" stroke-width="6" stroke-linejoin="round"/>
                </svg>
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    if (userMarker) {
        userMarker.setLatLng(latlng);
        userMarker.setIcon(rotatedIcon);
    } else {
        userMarker = L.marker(latlng, { icon: rotatedIcon }).addTo(map);
    }

    // 2. Update Accuracy Circle
    if (accuracy > 0) {
        if (accuracyCircle) {
            accuracyCircle.setLatLng(latlng);
            accuracyCircle.setRadius(accuracy);
        } else {
            accuracyCircle = L.circle(latlng, {
                radius: accuracy,
                color: '#2196F3',
                fillColor: '#2196F3',
                fillOpacity: 0.15,
                weight: 1,
                pointerEvents: 'none'
            }).addTo(map);
        }
    } else if (accuracyCircle) {
        map.removeLayer(accuracyCircle);
        accuracyCircle = null;
    }

    checkProximityToRules(latlng, heading);
}

function onLocationError(e) {
    console.warn("GPS Error Raw:", e);
    gpsHeartbeat = Date.now();

    let errorMsg = `Error GPS [C:${e.code}]: `;

    // Add raw message if available
    if (e.message) errorMsg += e.message;
    else if (e.code === 1) errorMsg += "Permiso denegado.";
    else if (e.code === 2) errorMsg += "Posición no disponible.";
    else if (e.code === 3) errorMsg += "Tiempo agotado.";

    // Action plan logic
    if (e.code === 3) {
        consecutiveTimeouts++;
        gpsRetryCount++;

        if (consecutiveTimeouts >= 3 || (Date.now() - gpsStartTime > 90000)) {
            console.warn("Multiple timeouts or long wait. Enabling Hybrid Recovery Mode.");
            allowCoarseLocation = true;
            document.getElementById('status-pill').innerHTML = "⚠️ El GPS tarda demasiado. Usando ubicación de red temporalmente...";
        }

        if (gpsRetryCount > 2) {
            console.warn("Too many HighAccuracy timeouts. Relaxing requirements...");
            // document.getElementById('status-pill').innerText = "⚠️ Relajando precisión por falta de respuesta...";
        }
    }

    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        errorMsg = "❌ Falta HTTPS. Chrome bloquea GPS en sitios no seguros.";
    }

    document.getElementById('status-pill').innerText = errorMsg;
}

// --- Intelligent Alert Logic ---
function checkProximityToRules(userLatLng, userHeading) {
    // Allow alerts if NOT admin OR if simulating (Admin testing simulation)
    if (isAdminMode && !isSimulating) return;

    let triggeringType = null;
    let triggeringRuleKey = null;

    trafficRules.forEach(rule => {
        const ruleLatLng = L.latLng(rule.lat, rule.lng);
        const distance = userLatLng.distanceTo(ruleLatLng);

        // 1. Proximity Check (e.g., 25 meters)
        if (distance < 25) {

            if (rule.type === 'forbidden') {
                // 2. Heading Check for FORBIDDEN
                const angleDiff = Math.abs(userHeading - rule.angle);
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

                if (normalizedDiff < 45) {
                    triggeringType = 'forbidden';
                    triggeringRuleKey = `forbidden_${rule.id}`; // unique per rule
                    document.getElementById('status-pill').innerText = `⚠️ DIRECCIÓN PROHIBIDA DETECTADA (Rumbo ${Math.round(userHeading)}º vs Señal ${rule.angle}º)`;
                }
            }
            else if (rule.type === 'mandatory') {
                // 2. Heading Check for MANDATORY
                const angleDiff = Math.abs(userHeading - rule.angle);
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

                // If deviation is greater than 45 degrees, you are going wrong way
                if (normalizedDiff > 45) {
                    triggeringType = 'mandatory';
                    triggeringRuleKey = `mandatory_${rule.id}`; // unique per rule
                    document.getElementById('status-pill').innerText = `⚠️ DIRECCIÓN OBLIGATORIA IGNORADA (Rumbo ${Math.round(userHeading)}º vs Señal ${rule.angle}º)`;
                }
            }
        }
    });

    if (triggeringType) {
        startAlert(triggeringType, triggeringRuleKey);
    } else {
        // No rule active: reset so next encounter always re-triggers
        if (currentAlertKey !== null) {
            currentAlertKey = null;
            stopAlert();
        }
    }
}



// --- Audio & Visual Alert ---
let currentAlertKey = null; // Tracks unique key of the currently active alert

function startAlert(type = 'forbidden', ruleKey = null) {
    const alertDiv = document.getElementById('wrong-way-alert');

    // Build a unique key for this alert encounter
    const alertKey = ruleKey || type;

    // Update Icon and Message (always, so it reflects the current rule)
    if (alertDiv) {
        const iconDiv = document.getElementById('alert-icon');
        const titleH2 = document.getElementById('alert-title');
        const messageP = document.getElementById('alert-message');

        if (type === 'forbidden') {
            iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <circle cx="50" cy="50" r="48" fill="#C00" stroke="white" stroke-width="4"/>
                    <rect x="20" y="42" width="60" height="16" fill="white"/>
                </svg>
            `;
            titleH2.innerText = "¡DIRECCIÓN PROHIBIDA!";
            messageP.innerText = "NO ENTRE EN ESTA CALLE";
        } else {
            iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <circle cx="50" cy="50" r="48" fill="#0055A4" stroke="white" stroke-width="4"/>
                    <path d="M50 15 L20 55 L40 55 L40 85 L60 85 L60 55 L80 55 Z" fill="white"/>
                </svg>
            `;
            titleH2.innerText = "¡DIRECCIÓN OBLIGATORIA!";
            messageP.innerText = "SIGA LA SEÑALIZACIÓN";
        }

        alertDiv.classList.remove('hidden');
    }

    // If this is a NEW alert encounter (different key), restart the siren
    if (currentAlertKey !== alertKey) {
        currentAlertKey = alertKey;
        stopSiren();   // Stop any previous siren first
        playSiren();   // Start fresh for this new encounter
    }
}

function stopAlert() {
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv && !alertDiv.classList.contains('hidden')) {
        alertDiv.classList.add('hidden');
    }
    stopSiren(); // Always stop the audio loop when alert is dismissed
}

function toggleWrongWayAlert() {
    // Manual trigger for testing
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv.classList.contains('hidden')) {
        startAlert('forbidden');
    } else {
        stopAlert();
    }
}

// Web Audio API Siren
let sirenInterval = null; // Handle for the repeating siren loop

async function playSiren() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Try to resume AudioContext (required by iOS) - retry up to 5 times automatically
    for (let attempt = 0; attempt < 5 && audioCtx.state === 'suspended'; attempt++) {
        try {
            await audioCtx.resume();
        } catch (e) { /* silently ignore */ }
        if (audioCtx.state === 'suspended') {
            await new Promise(r => setTimeout(r, 300)); // wait 300ms and retry
        }
    }

    // Avoid starting multiple loops
    if (sirenInterval) return;

    // Internal function to play one beep cycle
    function playBeep() {
        if (!audioCtx || audioCtx.state !== 'running') {
            // Context still not ready - try again silently
            audioCtx.resume().catch(() => { });
            return;
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.4);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.8);

        gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    }

    // Play immediately then repeat every 1.2 seconds
    playBeep();
    sirenInterval = setInterval(playBeep, 1200);
}

function stopSiren() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
}

// --- Wake Lock Logic (Hyper-Robust for Chrome & iOS 16-26) ---

let heartbeatCanvas = null;
let heartbeatCtx = null;

async function requestWakeLock() {
    console.log("🔄 Ejecutando pulso de Keep-Awake v1.4...");

    // Safety check for Chrome (requires HTTPS)
    if (!window.isSecureContext) {
        console.warn("⚠️ Advertencia: El entorno no es seguro (HTTP). WakeLock de Chrome/Android fallará.");
        const pill = document.getElementById('status-pill');
        if (pill && !pill.innerText.includes("⚠️")) {
            pill.innerHTML += ' <span title="Entorno no seguro (HTTP). Usa HTTPS para modo Keep-Awake en Chrome.">⚠️</span>';
        }
    }

    let layers = [];

    // 1. Capa: Native Wake Lock
    if ('wakeLock' in navigator) {
        try {
            if (!wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log("✅ Capa 1: Native Wake Lock activa");
                wakeLock.addEventListener('release', () => {
                    console.log("ℹ️ Capa 1 liberada");
                    wakeLock = null;
                    updateAwakeStatus();
                });
            }
            layers.push('N');
        } catch (err) {
            console.warn(`❌ Capa 1 falló: ${err.message}`);
        }
    }

    // 2. Capa: Silent Video (Visibility Optimized)
    try {
        if (!noSleepVideo) {
            noSleepVideo = document.createElement('video');
            noSleepVideo.setAttribute('playsinline', '');
            noSleepVideo.setAttribute('muted', '');
            noSleepVideo.setAttribute('loop', '');
            noSleepVideo.style.cssText = 'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0.02; pointer-events:none; z-index:2147483647;';
            noSleepVideo.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAZptb292AAAAbG12aGQAAAAA36Y+Sd+mPkkAAAPoAAAAKAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACUHRyYWsAAABcdGtoZAAAAAPfpt5J36beSQAAAAEAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAGdlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAA8AAAAAAAEAAAAAAZhtZGlhAAAAIG1kaGQAAAAA36Y+Sd+mPkkAAGmQAABpYABVxAAAAAAAbWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAF1bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcYmxyZfAAAAAAAAAAbmFtZSAAAAAAAAAAAG9mcm0AAAAAAAAAAG9mcm0AAAAAAAAAAG9mcm0AAAAAAAAAAG9mcm0AAAAAAAAAAHN0YmwaAAAAfHN0c2QAAAAAAAAAAQAAAGZ2cGMxAAAAAAABAAEAAAAAAAgAEAAAAAAAAAAAAAAAAAAAABYAAABCHGNscnAAAAAYAAAVAAAAAAAFAAkAAAVAAAAAAAUACQAAABZhcHBsAAAAEWNvbHIAbmNscAAAAAAKAAhjb2xyAAAAHGNjbHIAAAAYYXBwbAAAAAsAbmNscAAAAAAKAAhzdHRzAAAAAAAAAAEAAAABAAABAAAAABpzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzelAAAAAAAAAAAAAAAQAAABRzdGNvAAAAAAAAAAEAAAA4AAAAFG1kYXQAAAAAAAAAbWRhdAAAAA==';
            document.body.appendChild(noSleepVideo);
        }
        if (noSleepVideo.paused) {
            noSleepVideo.play().catch(e => console.warn("Video play failed:", e));
        }
        layers.push('V');
    } catch (err) {
        console.warn("⚠️ Capa 2 falló:", err);
    }

    // 3. Capa: Audio Pulse (Chrome Optimization)
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        if (!noSleepAudio) {
            const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;

            // Chrome sometimes ignores true zero-gain pulses.
            // Using a tiny gain sibling instead.
            const gain = audioCtx.createGain();
            gain.gain.value = 0.001; // Inaudible but "real" signal

            source.connect(gain);
            gain.connect(audioCtx.destination);

            source.start();
            noSleepAudio = source;
            console.log("✅ Capa 3: Audio (Chrome optimized) activa");
        }
        layers.push('A');
    } catch (err) {
        console.warn("⚠️ Capa 3 falló:", err);
    }

    // 4. Capa: Canvas Heartbeat (Blink/Chrome Optimization)
    // Animating a single pixel helps keep the tab active in some browser engines.
    try {
        if (!heartbeatCanvas) {
            heartbeatCanvas = document.createElement('canvas');
            heartbeatCanvas.width = 1;
            heartbeatCanvas.height = 1;
            heartbeatCanvas.style.cssText = 'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0.001; pointer-events:none; z-index:-1;';
            document.body.appendChild(heartbeatCanvas);
            heartbeatCtx = heartbeatCanvas.getContext('2d');

            const animate = () => {
                if (heartbeatCtx) {
                    heartbeatCtx.fillStyle = `rgb(${Math.random() * 255},0,0)`;
                    heartbeatCtx.fillRect(0, 0, 1, 1);
                }
                requestAnimationFrame(animate);
            };
            animate();
            console.log("✅ Capa 4: Canvas Heartbeat activa");
        }
    } catch (e) {
        console.warn("Canvas heartbeat failed:", e);
    }

    updateAwakeStatus(layers);
}

// Global Re-request
setInterval(() => {
    if (document.visibilityState === 'visible') requestWakeLock();
}, 15000); // More frequent for Chrome (every 15s)

function updateAwakeStatus(layersArg) {
    const indicator = document.getElementById('aw-status');
    if (!indicator) return;

    let layers = layersArg || [];
    if (layers.length === 0) {
        if (wakeLock) layers.push('N');
        if (noSleepVideo && !noSleepVideo.paused) layers.push('V');
        if (noSleepAudio) layers.push('A');
    }

    if (layers.length > 0) {
        indicator.innerText = ` [${layers.join('')}]`;
        indicator.style.color = "#4CAF50";
    } else {
        indicator.innerText = " [!]";
        indicator.style.color = "#F44336";
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

// Reactivate on EVERYTHING
['touchstart', 'click', 'scroll', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => requestWakeLock(), { passive: true });
});

// --- PWA Installation Logic ---
function checkAndShowInstallPrompt() {
    // Detect if iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // Detect if already in standalone mode (desktop or already installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    // Only show on iOS if not already installed
    if (isIOS && !isStandalone) {
        // Show after 3 seconds to not be intrusive immediately
        setTimeout(() => {
            const prompt = document.getElementById('ios-install-prompt');
            if (prompt) prompt.classList.remove('hidden');
        }, 3000);
    }
}

function closeInstallPrompt() {
    const prompt = document.getElementById('ios-install-prompt');
    if (prompt) prompt.classList.add('hidden');
}

// Android: The browser handles the prompt automatically if requirements are met,
// but we can listen to it for future custom buttons.
window.addEventListener('beforeinstallprompt', (e) => {
    console.log("PWA Install Prompt detected for Android");
    // e.preventDefault(); // Uncomment if you want to show a custom button instead of browser default
});

// Call PWA check on init
checkAndShowInstallPrompt();

// Start
init();

// ===== Simulation Mode (v1.19) =====
let isSimulating = false;
let simLat = null;
let simLng = null;
let simHeading = 0;

function toggleSimulation() {
    isSimulating = !isSimulating;
    const keypad = document.getElementById('sim-keypad');
    const btn = document.getElementById('sim-toggle-btn');

    if (isSimulating) {
        // Grab current car position as starting point
        if (userMarker) {
            simLat = userMarker.getLatLng().lat;
            simLng = userMarker.getLatLng().lng;
        } else {
            simLat = map.getCenter().lat;
            simLng = map.getCenter().lng;
        }
        simHeading = 0;
        keypad.classList.remove('hidden');
        btn.style.background = '#ff9800';
        btn.title = 'Salir de Simulación';
        document.getElementById('status-pill').innerText = '🎮 Modo Simulación Activo';
    } else {
        stopSimulated();
    }
}

function stopSimulated() {
    isSimulating = false;
    const keypad = document.getElementById('sim-keypad');
    const btn = document.getElementById('sim-toggle-btn');
    if (keypad) keypad.classList.add('hidden');
    if (btn) { btn.style.background = ''; btn.title = 'Modo Simulación'; }
    document.getElementById('status-pill').innerText = '🛰️ GPS Reanudado';
    // Snap back to real GPS position if available
    if (userMarker) map.setView(userMarker.getLatLng(), 15);
}

function moveSimulated(direction) {
    if (!isSimulating) return;

    // Step size: ~8 metres in degrees
    const step = 0.00008;

    if (direction === 'up') { simLat += step; simHeading = 0; }
    if (direction === 'down') { simLat -= step; simHeading = 180; }
    if (direction === 'right') { simLng += step; simHeading = 90; }
    if (direction === 'left') { simLng -= step; simHeading = 270; }

    const latlng = L.latLng(simLat, simLng);

    // Update UI marker
    updateUserPosition(latlng, simHeading, 5);
    map.setView(latlng, map.getZoom());

    // Trigger proximity check (same as real GPS)
    checkProximityToRules(latlng, simHeading);

    document.getElementById('status-pill').innerText =
        `🎮 Sim | Rumbo: ${simHeading}° | Lat: ${simLat.toFixed(5)} Lng: ${simLng.toFixed(5)}`;
}
