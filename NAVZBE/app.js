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
let tempClickLocation = null;
let audioCtx = null; // Web Audio API context
let isMapCentered = true; // Tracking if the map should follow the user
let isAdminGPSPaused = false; // Admin can pause GPS to edit map
let wakeLock = null; // Screen Wake Lock instance
let db = null; // Firebase Database instance

// --- Initialization ---
async function init() {
    let startView = [40.4168, -3.7038]; // Madrid Default
    let startZoom = 13; // Starting wider
    let initialPosition = null;

    // Check GPS Permissions (Native)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;
            let status = await Geolocation.checkPermissions();

            if (status.location !== 'granted') {
                status = await Geolocation.requestPermissions({ permissions: ['location'] });
            }

            if (status.location === 'granted') {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                if (position && position.coords) {
                    startView = [position.coords.latitude, position.coords.longitude];
                    startZoom = 15;
                    initialPosition = position.coords;
                }
            } else {
                document.getElementById('status').innerText = "⚠️ Permisos de ubicación necesarios para navegar.";
            }
        } catch (e) {
            console.error("Error en GPS Check:", e);
        }
    }
    // Initialize map with determined start location
    map = L.map('map').setView(startView, startZoom);

    // Show car immediately if we have the location
    if (initialPosition) {
        updateUserPosition(L.latLng(initialPosition.latitude, initialPosition.longitude), initialPosition.heading || 0);
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
}

let watchId = null;

async function startGPSTracking() {
    // Check if we are in a Capacitor environment with Geolocation plugin
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;

            // Clear existing watch if any
            if (watchId != null) {
                try {
                    await Geolocation.clearWatch({ id: watchId });
                } catch (e) {
                    console.warn("Error clearing watch:", e);
                }
            }

            console.log("Iniciando seguimiento GPS nativo con ajustes robustos...");
            watchId = await Geolocation.watchPosition({
                enableHighAccuracy: true,
                timeout: 15000,     // Aumentado a 15 segundos
                maximumAge: 1000    // Datos frescos (1 segundo)
            }, (position, err) => {
                if (err) {
                    console.warn("GPS Watch Error:", err);
                    onLocationError(err);
                    return;
                }

                if (position && position.coords) {
                    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
                    const heading = position.coords.heading || 0;

                    // Update UI
                    onLocationFound({ latlng: latlng, heading: heading });
                }
            });

        } catch (e) {
            console.error("Error starting GPS Watcher:", e);
            document.getElementById('status-pill').innerText = "❌ Error iniciando GPS Nativo: " + e.message;
        }
    } else if (!window.Capacitor) {
        // Fallback ONLY for browser testing
        console.log("Capacitor no detectado, usando Leaflet locate");
        map.locate({ setView: true, maxZoom: 17, watch: true, enableHighAccuracy: true });
        map.on('locationfound', onLocationFound);
        map.on('locationerror', onLocationError);
    } else {
        console.warn("Plugins de Capacitor no inicializados aún...");
        // Intentar de nuevo en 2 segundos si estamos en móvil
        setTimeout(startGPSTracking, 2000);
    }
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

    // Change Admin icon/label style
    const adminToggleLabel = document.querySelector('.admin-toggle-label');
    if (adminToggleLabel) {
        adminToggleLabel.style.backgroundColor = isAdminMode ? 'orange' : '';
    }

    // Reset GPS pause when leaving admin mode
    if (!isAdminMode) {
        isAdminGPSPaused = false;
        const gpsBtn = document.getElementById('btn-pause-gps');
        if (gpsBtn) {
            gpsBtn.innerHTML = "📍";
            gpsBtn.style.backgroundColor = "";
        }
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
    const btn = document.getElementById('ui-toggle-btn');

    if (isUIVisible) {
        controls.style.display = 'block';
        btn.innerText = '👁️';
        btn.style.opacity = '1';
    } else {
        controls.style.display = 'none';
        btn.innerText = '👁️‍🗨️'; // Closed eye or similar
        btn.style.opacity = '0.5'; // Make it less intrusive
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

    document.getElementById('status').innerText = "⏳ Consultando OpenStreetMap...";

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
        document.getElementById('status').innerText = "❌ Error al importar: " + error.message;
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
    document.getElementById('status').innerText = `✅ Importación completada. ${newRulesCount} nuevas señales.`;
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
            document.getElementById('status').innerText = "🔄 Reglas recargadas desde archivo.";
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
        document.getElementById('status').innerText = "🗑️ Todas las señales han sido eliminadas.";
    }
}

// --- Navigation Logic & Alerts ---
let currentHeading = 0; // Current car heading (0-360)

function onLocationFound(e) {
    // If Admin paused GPS, ignore everything
    if (isAdminMode && isAdminGPSPaused) return;

    // Update user marker
    updateUserPosition(e.latlng, e.heading || 0); // Use GPS heading if available, else 0

    if (isMapCentered) {
        map.setView(e.latlng, 15); // Force navigation zoom level
    }

    document.getElementById('status-pill').innerText = "✅ GPS Activo (Seguimiento)";
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

function updateUserPosition(latlng, heading) {
    currentHeading = heading;

    // Rotate arrow icon
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
        userMarker = L.marker(latlng, { icon: rotatedIcon }).addTo(map).bindPopup("Tu vehículo");
    }

    checkProximityToRules(latlng, heading);
}

function onLocationError(e) {
    console.warn("GPS Error:", e);
    let errorMsg = "Sin señal GPS.";

    // Detailed error feedback for user
    if (e.code === 1) errorMsg += " Permiso denegado.";
    else if (e.code === 3) {
        errorMsg += " Tiempo agotado. Reintentando...";
        // Auto-retry after 3 seconds on timeout
        setTimeout(startGPSTracking, 3000);
    }
    else if (window.location.protocol === 'file:') errorMsg += " Protocolo 'file://' restringe GPS.";
    else if (!window.isSecureContext) errorMsg += " Origen no seguro (falta HTTPS).";

    document.getElementById('status-pill').innerText = errorMsg;
}

// --- Intelligent Alert Logic ---
function checkProximityToRules(userLatLng, userHeading) {
    if (isAdminMode) return;

    let triggeringAlert = false;

    trafficRules.forEach(rule => {
        const ruleLatLng = L.latLng(rule.lat, rule.lng);
        const distance = userLatLng.distanceTo(ruleLatLng);

        // 1. Proximity Check (e.g., 25 meters)
        if (distance < 25) {

            if (rule.type === 'forbidden') {
                // 2. Heading Check for FORBIDDEN
                // If I am driving North (0) and Rule forbids North (0) -> ALERT
                // Tolerance: +/- 45 degrees
                const angleDiff = Math.abs(userHeading - rule.angle);
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

                if (normalizedDiff < 45) {
                    triggeringAlert = true;
                    document.getElementById('status').innerText = `⚠️ DIRECCIÓN PROHIBIDA DETECTADA (Rumbo ${Math.round(userHeading)}º vs Señal ${rule.angle}º)`;
                }
            }
            else if (rule.type === 'mandatory') {
                // 2. Heading Check for MANDATORY
                // If I am driving North (0) and Rule says East (90) -> ALERT
                // Logic: Alert if my heading is NOT within tolerance of the mandatory heading.
                // Tolerance: +/- 45 degrees implies valid range is [angle-45, angle+45]

                const angleDiff = Math.abs(userHeading - rule.angle);
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

                // If deviation is greater than 45 degrees, you are going wrong way
                if (normalizedDiff > 45) {
                    triggeringAlert = true;
                    document.getElementById('status').innerText = `⚠️ DIRECCIÓN OBLIGATORIA IGNORADA (Rumbo ${Math.round(userHeading)}º vs Señal ${rule.angle}º)`;
                }
            }
        }
    });

    if (triggeringAlert) {
        startAlert();
    } else {
        stopAlert();
    }
}



// --- Audio & Visual Alert ---
function startAlert() {
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv && alertDiv.classList.contains('hidden')) {
        alertDiv.classList.remove('hidden');
        playSiren();
    } else if (!alertDiv) {
        // Fallback for pages without the alert div (like Admin)
        playSiren();
    }
}

function stopAlert() {
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv && !alertDiv.classList.contains('hidden')) {
        alertDiv.classList.add('hidden');
    }
}

function toggleWrongWayAlert() {
    // Manual trigger for testing
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv.classList.contains('hidden')) {
        startAlert();
    } else {
        stopAlert();
    }
}

// Web Audio API Siren
function playSiren() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Create oscillator
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.5);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 1.0);

    // Play for 1 second loop
    osc.start();
    osc.stop(audioCtx.currentTime + 1);
}

// --- Wake Lock Logic ---
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("✅ Wake Lock activo");

            wakeLock.addEventListener('release', () => {
                console.log("ℹ️ Wake Lock liberado");
                wakeLock = null;
            });
        } catch (err) {
            console.warn(`❌ Error Wake Lock: ${err.name}, ${err.message}`);
        }
    } else {
        console.warn("⚠️ Wake Lock API no soportada en este navegador");
    }
}

// Re-request wake lock when page becomes visible again (Essential for iOS)
document.addEventListener('visibilitychange', async () => {
    if (wakeLock === null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// Also try to request on first user interaction (Many mobile browsers require a gesture)
const handleFirstInteraction = async () => {
    if (!wakeLock) await requestWakeLock();
    document.removeEventListener('click', handleFirstInteraction);
    document.removeEventListener('touchstart', handleFirstInteraction);
};
document.addEventListener('click', handleFirstInteraction, { once: true });
document.addEventListener('touchstart', handleFirstInteraction, { once: true });

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
