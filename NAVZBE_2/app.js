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
let db = null;
let isSyncInitialized = false;
let map;
let userMarker = null;
let isAdminMode = window.isApplicationAdmin || false;
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
let gpsHeartbeat = Date.now();
let gpsRetryCount = 0;
let gpsStartTime = Date.now();
let lastInteractionTime = 0; // Tracks last manual map touch
let informedAboutPrecision = false;
let consecutiveTimeouts = 0;
let allowCoarseLocation = false;
let mapOverlays = []; // Array of objects: {id, lat, lng, angle}
let overlayMarkers = [];
let lastMovementLatLng = null; // Store previous LatLng for bearing calculation
let smoothHeading = 0; // The calculated bearing to use for rotation

// --- Missing Declarations ---
let isOverlayMode = false;
let isSimulating = false;
let simLat = 39.7663;
let simLng = 2.7151;
let simHeading = 0;
let currentLanguage = 'ca'; // Global language state (v1.34)


// --- Initialization ---
async function init() {
    let startView = [39.7663, 2.7151]; // Sóller Default
    let startZoom = 18;
    let initialPosition = null;
    let hasSavedState = false;

    // --- State Restoration (v1.42) ---
    const savedStateJson = sessionStorage.getItem('nav_app_state');
    if (savedStateJson) {
        try {
            const savedState = JSON.parse(savedStateJson);
            startView = [savedState.center.lat, savedState.center.lng];
            startZoom = savedState.zoom;
            hasSavedState = true;
            console.log("♻️ Estat base restaurat");
        } catch (e) { console.error("Error base restauración:", e); }
    }

    // Check GPS Permissions (Native or Browser)
    document.getElementById('status-pill').innerText = "🛰️ Buscando GPS...";

    // Skip initial GPS center if we are restoring a previous view
    if (!hasSavedState) {
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
                        startZoom = 18;
                        initialPosition = position.coords;
                    }
                } else {
                    document.getElementById('status-pill').innerText = "⚠️ Permisos de ubicación necesarios.";
                }
            } catch (e) {
                console.error("Error en GPS Check Nativo:", e);
            }
        } else if (!window.Capacitor && navigator.geolocation) {
            console.log("Iniciando búsqueda inicial de GPS (Hyper-Robust)...");

            try {
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
                    position = await fetchAttempt(10000);
                } catch (e) {
                    console.warn("Reintentando GPS...");
                    position = await fetchAttempt(40000);
                }

                if (position && position.coords) {
                    startView = [position.coords.latitude, position.coords.longitude];
                    startZoom = 18;
                    initialPosition = position.coords;
                }
            } catch (e) {
                console.error("Fallo inicial GPS:", e.message);
                document.getElementById('status-pill').innerText = "❌ No se pudo fijar GPS inicial.";
            }
        }
    }

    // Initialize map with determined start location
    map = L.map('map', { attributionControl: false }).setView(startView, startZoom);

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
    loadOverlaysFromStorage(); // New

    // Start Firebase Sync (will update rules if cloud data exists)
    initFirebaseSync();
    // initOverlaySync() is now called inside initFirebaseSync() to ensure db is ready

    // Map Click Listener (Only active in Admin Mode)
    map.on('click', onMapClick);

    // Start GPS
    startGPSTracking();

    // Map Interaction Listeners
    map.on('dragstart', handleMapDrag);
    map.on('zoomend', () => {
        renderOverlays();
        renderRules(); // Also rescale rules if needed
    });
    // map.on('zoomstart', handleMapDrag); // DEACTIVATED: Allow user to zoom without losing the center follow mode (Fix for regression v1.31)


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


    // Reactivate UI states if restored (v1.42)
    if (savedStateJson) {
        try {
            const savedState = JSON.parse(savedStateJson);
            sessionStorage.removeItem('nav_app_state'); // Clear it

            if (savedState.isOverlayMode) {
                isOverlayMode = false; // Reset to let toggle work
                toggleOverlayMode();
            }
            if (savedState.isAdminGPSPaused) {
                isAdminGPSPaused = false;
                toggleAdminGPS();
            }
            if (savedState.isSimulating) {
                isSimulating = true;
                simLat = savedState.simLat;
                simLng = savedState.simLng;
                simHeading = savedState.simHeading;

                // Re-trigger visual simulation UI
                const keypad = document.getElementById('sim-keypad');
                const btn = document.getElementById('sim-toggle-btn');
                const container = document.getElementById('simulation-controls');
                if (keypad) keypad.classList.remove('hidden');
                if (container) container.classList.remove('hidden');
                if (btn) {
                    btn.style.background = '#ff9800';
                    btn.title = 'Salir de Simulación';
                }
                // Update marker
                updateUserPosition(L.latLng(simLat, simLng), simHeading, 5);
            }
        } catch (e) { console.error("Error aplicando estado guardado:", e); }
    }

    // Attach to every possible user interaction - silently transparent (iOS fix)
    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(evt => {
        document.addEventListener(evt, unlockAudio, { once: false, passive: true });
    });
}

function refreshRules() {
    try {
        console.log("🔄 Reiniciant aplicació per descarregar fitxers nous...");

        // Save State
        const state = {
            zoom: map ? map.getZoom() : 18,
            center: map ? map.getCenter() : { lat: 39.7663, lng: 2.7151 },
            isMapCentered: isMapCentered,
            isOverlayMode: isOverlayMode,
            isAdminGPSPaused: isAdminGPSPaused,
            isSimulating: isSimulating,
            simLat: simLat,
            simLng: simLng,
            simHeading: simHeading
        };
        sessionStorage.setItem('nav_app_state', JSON.stringify(state));

        // Create fresh URL with timestamp
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('v', Date.now());

        // Use replace to avoid back-button loops and force a real navigate
        window.location.replace(currentUrl.toString());
    } catch (e) {
        console.error("Refresh error:", e);
        window.location.reload();
    }
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
            if (now - gpsHeartbeat > 20000) {
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
            <div id="version-label">Versió: 1.47</div>
            <strong>⚠️ POSSIBLE ERROR DE PRECISIÓ</strong><br>
            <small>Si el vehicle no es mou, activa-ho així:</small><br>
            <div style="text-align: left; margin-top: 5px; font-size: 11px;">
                1. Ajustos del Telèfon<br>
                2. Ubicació<br>
                3. Serveis d'ubicació<br>
                4. <b>Precisió de la ubicació de Google</b> -> <span style="color:yellow">ACTIVAR</span>
            </div>
            <button onclick="this.parentElement.parentElement.style.height=''; informedAboutPrecision=true; renderStatusPill();" style="margin-top:5px; background:white; color:black; border:none; padding:2px 10px; border-radius:10px; font-size:10px;">Entès</button>
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
    // ... items from rule icon ...
    let htmlContent = '';
    // (Existing rule icon logic - I will keep it but I need to provide the new overlay icon function)
    if (type === 'forbidden') {
        htmlContent = `
            <div style="transform: rotate(${angle}deg); width: 15px; height: 15px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 100 100" style="width: 15px; height: 15px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                    <circle cx="50" cy="50" r="48" fill="#C00" stroke="white" stroke-width="2"/>
                    <rect x="20" y="40" width="60" height="20" fill="white"/>
                    <path d="M 50 2 L 60 15 L 40 15 Z" fill="white" stroke="none"/>
                </svg>
            </div>
        `;
    } else if (type === 'zbe') {
        htmlContent = `
            <div style="transform: rotate(${angle}deg); width: 22px; height: 22px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 100 100" style="width: 22px; height: 22px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                    <circle cx="50" cy="50" r="48" fill="white" stroke="#C00" stroke-width="8"/>
                    <text x="50" y="62" font-family="Arial" font-size="32" font-weight="bold" fill="black" text-anchor="middle">ZBE</text>
                    <path d="M 50 2 L 60 15 L 40 15 Z" fill="#C00" stroke="none"/>
                </svg>
            </div>
        `;
    } else if (type === 'deadend') {
        htmlContent = `
            <div style="transform: rotate(${angle}deg); width: 19px; height: 19px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 100 100" style="width: 19px; height: 19px; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                    <rect x="5" y="5" width="90" height="90" fill="#0055A4" stroke="white" stroke-width="2"/>
                    <rect x="35" y="30" width="30" height="65" fill="white"/>
                    <rect x="20" y="25" width="60" height="15" fill="#C00"/>
                    <path d="M 50 2 L 60 12 L 40 12 Z" fill="white" stroke="none"/>
                </svg>
            </div>
        `;
    } else {
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

// NEW: Overlay Icon (Designed to cover OSM arrows or mark boundaries)
function getOverlayIcon(angle, type = 'arrow') {
    const zoom = map ? map.getZoom() : 15;

    // Dynamic sizing based on zoom level (OpenStreetMap scale)
    let size = 8;
    if (zoom <= 13) size = 4;
    else if (zoom === 14) size = 6;
    else if (zoom === 15) size = 8;
    else if (zoom === 16) size = 11;
    else if (zoom === 17) size = 15;
    else if (zoom === 18) size = 20;
    else if (zoom >= 19) size = 30;

    if (type === 'parking') {
        const pSize = size * 2; // Doble del tamaño
        return L.divIcon({
            className: 'map-overlay-marker',
            html: `
                <div style="transform: rotate(${angle}deg); width: ${pSize}px; height: ${pSize}px; background: #2196F3; border-radius: 50%; display: flex; justify-content:center; align-items:center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); border: 2px solid white; position: relative;">
                    <!-- Indicador de dirección (flecha blanca) -->
                    <div style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 14px solid white; filter: drop-shadow(0 0 2px rgba(0,0,0,0.5)); z-index: 10;"></div>
                    <div class="parking-marker-3d" style="font-size: ${pSize * 0.7}px; color: white; text-shadow: 0 0 4px rgba(0,0,0,0.5); pointer-events: none;">P</div>
                </div>
            `,
            iconSize: [pSize, pSize],
            iconAnchor: [pSize / 2, pSize / 2]
        });
    }

    if (type === 'zbe-large') {
        const zSize = size * 10; // 10 veces superior
        return L.divIcon({
            className: 'map-overlay-marker',
            html: `
                <div style="transform: rotate(${angle}deg); width: ${zSize}px; height: ${zSize}px; display: flex; justify-content:center; align-items:center; position: relative;">
                    <div class="zbe-overlay-text" style="font-size: ${zSize * 0.4}px;">ZBE</div>
                </div>
            `,
            iconSize: [zSize, zSize],
            iconAnchor: [zSize / 2, zSize / 2]
        });
    }

    if (type === 'line') {
        const width = size * 0.3; // Más estrecha
        const height = size * 1.5; // Más larga
        return L.divIcon({
            className: 'map-overlay-marker',
            html: `
                <div style="transform: rotate(${angle}deg); width: ${width}px; height: ${height}px; 
                     background: linear-gradient(to right, #800000, #ff4c4c, #800000); 
                     opacity: 0.7; border-radius: 1px; box-shadow: 0 0 3px rgba(0,0,0,0.5); 
                     border: 1px solid rgba(255,255,255,0.2);">
                </div>
            `,
            iconSize: [width, height],
            iconAnchor: [width / 2, height / 2]
        });
    }

    // Default Arrow
    const svgSize = size * 0.75;
    return L.divIcon({
        className: 'map-overlay-marker',
        html: `
            <div style="transform: rotate(${angle}deg); width: ${size}px; height: ${size}px; display:flex; justify-content:center; align-items:center; background: #4CAF50; border-radius: 2px; box-shadow: 0 0 2px rgba(0,0,0,0.3);">
                <svg viewBox="0 0 100 100" style="width: ${svgSize}px; height: ${svgSize}px;">
                    <path d="M50 5 L15 60 L40 60 L40 95 L60 95 L60 60 L85 60 Z" fill="white"/>
                </svg>
            </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

let editingRuleId = null;

// --- Admin Section ---
function toggleAdminMode() {
    isAdminMode = document.getElementById('admin-mode-toggle').checked;

    // Reset map rotation immediately when entering/leaving admin mode
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }

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
            map.setView(userMarker.getLatLng(), 18);
        }
    }
}

let isUIVisible = true;
function toggleUI() {
    isUIVisible = !isUIVisible;
    const toggleBtn = document.getElementById('ui-toggle-btn');
    const buttons = document.querySelectorAll('button:not(#ui-toggle-btn)');
    const cityCrest = document.getElementById('city-crest');
    const mainControls = document.getElementById('main-controls');
    const simKeypad = document.getElementById('sim-keypad');
    const mapAttribution = document.getElementById('map-attribution');

    buttons.forEach(btn => {
        // Skip buttons inside modals or the simulation keypad to avoid breaking active interactions
        if (!btn.closest('.modal-content') && !btn.closest('#sim-keypad')) {
            btn.style.display = isUIVisible ? '' : 'none';
        }
    });

    if (cityCrest) {
        cityCrest.style.display = isUIVisible ? '' : 'none';
    }

    if (mapAttribution) {
        mapAttribution.style.display = isUIVisible ? '' : 'none';
    }

    if (mainControls) {
        // For Admin sidebar background
        mainControls.style.background = isUIVisible ? '' : 'transparent';
        mainControls.style.border = isUIVisible ? '' : 'none';
        mainControls.style.boxShadow = isUIVisible ? '' : 'none';
    }

    // Hide simulation keypad if UI is hidden
    if (simKeypad && !isUIVisible) {
        simKeypad.classList.add('hidden');
    }

    if (toggleBtn) {
        toggleBtn.innerText = isUIVisible ? '👁️' : '👁️‍🗨️';
        toggleBtn.style.opacity = isUIVisible ? '1' : '0.5';
    }

    // Hide/Show overlays markers
    overlayMarkers.forEach(m => {
        if (isUIVisible) map.addLayer(m);
        else map.removeLayer(m);
    });
}

// (Replaced alert with simplified toggle logic to avoid annoying popups)

function onMapClick(e) {
    if (!isAdminMode) return;

    if (isOverlayMode) {
        // Overlay Creation
        tempClickLocation = e.latlng;
        editingOverlayId = null;
        document.getElementById('overlay-angle').value = 0;
        updateOverlayAnglePreview();
        document.getElementById('overlay-modal').classList.remove('hidden');
        return;
    }

    // New Rule Mode
    editingRuleId = null;
    tempClickLocation = e.latlng;

    // Reset form
    document.getElementById('rule-type').value = 'forbidden';
    document.getElementById('rule-angle').value = 0;
    updateAnglePreview(); // Reset preview

    document.getElementById('rule-modal').classList.remove('hidden');
}

// --- Overlay Admin Functions ---
let editingOverlayId = null;

function toggleOverlayMode() {
    isOverlayMode = !isOverlayMode;
    const btn = document.getElementById('overlay-mode-btn');
    if (btn) {
        btn.style.boxShadow = isOverlayMode ? "0 0 10px #673AB7, inset 0 0 5px rgba(0,0,0,0.5)" : "";
        btn.style.border = isOverlayMode ? "2px solid white" : "";
    }
    document.getElementById('status-pill').innerText = isOverlayMode ? "🎨 Modo Capa Visual: Haz clic para tapar flecha" : "📍 Modo Normal";
}

function updateOverlayAnglePreview() {
    const angle = document.getElementById('overlay-angle').value;
    const type = document.getElementById('overlay-type').value;
    document.getElementById('overlay-angle-display').innerText = angle;

    const arrow = document.getElementById('overlay-angle-arrow');
    const previewContainer = document.getElementById('overlay-angle-preview');

    if (type === 'line') {
        arrow.style.transform = `rotate(${angle}deg)`;
        arrow.innerHTML = `
            <div style="width: 6px; height: 30px; background: linear-gradient(to right, #800000, #ff4c4c, #800000); border-radius: 1px;"></div>
        `;
    } else if (type === 'parking') {
        arrow.style.transform = `rotate(0deg)`; // El parking no rota con el ángulo
        arrow.innerHTML = `
            <div style="width: 35px; height: 35px; background: #2196F3; border-radius: 50%; display: flex; justify-content:center; align-items:center; border: 1px solid white;">
                <div class="parking-marker-3d" style="font-size: 22px; color: white;">P</div>
            </div>
        `;
    } else if (type === 'zbe-large') {
        arrow.style.transform = `rotate(${angle}deg)`;
        arrow.innerHTML = `
            <div style="font-size: 10px; font-weight: bold; border: 1px solid #C00; padding: 1px; color: #C00;">ZBE</div>
        `;
    } else {
        arrow.style.transform = `rotate(${angle}deg)`;
        arrow.innerHTML = '↑';
    }
}

function closeOverlayModal() {
    document.getElementById('overlay-modal').classList.add('hidden');
    tempClickLocation = null;
    editingOverlayId = null;
}

function saveOverlay() {
    const angle = parseInt(document.getElementById('overlay-angle').value) || 0;
    const type = document.getElementById('overlay-type').value || 'arrow';

    if (editingOverlayId) {
        const idx = mapOverlays.findIndex(o => o.id === editingOverlayId);
        if (idx !== -1) {
            mapOverlays[idx].angle = angle;
            mapOverlays[idx].type = type;
        }
    } else {
        if (!tempClickLocation) return;
        mapOverlays.push({
            id: Date.now(),
            lat: tempClickLocation.lat,
            lng: tempClickLocation.lng,
            angle: angle,
            type: type
        });
    }

    saveOverlaysToStorage();
    renderOverlays();
    closeOverlayModal();
}

function editOverlay(id) {
    if (!isAdminMode) return;
    const overlay = mapOverlays.find(o => o.id === id);
    if (!overlay) return;

    editingOverlayId = id;
    tempClickLocation = null;
    document.getElementById('overlay-angle').value = overlay.angle;
    document.getElementById('overlay-type').value = overlay.type || 'arrow';
    updateOverlayAnglePreview();
    document.getElementById('overlay-modal').classList.remove('hidden');
    map.closePopup();
}

function deleteOverlay(id) {
    if (!isAdminMode) return;
    if (confirm("¿Esborrar aquesta fletxa visual?")) {
        mapOverlays = mapOverlays.filter(o => o.id !== id);
        saveOverlaysToStorage();
        renderOverlays();
    }
}

function renderOverlays() {
    overlayMarkers.forEach(m => map.removeLayer(m));
    overlayMarkers = [];

    mapOverlays.forEach(overlay => {
        const marker = L.marker([overlay.lat, overlay.lng], {
            icon: getOverlayIcon(overlay.angle, overlay.type || 'arrow')
        }).addTo(map);

        if (isAdminMode) {
            const label = overlay.type === 'line' ? 'Línia de Delimitació' : 'Flecha Visual';
            let popupContent = `
                <div style="text-align:center;">
                    <b>${label}</b><br>
                    Rumbo: ${overlay.angle}°
                    <div style="margin-top:10px; display:flex; gap:5px; justify-content:center;">
                        <button onclick="editOverlay(${overlay.id})" style="background:#673AB7; color:white; padding:5px 10px; font-size:12px; border:none; border-radius:3px;">Editar</button>
                        <button onclick="deleteOverlay(${overlay.id})" style="background:#f44336; color:white; padding:5px 10px; font-size:12px; border:none; border-radius:3px;">Borrar</button>
                    </div>
                </div>
            `;
            marker.bindPopup(popupContent);
        }
        overlayMarkers.push(marker);
    });
}

function saveOverlaysToStorage() {
    // 1. Local storage fallback
    localStorage.setItem('map_overlays', JSON.stringify(mapOverlays));

    // 2. Firebase Cloud persistence - PROACTIVE SYNC
    if (db && window.FirebaseSDK) {
        const { set, ref } = window.FirebaseSDK;
        const overlaysRef = ref(db, 'map_overlays');

        // Convert array to object for Firebase saving
        const overlaysObj = {};
        mapOverlays.forEach(o => {
            // Clean ID for Firebase key safety
            const cleanId = o.id.toString().replace('.', '_');
            overlaysObj[cleanId] = o;
        });

        console.log("☁️ Intentando guardar overlays en Firebase...", mapOverlays.length);
        set(overlaysRef, overlaysObj)
            .then(() => console.log("✅ Overlays guardados en la nube con éxito"))
            .catch(err => console.error("❌ Error al guardar overlays en la nube:", err));
    }
}

function loadOverlaysFromStorage() {
    const localData = localStorage.getItem('map_overlays');
    if (localData) {
        mapOverlays = JSON.parse(localData);
    } else if (typeof PRELOADED_OVERLAYS !== 'undefined') {
        mapOverlays = [...PRELOADED_OVERLAYS];
    }
    renderOverlays();
}

function downloadOverlaysConfig() {
    if (!isAdminMode) return;

    const content = `// Título: Configuración de Capas Visuales (Flechas)
// Fecha: ${new Date().toLocaleString()}
// Descarga este archivo al directorio de tu proyecto (reemplazando el anterior) para guardar los cambios.

const PRELOADED_OVERLAYS = ${JSON.stringify(mapOverlays, null, 4)};
`;

    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'overlays.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert("Capes Visuals descarregades. \n\nMou 'overlays.js' a la carpeta del projecte per sincronitzar.");
}

function resetOverlaysFromFile() {
    if (!isAdminMode) return;

    if (confirm("⚠️ ¿Carregar fletxes des d'arxiu?\n\nAixò reemplaçarà les teves fletxes actuals per les que hi ha a 'overlays.js'.")) {
        localStorage.removeItem('map_overlays');
        if (typeof PRELOADED_OVERLAYS !== 'undefined') {
            mapOverlays = [...PRELOADED_OVERLAYS];
            renderOverlays();
            document.getElementById('status-pill').innerText = "🔄 Capas visuales cargadas desde archivo.";
        }
    }
}

function initOverlaySync() {
    if (!window.FirebaseSDK || !db) return;

    const { ref, onValue } = window.FirebaseSDK;
    const overlaysRef = ref(db, 'map_overlays');

    console.log("🎨 Escuchando capa de flechas (overlays)...");
    onValue(overlaysRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            mapOverlays = Object.values(data);
            console.log("✅ Capa visual cargada desde red:", mapOverlays.length, "flechas.");
            renderOverlays();
        } else {
            console.warn("⚠️ Capa visual vacía en red. Usando datos locales.");
            loadOverlaysFromStorage();
        }
    }, (error) => {
        console.error("❌ ERROR de red en capa visual:", error.message);
    });
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
    closeModal(); // Close modal immediately to ensure UI responsiveness

    // Feedback: Trigger alarm as requested for admin action
    try {
        startAlert();
        setTimeout(() => stopAlert(), 2000);
    } catch (e) {
        console.warn("Feedback alert skipped:", e);
    }
}

function deleteRule(id) {
    if (!isAdminMode) return;
    if (confirm("¿Esborrar aquest senyal permanentment?")) {
        trafficRules = trafficRules.filter(o => o.id !== id);
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
    document.getElementById('status-pill').innerText = `✅ Importació completada. ${newRulesCount} nous senyals.`;
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
    if (isSyncInitialized) {
        console.log("ℹ️ Sincronización ya activa.");
        return;
    }

    if (!window.FirebaseSDK) {
        console.warn("⚠️ Firebase SDK no detectado aún.");
        window.onFirebaseSDKLoaded = () => {
            initFirebaseSync();
        };
        return;
    }

    isSyncInitialized = true;

    const { initializeApp, getApps, getDatabase, ref, onValue } = window.FirebaseSDK;

    try {
        if (firebaseConfig.apiKey === "YOUR_API_KEY") {
            console.log("ℹ️ Firebase no configurado. Operando en Modo Local.");
            loadRulesFromStorage();
            loadOverlaysFromStorage();
            return;
        }

        // Prevent "app already exists" error
        const existingApps = getApps();
        const app = existingApps.length > 0 ? existingApps[0] : initializeApp(firebaseConfig);

        db = getDatabase(app);
        const rulesRef = ref(db, 'traffic_rules');

        console.log("📡 Iniciando escucha en tiempo real de reglas...");
        onValue(rulesRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                trafficRules = Object.values(data);
                console.log("🔄 Reglas sincronizadas:", trafficRules.length);
                renderRules();
            } else {
                console.log("ℹ️ Cargando reglas locales (nube vacía)...");
                loadRulesFromStorage();
            }
        });

        // Independent call for overlays to ensure they sync even if rules are empty
        initOverlaySync();
    } catch (err) {
        console.error("❌ Error Crítico Firebase:", err);
        loadRulesFromStorage();
        loadOverlaysFromStorage();
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

    if (confirm("⚠️ ¿RECARREGAR DES D'ARXIU?\n\nAixò esborrarà els canvis locals no guardats a 'rules.js' i carregarà els senyals que hi hagi a l'arxiu físic.\n\n¿Continuar?")) {
        localStorage.removeItem('traffic_rules');
        if (typeof PRELOADED_RULES !== 'undefined') {
            trafficRules = [...PRELOADED_RULES];
            saveRulesToStorage();
            renderRules();
            document.getElementById('status-pill').innerText = "🔄 Reglas recargadas desde archivo.";
        } else {
            alert("Error: No s'ha trobat PRELOADED_RULES a rules.js");
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
                <b>${rule.type === 'forbidden' ? '⛔ PROHIBIT' : '⬇️ OBLIGATORI'}</b><br>
                Rumb: ${rule.angle}°
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

    alert("Arxiu 'rules.js' descarregat. \n\nPer fer els canvis PERMANENTS:\n1. Ves a la teva carpeta de descàrregues.\n2. Mou l'arxiu 'rules.js' a la carpeta del projecte.\n3. Reemplaça l'arxiu existent.");
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

    // --- Manual Heading Calculation (Bearing from movement) ---
    const currentLatLng = L.latLng(e.latlng.lat, e.latlng.lng);
    let headingToUse = e.heading || 0;

    if (lastMovementLatLng) {
        const dist = getDistance(lastMovementLatLng.lat, lastMovementLatLng.lng, currentLatLng.lat, currentLatLng.lng);

        // Update heading only if moved significantly (> 2 meters) to avoid jitter
        if (dist > 2) {
            const calculatedBearing = calculateBearing(
                lastMovementLatLng.lat, lastMovementLatLng.lng,
                currentLatLng.lat, currentLatLng.lng
            );
            smoothHeading = calculatedBearing;
            lastMovementLatLng = currentLatLng;
            console.log(`🧭 Rumbo calculado: ${Math.round(smoothHeading)}º (${Math.round(dist)}m)`);
        }
        headingToUse = smoothHeading;
    } else {
        lastMovementLatLng = currentLatLng;
        if (e.heading) smoothHeading = e.heading;
        headingToUse = smoothHeading;
    }

    // Update user marker
    updateUserPosition(currentLatLng, headingToUse, accuracy);

    // Navigation Zoom 18
    if (isMapCentered) {
        let zoom = map.getZoom();
        if (zoom < 16) zoom = 18;

        map.setView(userMarker.getLatLng(), zoom);

        // --- Heading Up: Rotate Map (v1.50) ---
        // Moved to updateUserPosition for simulation support
    } else {
        // ... (existing auto-center logic)
        const now = Date.now();
        const inactiveTime = now - lastInteractionTime;
        const speed = e.speed || 0;

        if (inactiveTime > 15000 || (speed > 1.5 && inactiveTime > 3000)) {
            isMapCentered = true;
            console.log("📍 Autocentrado recuperado automáticamente (Inactividad/Movimiento)");
            map.setView(userMarker.getLatLng(), map.getZoom());
        }

        // Ensure map is upright when not following
        // Moved to updateUserPosition for simulation support
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

// Global flag to track if we have received at least one valid GPS position
let hasReceivedFirstGPS = false;


function centerMap() {
    isMapCentered = true;
    if (userMarker) {
        map.setView(userMarker.getLatLng(), 18); // Force zoom 18 on manual center
    }
}

// Add map interaction listener to stop auto-centering
function handleMapDrag() {
    // Only deactivate if we already have a stable GPS signal
    // This prevents "dislocation" if the user touches the screen before the first fix
    if (isMapCentered && hasReceivedFirstGPS) {
        isMapCentered = false;
        lastInteractionTime = Date.now();
        console.log("📍 Navegación manual activada (Autocentrado pausado)");

        // Immediate Map Reset to North-Up
        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.style.transform = 'translate(-50%, -50%) rotate(0deg)';
        }
    }
}

function updateUserPosition(latlng, heading, accuracy = 0) {
    if (accuracy > 0 && accuracy < 200) {
        hasReceivedFirstGPS = true;
    }
    currentHeading = heading;

    // 1. Rotate arrow icon
    // Arrow icon rotation is independent of map rotation (Leaflet handles marker layering)
    // By always using heading, it points "Up" when map is rotated by -heading.
    const iconRotation = heading;

    const rotatedIcon = L.divIcon({
        className: 'car-marker',
        html: `
            <div style="transform: rotate(${iconRotation}deg); width: 40px; height: 40px; display: flex; justify-content: center; align-items: center;">
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

    // --- Heading Up: Rotate Map (v1.51 / v1.17 Fix) ---
    const mapElement = document.getElementById('map');
    if (mapElement) {
        // CRITICAL FIX: Disable map rotation in admin mode to keep click precision
        if (isMapCentered && !isAdminMode) {
            mapElement.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;
        } else {
            // Force North-Up (0deg) if not centered or in Admin Mode
            if (mapElement.style.transform !== 'translate(-50%, -50%) rotate(0deg)') {
                mapElement.style.transform = 'translate(-50%, -50%) rotate(0deg)';
            }
        }
    }
}

// Window Resize / Orientation Change Handler (v1.53)
window.addEventListener('resize', () => {
    if (map) {
        map.invalidateSize();
        console.log("📏 Mapa redimensionado por cambio de ventana/orientación");
        if (isMapCentered && userMarker) {
            map.setView(userMarker.getLatLng(), map.getZoom());
        }
    }
});

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

        // 1. Proximity Check (e.g., 8 meters - triggered when vehicle is basically on the sign)
        if (distance < 8) {

            if (rule.type === 'forbidden' || rule.type === 'zbe' || rule.type === 'deadend') {
                // 2. Heading Check for FORBIDDEN / ZBE / DEADEND
                const angleDiff = Math.abs(userHeading - rule.angle);
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

                if (normalizedDiff < 45) {
                    triggeringType = rule.type;
                    triggeringRuleKey = `${rule.type}_${rule.id}`; // unique per rule

                    let label = "DIRECCIÓ PROHIBIDA";
                    if (rule.type === 'zbe') label = "ZONA BAIXES EMISSIONS";
                    if (rule.type === 'deadend') label = "CARRER SENSE SORTIDA";

                    document.getElementById('status-pill').innerText = `⚠️ ${label} DETECTADA (Rumb ${Math.round(userHeading)}º vs Senyal ${rule.angle}º)`;
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
                    document.getElementById('status-pill').innerText = `⚠️ DIRECCIÓ OBLIGATÒRIA IGNORADA (Rumb ${Math.round(userHeading)}º vs Senyal ${rule.angle}º)`;
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
let isAlertDismissed = false; // Prevents the modal from re-appearing for the same encounter

function startAlert(type = 'forbidden', ruleKey = null) {
    const alertDiv = document.getElementById('wrong-way-alert');

    // Build a unique key for this alert encounter
    const alertKey = ruleKey || type;

    // Update Icon and Message (always, so it reflects the current rule)
    if (alertDiv) {
        try {
            const iconDiv = document.getElementById('alert-icon');
            const titleH2 = document.getElementById('alert-title');
            const messageP = document.getElementById('alert-message');
            const stopBtn = document.getElementById('stop-alert-btn');

            if (!iconDiv || !titleH2 || !messageP) {
                console.error("Missing alert elements");
            } else {
                // Translate Stop Button (v1.21) - Show multi-language if no selector
                if (stopBtn) {
                    stopBtn.innerText = "Aturar / Detener / Stop / Stoppen / Arrêter";
                }

                if (type === 'forbidden') {
                    iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <circle cx="50" cy="50" r="48" fill="#C00" stroke="white" stroke-width="4"/>
                    <rect x="20" y="42" width="60" height="16" fill="white"/>
                </svg>
            `;
                    titleH2.innerHTML = `
                        <div style="font-size: 0.8em; opacity: 0.9;">¡DIRECCIÓ PROHIBIDA!</div>
                        <div style="font-size: 0.8em; opacity: 0.9;">¡DIRECCIÓN PROHIBIDA!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">WRONG WAY!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">FALSCHE RICHTUNG!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">SENS INTERDIT!</div>
                    `;
                    messageP.innerHTML = `
                        <div style="margin-bottom: 5px;">• NO ENTREU EN AQUEST CARRER</div>
                        <div style="margin-bottom: 5px;">• NO ENTRE EN ESTA CALLE</div>
                        <div style="margin-bottom: 5px;">• DO NOT ENTER THIS STREET</div>
                        <div style="margin-bottom: 5px;">• DIESE STRASSE NICHT BETRETEN</div>
                        <div style="margin-bottom: 5px;">• N'ENTREZ PAS DANS CETTE RUE</div>
                    `;
                } else if (type === 'zbe') {
                    iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <circle cx="50" cy="50" r="48" fill="white" stroke="#C00" stroke-width="8"/>
                    <text x="50" y="65" font-family="Arial" font-size="35" font-weight="bold" fill="black" text-anchor="middle">ZBE</text>
                </svg>
            `;
                    titleH2.innerHTML = `
                        <div style="font-size: 0.8em; opacity: 0.9;">¡ZONA DE BAIXES EMISSIONS!</div>
                        <div style="font-size: 0.8em; opacity: 0.9;">¡ZONA DE BAJAS EMISIONES!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">LOW EMISSION ZONE</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">UMWELTZONE</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">ZONE À FAIBLES ÉMISSIONS</div>
                    `;
                    messageP.innerHTML = `
                        <div style="margin-bottom: 5px; font-size: 0.9em;">• Permès vehicles amb distintiu <b>Zero Emissions</b> i <b>Autoritzats</b></div>
                        <div style="margin-bottom: 5px; font-size: 0.9em;">• Permitido vehículos con distintivo <b>Cero Emisiones</b> y <b>Autorizados</b></div>
                        <div style="margin-bottom: 5px; font-size: 0.8em;">• Only <b>Zero Emissions</b> and <b>Authorized</b> vehicles allowed</div>
                        <div style="margin-bottom: 5px; font-size: 0.8em;">• Nur <b>Zero-Emissions</b> und <b>Autorisierte</b> Fahrzeuge erlaubt</div>
                        <div style="margin-bottom: 5px; font-size: 0.8em;">• Uniquement les véhicules <b>Zéro Émission</b> et <b>Autorisés</b></div>
                    `;
                } else if (type === 'deadend') {
                    iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <rect x="5" y="5" width="90" height="90" fill="#0055A4" stroke="white" stroke-width="4"/>
                    <rect x="35" y="35" width="30" height="60" fill="white"/>
                    <rect x="20" y="25" width="60" height="15" fill="#C00"/>
                </svg>
            `;
                    titleH2.innerHTML = `
                        <div style="font-size: 0.8em; opacity: 0.9;">CARRER SENSE SORTIDA</div>
                        <div style="font-size: 0.8em; opacity: 0.9;">CALLE SIN SALIDA</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">DEAD END STREET</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">SACKGASSE!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">IMPASSE!</div>
                    `;
                    messageP.innerHTML = `
                        <div style="margin-bottom: 5px;">• AQUESTA VIA NO TÉ SORTIDA</div>
                        <div style="margin-bottom: 5px;">• ESTA VÍA NO TIENE SALIDA</div>
                        <div style="margin-bottom: 5px;">• THIS ROAD HAS NO EXIT</div>
                        <div style="margin-bottom: 5px;">• DIESE STRASSE HAT KEINEN AUSGANG</div>
                        <div style="margin-bottom: 5px;">• CETTE ROUTE N'A PAS D'ISSUE</div>
                    `;
                } else {
                    iconDiv.innerHTML = `
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%;">
                    <circle cx="50" cy="50" r="48" fill="#0055A4" stroke="white" stroke-width="4"/>
                    <path d="M50 15 L20 55 L40 55 L40 85 L60 85 L60 55 L80 55 Z" fill="white"/>
                </svg>
            `;
                    titleH2.innerHTML = `
                        <div style="font-size: 0.8em; opacity: 0.9;">¡DIRECCIÓ OBLIGATÒRIA!</div>
                        <div style="font-size: 0.8em; opacity: 0.9;">¡DIRECCIÓN OBLIGATORIA!</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">MANDATORY DIRECTION</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">VORGESCHRIEBENE FAHRTRICHTUNG</div>
                        <div style="font-size: 0.7em; opacity: 0.8;">DIRECTION OBLIGATOIRE</div>
                    `;
                    messageP.innerHTML = `
                        <div style="margin-bottom: 5px;">• SEGUIU LA SENYALITZACIÓ</div>
                        <div style="margin-bottom: 5px;">• SIGA LA SEÑALIZACIÓN</div>
                        <div style="margin-bottom: 5px;">• FOLLOW THE SIGNAGE</div>
                        <div style="margin-bottom: 5px;">• FOLGEN SIE DER BESCHILDERUNG</div>
                        <div style="margin-bottom: 5px;">• SUIVEZ LA SIGNALISATION</div>
                    `;
                }

            }
        } catch (e) {
            console.error("Error updating alert UI:", e);
        }

        // --- Intelligent Silence (v1.19) ---
        // Only show the visual modal if it hasn't been dismissed for this encounter
        if (!isAlertDismissed) {
            alertDiv.classList.remove('hidden');
            alertDiv.style.display = 'flex'; // Force display if hidden class is buggy
        }
    }

    // If this is a NEW alert encounter (different key), restart the siren and reset silence state
    if (currentAlertKey !== alertKey) {
        currentAlertKey = alertKey;
        isAlertDismissed = false; // New encounter: allow the modal to show again
        stopSiren();   // Stop any previous siren first
        playSiren(type);   // Start fresh for this new encounter (passing type for sound logic)
    }
}

function stopAlert() {
    const alertDiv = document.getElementById('wrong-way-alert');
    if (alertDiv && !alertDiv.classList.contains('hidden')) {
        alertDiv.classList.add('hidden');
    }
    isAlertDismissed = true; // Mark as dismissed for this encounter (v1.19)
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

async function playSiren(type = 'forbidden') {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Try to resume AudioContext (required by browsers)
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(e => console.warn("Context resume failed:", e));
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

        gain.gain.setValueAtTime(1.7, audioCtx.currentTime); // Maximized for PC audibility
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

        // Initial Pulse (The Pitido)
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    }

    // Play the initial beep
    playBeep();

    // If it's ZBE or Dead-end, we ONLY want that first pitido, so stop here
    if (type === 'zbe' || type === 'deadend') {
        return;
    }

    // Otherwise (FORBIDDEN, MANDATORY), proceed with the emergency loop
    sirenInterval = setInterval(() => {
        playBeep();
    }, 1200);
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

// --- Initial Caution Message ---
function showInitialCautionPrompt() {
    // Show always on start to ensure safety message is read
    setTimeout(() => {
        const prompt = document.getElementById('initial-caution-prompt');
        if (prompt) prompt.classList.remove('hidden');
    }, 1500);
}

function closeCautionPrompt() {
    const prompt = document.getElementById('initial-caution-prompt');
    if (prompt) prompt.classList.add('hidden');
}

// Help Modal Logic (v1.26)
function openHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.classList.add('hidden');
}

// Android: The browser handles the prompt automatically if requirements are met,
// but we can listen to it for future custom buttons.
window.addEventListener('beforeinstallprompt', (e) => {
    console.log("PWA Install Prompt detected for Android");
    // e.preventDefault(); // Uncomment if you want to show a custom button instead of browser default
});

// Call Caution check on init
showInitialCautionPrompt();

// Start
init();

// ===== Simulation Mode (v1.19) =====
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
        if (keypad) keypad.classList.remove('hidden');
        const container = document.getElementById('simulation-controls');
        if (container) container.classList.remove('hidden');

        btn.style.background = '#ff9800';
        btn.title = 'Salir de Simulación';
        isMapCentered = true; // Force center on start
        document.getElementById('status-pill').innerText = '🎮 Modo Simulació Actiu';
    } else {
        stopSimulated();
    }
}

function stopSimulated() {
    isSimulating = false;
    const keypad = document.getElementById('sim-keypad');
    const btn = document.getElementById('sim-toggle-btn');
    const container = document.getElementById('simulation-controls');

    if (keypad) keypad.classList.add('hidden');
    if (container && !container.contains(btn)) container.classList.add('hidden'); // Only hide if button isn't there (Unified Admin)

    if (btn) { btn.style.background = ''; btn.title = 'Modo Simulación'; }
    document.getElementById('status-pill').innerText = '🛰️ GPS Reprès';
    // Snap back to real GPS position if available
    if (userMarker) map.setView(userMarker.getLatLng(), 18);
}

function moveSimulated(direction) {
    if (!isSimulating) return;
    isMapCentered = true; // Always center when moving in simulation

    // Movement step (~4 meters) and Rotation step
    const step = 0.00004;
    const turnStep = 15;

    // 1. Handle Steering (Turning)
    if (direction.includes('left')) {
        simHeading = (simHeading - turnStep + 360) % 360;
    } else if (direction.includes('right')) {
        simHeading = (simHeading + turnStep) % 360;
    }

    // 2. Handle Movement (Forward/Backward)
    let moveDist = 0;
    if (direction.includes('up')) {
        moveDist = step;
    } else if (direction.includes('down')) {
        moveDist = -step;
    }

    // 3. Update Position based on Heading
    // Heading 0 is North, 90 is East
    if (moveDist !== 0) {
        const rad = simHeading * (Math.PI / 180);
        simLat += moveDist * Math.cos(rad);
        simLng += moveDist * Math.sin(rad);
    }

    const latlng = L.latLng(simLat, simLng);

    // Update UI marker
    updateUserPosition(latlng, simHeading, 5);
    map.setView(latlng, map.getZoom());

    // Trigger proximity check (same as real GPS)
    checkProximityToRules(latlng, simHeading);

    document.getElementById('status-pill').innerText =
        `🎮 Sim | Rumb: ${simHeading}° | Lat: ${simLat.toFixed(5)} Lng: ${simLng.toFixed(5)}`;
}

// Continuous Movement Logic
let simMoveInterval = null;

function startContinuousSim(dir) {
    if (!isSimulating) return;
    if (simMoveInterval) clearInterval(simMoveInterval);
    moveSimulated(dir); // Initial step
    simMoveInterval = setInterval(() => {
        moveSimulated(dir);
    }, 100); // 10 ticks per second
}

function stopContinuousSim() {
    if (simMoveInterval) {
        clearInterval(simMoveInterval);
        simMoveInterval = null;
    }
}

// Attach event listeners for press-and-hold movement
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sim-btn').forEach(btn => {
        const dir = btn.getAttribute('data-dir');

        const start = (e) => {
            if (e.type !== 'mousedown' || e.button === 0) { // Only left click or touch
                e.preventDefault();
                startContinuousSim(dir);
            }
        };
        const stop = (e) => {
            e.preventDefault();
            stopContinuousSim();
        };

        btn.addEventListener('mousedown', start, { passive: false });
        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('mouseup', stop);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('touchend', stop);
        btn.addEventListener('touchcancel', stop);
    });
});
