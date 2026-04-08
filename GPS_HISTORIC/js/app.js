// app.js - Sóller 1561 GPS Logic

let map;
let userMarker;
let userCircle;
let watchId = null;
let simulationInterval = null;
let routingControl = null;

// UI Elements
const modal = document.getElementById('poi-modal');
const modalTitle = document.getElementById('modal-title');
const modalDescHistory = document.getElementById('modal-desc-history');
const modalDescRecreation = document.getElementById('modal-desc-recreation');
const modalMedia = document.getElementById('modal-media');
const gpsStatusText = document.querySelector('#gps-status-text');
const gpsStatusDot = document.querySelector('.dot');

// ---- PATCH PARA ROTACIÓN DEL MAPA (LEAFLET 1.9 CSS ROTATE DRAG) ----
// Corrige la dirección del movimiento (panning) cuando el contenedor del mapa
// ha sido rotado por CSS con --map-rotation.
const originalOnMove = L.Draggable.prototype._onMove;
L.Draggable.prototype._onMove = function(e) {
    if (e._simulated || !this._enabled) return originalOnMove.call(this, e);
    if (e.touches && e.touches.length > 1) return originalOnMove.call(this, e);

    const first = (e.touches && e.touches.length === 1 ? e.touches[0] : e);
    let offset = new L.Point(first.clientX, first.clientY).subtract(this._startPoint);

    if (!offset.x && !offset.y) return;

    const mapRotation = parseFloat(document.documentElement.style.getPropertyValue('--map-rotation')) || 0;
    if (mapRotation !== 0 && this._element && this._element.classList.contains('leaflet-map-pane')) {
        const angle = -mapRotation * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // Aplicar rotación inversa de la pantalla al offset del mapa
        const rx = offset.x * cos - offset.y * sin;
        const ry = offset.x * sin + offset.y * cos;
        offset = new L.Point(Math.round(rx), Math.round(ry));
    }

    const fakeEvent = {
        _simulated: false,
        type: e.type,
        touches: e.touches ? [{ clientX: this._startPoint.x + offset.x, clientY: this._startPoint.y + offset.y }] : undefined,
        clientX: e.touches ? undefined : this._startPoint.x + offset.x,
        clientY: e.touches ? undefined : this._startPoint.y + offset.y,
    };
    return originalOnMove.call(this, fakeEvent);
};
// ------------------------------------------------------------------

let selectedCharacter = 'pages'; // Default
let currentLang = 'cat';
let activePoi = null;
let lastLatLng = null;
let autoCenterEnabled = true;
let lastSignificantLocation = null;

document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('btn-start');

    // Inicializar idiomas
    updateLanguage('cat'); // por defecto

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const lang = e.currentTarget.dataset.lang;
            updateLanguage(lang);
        });
    });

    // Welcome Screen Handlers
    startBtn.addEventListener('click', () => {
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('tutorial-screen').classList.remove('hidden');
    });

    document.getElementById('btn-start-tutorial').addEventListener('click', () => {
        document.getElementById('tutorial-screen').classList.add('hidden');
        if (!map) {
            initMap();
            startGPS();
        }
        setTimeout(() => { if(map) map.invalidateSize(); }, 500);
    });

    document.getElementById('btn-home').addEventListener('click', () => {
        document.getElementById('welcome-screen').classList.remove('hidden');
    });

    document.getElementById('close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-continue').addEventListener('click', closeModal);
    document.getElementById('btn-navigate').addEventListener('click', startNavigation);
    document.getElementById('btn-finalitzar').addEventListener('click', stopSimulation);
    document.getElementById('btn-center').addEventListener('click', centerOnUser);
    document.getElementById('btn-simulate').addEventListener('click', toggleSimulation);
    document.getElementById('btn-zoom-in').addEventListener('click', () => { if(map) map.zoomIn(); });
    document.getElementById('btn-zoom-out').addEventListener('click', () => { if(map) map.zoomOut(); });
    
    // Recentrar (Botón inteligente central)
    const recenterBtn = document.getElementById('btn-recenter');
    recenterBtn.addEventListener('click', () => {
        centerOnUser();
        recenterBtn.classList.add('hidden');
    });
    
    // Archive Panel Handlers
    const archivePanel = document.getElementById('archive-panel');
    document.getElementById('btn-archive').addEventListener('click', () => archivePanel.classList.remove('hidden'));
    document.getElementById('close-archive').addEventListener('click', () => archivePanel.classList.add('hidden'));

    // POI List Panel Handlers
    const poiListPanel = document.getElementById('poi-list-panel');
    document.getElementById('btn-poi-list').addEventListener('click', () => {
        buildPoiList();
        poiListPanel.classList.remove('hidden');
    });
    document.getElementById('close-poi-list').addEventListener('click', () => poiListPanel.classList.add('hidden'));
    // Close panel on backdrop click
    poiListPanel.addEventListener('click', (e) => {
        if (e.target === poiListPanel) poiListPanel.classList.add('hidden');
    });

    // Modal Tab Switching
    const tabHistory = document.getElementById('tab-history');
    const tabRecreation = document.getElementById('tab-recreation');
    const paneHistory = document.getElementById('content-history');
    const paneRecreation = document.getElementById('content-recreation');

    if (tabHistory && tabRecreation) {
        tabHistory.addEventListener('click', () => {
            tabHistory.classList.add('active');
            tabRecreation.classList.remove('active');
            paneHistory.classList.add('active');
            paneRecreation.classList.remove('active');
        });

        tabRecreation.addEventListener('click', () => {
            tabRecreation.classList.add('active');
            tabHistory.classList.remove('active');
            paneRecreation.classList.add('active');
            paneHistory.classList.remove('active');
        });
    }
});

function updateLanguage(lang) {
    currentLang = lang;
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (uiTranslations[key] && uiTranslations[key][lang]) {
            el.innerHTML = uiTranslations[key][lang];
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (uiTranslations[key] && uiTranslations[key][lang]) {
            el.title = uiTranslations[key][lang];
        }
    });

    if (map) {
        historicalPOIs.forEach(poi => {
            if (poi.marker) {
                poi.marker.setTooltipContent(`<div class="tooltip-rotator">${poi.title[currentLang]}</div>`);
            }
        });
        const listPanel = document.getElementById('poi-list-panel');
        if (!listPanel.classList.contains('hidden')) {
            buildPoiList(); 
        }
    }

    if (activePoi && !modal.classList.contains('hidden')) {
        modalTitle.innerHTML = activePoi.title[currentLang];
        modalDescHistory.innerHTML = activePoi.historia[currentLang];
        modalDescRecreation.innerHTML = activePoi.recreacio[currentLang];
    }
}

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
        inertia: true, // Activado para que el paneo sea mucho más suave y natural
        inertiaDeceleration: 1500, // Ajustamos la sensación de "deslizamiento"
    }).setView([39.775, 2.705], 13);

    const showRecenter = () => {
        autoCenterEnabled = false;
        const btn = document.getElementById('btn-recenter');
        if (btn) btn.classList.remove('hidden');
    };
    map.on('dragstart', showRecenter);
    map.on('touchstart', showRecenter);

    const mapPane = map.getPanes().mapPane;
    // Eliminado el filtro global del mapPane

    // Capa 1: Satélite (Tu mapa original)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        className: 'satellite-layer',
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19
    }).addTo(map);

    // Creamos un panel (pane) personalizado Z-Index alto para garantizar
    // que las etiquetas de las calles queden por encima de las líneas (overlayPane z-Index 400).
    map.createPane('labels');
    map.getPane('labels').style.zIndex = 450;
    map.getPane('labels').style.pointerEvents = 'none'; // Evitar que robe eventos de click

    // Capa 2: Textos de Calles Transparentes encima del satélite y las rutas
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png', {
        className: 'street-labels-layer',
        attribution: '&copy; CARTO (OpenStreetMap)',
        subdomains: 'abcd',
        maxZoom: 19,
        pane: 'labels'
    }).addTo(map);

    // Dibuixar Vectors Històrics
    L.geoJSON(historicalFeatures, {
        style: function(feature) {
            switch (feature.properties.type) {
                case 'path': return { color: "#8B4513", weight: 3, dashArray: "5, 10", opacity: 0.2 };
                default: return { color: "transparent", fillColor: "transparent" };
            }
        }
    }).addTo(map);

    historicalPOIs.forEach(poi => {
        // Marcador devuelto a su tamaño original reducido una tercera parte
        const iconHtml = `<div style="background-color: #ff3b30; width: 22px; height: 22px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 20px rgba(255, 59, 48, 1), 0 0 8px rgba(0,0,0,0.8);"></div>`;
        const customIcon = L.divIcon({ html: iconHtml, className: 'custom-poi-marker', iconSize: [28,28], iconAnchor: [14, 14] });
        
        const marker = L.marker(poi.coords, { icon: customIcon }).addTo(map);
        poi.marker = marker;
        
        marker.bindTooltip(`<div class="tooltip-rotator">${poi.title[currentLang]}</div>`, { 
            permanent: true, 
            direction: "top", 
            className: "historical-tooltip-permanent",
            offset: [0, -20],
            interactive: true
        });

        marker.on('click', () => {
            triggerPOI(poi);
        });

        L.circle(poi.coords, { color: '#ff3b30', fillColor: '#ff3b30', fillOpacity: 0.25, radius: poi.radiusMeters, weight: 2, dashArray: "4 4" }).addTo(map);
    });

    const arrowSvg = `
        <div class="user-nav-container ${selectedCharacter}-theme">
            <div class="nav-arrow-bg">
                <svg viewBox="0 0 24 24" class="nav-arrow-svg">
                    <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
                </svg>
            </div>
        </div>
    `;

    const userDivIcon = L.divIcon({
        html: arrowSvg,
        className: 'user-gps-marker',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    
    userMarker = L.marker([0, 0], { icon: userDivIcon, zIndexOffset: 1000, opacity: 0 }).addTo(map);
    userCircle = L.circle([0, 0], { radius: 0, color: '#34c759', weight: 1, fillOpacity: 0.1 }).addTo(map);
}

function startGPS() {
    if (!navigator.geolocation) {
        setGpsStatus(uiTranslations['gpsUnsupported'][currentLang], false);
        return;
    }
    setGpsStatus(uiTranslations['gpsConnecting'][currentLang], false);
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            updateUserLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy, position.coords.heading);
            checkProximity(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
            console.warn(`ERROR(${error.code}): ${error.message}`);
            setGpsStatus(uiTranslations['gpsNoSignal'][currentLang], false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function updateUserLocation(lat, lng, accuracy, heading) {
    const currLatLng = new L.LatLng(lat, lng);
    
    let rotation = 0;
    if (heading !== null && heading !== undefined) {
        rotation = heading;
    } else if (lastLatLng) {
        rotation = getBearing(lastLatLng.lat, lastLatLng.lng, lat, lng);
    }

    userMarker.setLatLng(currLatLng);
    userCircle.setLatLng(currLatLng).setRadius(accuracy);

    if (!lastLatLng) {
        map.setView(currLatLng, 18);
        lastSignificantLocation = currLatLng;
    }

    const navCursor = document.getElementById('nav-cursor');

    const mapRotation = -rotation;
    document.documentElement.style.setProperty('--map-rotation', `${mapRotation}deg`);
    
    if (navCursor) {
        navCursor.classList.remove('hidden');
        navCursor.className = `user-nav-container ${selectedCharacter}-theme`;
    }
    
    if (lastSignificantLocation && !autoCenterEnabled) {
        const distFromSignificant = getDistanceInMeters(lastSignificantLocation.lat, lastSignificantLocation.lng, currLatLng.lat, currLatLng.lng);
        if (distFromSignificant >= 25) {
            autoCenterEnabled = true;
            lastSignificantLocation = currLatLng;
        }
    }

    if (autoCenterEnabled) {
        map.panTo(currLatLng, {animate: false});
        lastSignificantLocation = currLatLng;
    }

    lastLatLng = currLatLng;
    setGpsStatus(uiTranslations['gpsActive'][currentLang], true);
}

function getBearing(lat1, lng1, lat2, lng2) {
    const dLon = (lng2 - lng1) * Math.PI / 180;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

function centerOnUser() {
    if (map && userMarker && map.hasLayer(userMarker)) {
        autoCenterEnabled = true;
        const curr = userMarker.getLatLng();
        lastSignificantLocation = curr;
        map.flyTo(curr, 18, { animate: true, duration: 1.5 });
        // Ocultar el botón inteligente ya que ya estamos centrados
        const recenterBtn = document.getElementById('btn-recenter');
        if (recenterBtn) recenterBtn.classList.add('hidden');
    } else {
        alert(uiTranslations['noGpsWait'][currentLang]);
    }
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lon2 - lon1) * rad;
    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function checkProximity(lat, lng) {
    if (!modal.classList.contains('hidden')) return;

    historicalPOIs.forEach(poi => {
        if (poi.visited) return;
        
        if (isSimulating) {
            if (poi.id === 'poi-final' && simIndex < 6) return;
            if (poi.id === 'poi-arenga' && (simIndex < 2 || simIndex > 3)) return;
        }

        const distance = getDistanceInMeters(lat, lng, poi.coords[0], poi.coords[1]);
        if (distance <= poi.radiusMeters) triggerPOI(poi);
    });
}

function triggerPOI(poi) {
    activePoi = poi;
    poi.visited = true;
    modalTitle.innerText = poi.title[currentLang];
    modalDescHistory.innerText = poi.historia[currentLang];
    modalDescRecreation.innerText = poi.recreacio[currentLang];
    
    const historyTab = document.getElementById('tab-history');
    if (historyTab) historyTab.click();
    
    modalMedia.innerHTML = '';
    if (poi.type === 'video') {
        modalMedia.innerHTML = `<div class="video-wrapper"><iframe src="${poi.mediaUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%; height:100%; border:0;"></iframe></div>`;
    } else if (poi.type === 'image') {
        modalMedia.innerHTML = `<img src="${poi.mediaUrl}" class="media-img" alt="${poi.title[currentLang]}" loading="lazy" style="width:100%; display:block; height:auto; min-height: 150px; background-color: #111;">`;
    }

    const btnContinue = document.getElementById('btn-continue');
    const btnFinalitzar = document.getElementById('btn-finalitzar');
    if (poi.id === 'poi-final') {
        if (btnContinue) btnContinue.classList.add('hidden');
        if (btnFinalitzar) btnFinalitzar.classList.remove('hidden');
    } else {
        if (btnContinue) btnContinue.classList.remove('hidden');
    }

    modal.classList.remove('hidden');

    if (map) {
        autoCenterEnabled = false; // Deshabilitar temporalmente el centrado automático para ver bien el punto
        
        const mapRotation = parseFloat(document.documentElement.style.getPropertyValue('--map-rotation')) || 0;
        const angle = mapRotation * Math.PI / 180;
        
        // Mover la cámara visualmente hacia la Izquierda (-X)
        // para que el punto quede desplazado hacia la parte visual derecha (libre del modal ancho)
        const distX = window.innerWidth * 0.35;
        const dx = -distX * Math.cos(angle);
        const dy = distX * Math.sin(angle);

        const centerPx = map.project(poi.coords, 18);
        centerPx.x += dx;
        centerPx.y += dy;
        
        map.flyTo(map.unproject(centerPx, 18), 18, { animate: true, duration: 1.2 });
    }
}

function buildPoiList() {
    const listEl = document.getElementById('poi-list-items');
    listEl.innerHTML = '';
    historicalPOIs.forEach(poi => {
        const item = document.createElement('button');
        item.className = 'poi-list-item' + (poi.visited ? ' visited' : '');
        item.innerHTML = `<span class="poi-list-dot"></span><span class="poi-list-title">${poi.title[currentLang]}</span>`;
        item.addEventListener('click', () => {
            document.getElementById('poi-list-panel').classList.add('hidden');
            if (map) map.flyTo(poi.coords, 18, { animate: true, duration: 1.2 });
            triggerPOI(poi);
        });
        listEl.appendChild(item);
    });
}

function closeModal() {
    activePoi = null;
    modal.classList.add('hidden');
    setTimeout(() => { modalMedia.innerHTML = ''; }, 400); 
}

function setGpsStatus(text, isActive) {
    if(!gpsStatusText) return;
    gpsStatusText.innerText = text;
    if (isActive) {
        gpsStatusDot.classList.add('active');
        gpsStatusDot.classList.add('pulse');
    } else {
        gpsStatusDot.classList.remove('active');
        gpsStatusDot.classList.remove('pulse');
    }
}

let isSimulating = false;
let simIndex = 0;
const simRoute = [
    [39.7784, 2.7043], 
    [39.7833, 2.7056], 
    [39.7656, 2.7187], 
    [39.7664, 2.7153], 
    [39.7965, 2.6958], 
    [39.7905, 2.6914], 
    [39.7727, 2.7079], 
    [39.7663, 2.7150]  
];

function toggleSimulation() {
    isSimulating = !isSimulating;
    const btn = document.getElementById('btn-simulate');
    const finalitzarBtn = document.getElementById('btn-finalitzar');
    if (isSimulating) {
        btn.style.borderColor = '#ffcc00';
        btn.style.background = 'rgba(255, 204, 0, 0.3)';
        if (finalitzarBtn) finalitzarBtn.classList.remove('hidden');
        if (watchId) navigator.geolocation.clearWatch(watchId);
        
        clearRouting();
        historicalPOIs.forEach(p => p.visited = false);
        
        setGpsStatus(uiTranslations['simActive'][currentLang], true);
        simIndex = 0;
        autoCenterEnabled = true;
        advanceSimulation();
    } else {
        btn.style.borderColor = 'var(--glass-border)';
        btn.style.background = 'var(--glass-bg)';
        if (finalitzarBtn) finalitzarBtn.classList.add('hidden');
        clearTimeout(simulationInterval);
        startGPS();
    }
}

function stopSimulation() {
    if (isSimulating) {
        closeModal(); 
        toggleSimulation(); 
        setTimeout(centerOnUser, 600);
    }
    clearRouting();
}

function advanceSimulation() {
    if (!isSimulating || simIndex >= simRoute.length) {
        toggleSimulation();
        return;
    }
    const maxSteps = 50; 
    if (simIndex < simRoute.length - 1) {
        const startPoint = simRoute[simIndex];
        const endPoint = simRoute[simIndex + 1];
        let step = 0;
        const animateMove = () => {
            if (!isSimulating) return;

            if (!modal.classList.contains('hidden')) {
                simulationInterval = setTimeout(animateMove, 500);
                return;
            }

            step++;
            const interpolLat = startPoint[0] + ((endPoint[0] - startPoint[0]) * (step / maxSteps));
            const interpolLng = startPoint[1] + ((endPoint[1] - startPoint[1]) * (step / maxSteps));
            const simHeading = getBearing(startPoint[0], startPoint[1], endPoint[0], endPoint[1]);
            updateUserLocation(interpolLat, interpolLng, 10, simHeading);
            checkProximity(interpolLat, interpolLng);
            
            if (step < maxSteps) {
                simulationInterval = setTimeout(animateMove, 50);
            } else {
                simIndex++;
                advanceSimulation();
            }
        };
        animateMove();
    }
}

function startNavigation() {
    if (!activePoi) return;
    
    // Verificamos que tengamos señal GPS
    if (!lastLatLng) {
        alert(uiTranslations['noGpsWait'][currentLang]);
        return;
    }

    // IMPORTANTE: Guardamos las coordenadas antes de llamar a closeModal,
    // ya que closeModal() borra activePoi (lo pone a null).
    const dest = L.latLng(activePoi.coords[0], activePoi.coords[1]);

    closeModal();

    if (routingControl) {
        routingControl.setWaypoints([
            lastLatLng,
            dest
        ]);
    } else {
        routingControl = L.Routing.control({
            waypoints: [
                lastLatLng,
                dest
            ],
            routeWhileDragging: false,
            fitSelectedRoutes: true,
            show: false,          
            addWaypoints: false,  
            draggableWaypoints: false,
            lineOptions: {
                styles: [{color: '#007aff', opacity: 0.8, weight: 6, dashArray: '10 10'}]
            },
            createMarker: function() { return null; } 
        }).addTo(map);
    }
}

function clearRouting() {
    if (routingControl && map) {
        map.removeControl(routingControl);
        routingControl = null;
    }
}
