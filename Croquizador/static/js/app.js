// Map Initialization
const SOLLER_LAT = 39.7670;
const SOLLER_LON = 2.7150;

// Allow zooming far beyond native resolution (overscaling)
const map = L.map('map').setView([SOLLER_LAT, SOLLER_LON], 18);

// Tile Layers
const layers = {
    catastro: L.tileLayer.wms('http://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx', {
        layers: 'Catastro',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        maxZoom: 23,
        maxNativeZoom: 20,
        attribution: '© Dirección General del Catastro',
        crossOrigin: true
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 23,
        maxNativeZoom: 19,
        attribution: '© OpenStreetMap',
        crossOrigin: true
    }),
    carto: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 23,
        maxNativeZoom: 20,
        attribution: '© CartoDB',
        crossOrigin: true
    }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 23,
        maxNativeZoom: 19,
        attribution: '© Esri',
        crossOrigin: true
    })
};

// Add default
layers.catastro.addTo(map);

// Coordinate display
map.on('moveend', function () {
    const center = map.getCenter();
    const coordsDisplay = document.getElementById('coordsDisplay');
    if (coordsDisplay) {
        coordsDisplay.innerText = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    }
});
// Init coords if element exists
const coordsDisplay = document.getElementById('coordsDisplay');
if (coordsDisplay) {
    coordsDisplay.innerText = `${SOLLER_LAT.toFixed(5)}, ${SOLLER_LON.toFixed(5)}`;
}


function changeMapStyle() {
    const style = document.getElementById('mapStyle').value;
    Object.values(layers).forEach(layer => map.removeLayer(layer));
    if (layers[style]) {
        layers[style].addTo(map);
    }
}

function applyScale() {
    const scale = parseInt(document.getElementById('scaleInput').value);
    if (!scale || scale <= 0) return;

    let targetZoom = 19;
    if (scale <= 100) targetZoom = 22;
    else if (scale <= 200) targetZoom = 21;
    else if (scale <= 500) targetZoom = 20;
    else if (scale <= 1000) targetZoom = 19;
    else targetZoom = 17;

    map.setZoom(targetZoom);
}

// Add Scale Control
L.control.scale({ imperial: false }).addTo(map);

// Screenshoter Plugin Init
const snapshotOptions = {
    hideElementsWithSelectors: [
        ".leaflet-control-container",
        ".leaflet-dont-include-pane",
        "#snapshot-button"
    ],
    hidden: false // WYSIWYG: Capture what the user sees to ensure correct Aspect Ratio
};
const screenshoter = L.simpleMapScreenshoter(snapshotOptions).addTo(map);

let selectedFilePath = null;

// --- New Auto Search Logic ---

async function searchTownOnly() {
    const town = document.getElementById('town').value;
    if (!town) return;

    const query = `${town}, Illes Balears, Spain`;
    // We just fly there
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
            const lat = data[0].lat;
            const lon = data[0].lon;
            map.flyTo([lat, lon], 15);
        }
    } catch (e) {
        console.error("Town search error", e);
    }
}

let debounceTimer;
async function autocompleteStreets() {
    const input = document.getElementById('street');
    const town = document.getElementById('town').value || "Sóller";
    const val = input.value;

    if (val.length < 3) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        // Search strictly for names in the town
        const query = `${val}, ${town}, Illes Balears, Spain`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=10`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            const list = document.getElementById('streets-list');
            list.innerHTML = '';

            const names = new Set();
            data.forEach(item => {
                // Try to get road name
                let name = item.address?.road || item.display_name.split(',')[0];
                if (name && !names.has(name)) {
                    names.add(name);
                    const opt = document.createElement('option');
                    opt.value = name;
                    list.appendChild(opt);
                }
            });
        } catch (e) {
            console.error("Autocomplete error", e);
        }
    }, 400);
}
// -----------------------------

async function searchLocation() {
    const town = document.getElementById('town').value || "Sóller";
    const street = document.getElementById('street').value;
    const number = document.getElementById('numbers').value;

    const searchBtn = document.querySelector('button[onclick="searchLocation()"]');
    if (searchBtn) {
        searchBtn.disabled = true;
        searchBtn.innerText = "Buscando...";
    }

    if (!street) {
        alert("Por favor, introduce el nombre de la calle.");
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.innerText = "Buscar 🔍";
        }
        return;
    }

    let url = '';
    let query = '';

    if (number) {
        // Structured Search (More precise for house numbers)
        query = `${street} ${number}, ${town}`;
        const params = new URLSearchParams({
            street: street,
            housenumber: number,
            city: town,
            state: 'Illes Balears',
            country: 'Spain',
            format: 'json',
            limit: 1
        });
        url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    } else {
        // Free-text Search (Better for streets without numbers)
        query = `${street}, ${town}, Illes Balears, Spain`;
        url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    }

    try {
        let response = await fetch(url);
        let data = await response.json();

        // FAILSAFE: If structured search failed, try loose search (Street only)
        if (data.length === 0 && number) {
            console.warn("Structured search failed. Falling back to street search.");
            const queryFallback = `${street}, ${town}, Illes Balears, Spain`;
            const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryFallback)}`;

            response = await fetch(fallbackUrl);
            data = await response.json();

            if (data.length > 0) {
                alert("⚠️ No se encontró el número exacto en el mapa.\n\nSe mostrará el centro de la calle. Por favor, arrastra el marcador hasta la casa correcta.");
            }
        }

        if (data && data.length > 0) {
            const lat = data[0].lat;
            const lon = data[0].lon;
            map.flyTo([lat, lon], 20);

            const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
            marker.bindPopup(`<b>${query}</b><br><span style="font-size: 0.8em; color: #666;">(Arrastra para corregir ubicación)</span>`).openPopup();

            // Update coords logic on drag
            marker.on('drag', function (e) {
                const pos = e.target.getLatLng();
                const coordsDisplay = document.getElementById('coordsDisplay');
                if (coordsDisplay) {
                    coordsDisplay.innerText = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
                }
            });
        } else {
            alert("No se encontró la ubicación. Intenta ser más específico.");
        }
    } catch (e) {
        console.error(e);
        alert("Error al buscar la ubicación.");
    } finally {
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.innerText = "Buscar 🔍";
        }
    }
}


async function processMap() {
    // Hardcoded target file
    const targetFile = "PLANIFICADOR.svg";

    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Capturando mapa (WYSIWYG)...";
    statusDiv.className = "mt-3 text-xs text-center font-mono font-medium text-blue-600";

    try {
        // High Quality Capture using dom-to-image
        // This captures the DOM exactly as seen, preserving proportionality
        const mapNode = document.getElementById('map');

        // Force dimensions to match current display to avoid any re-layout issues during capture
        const width = mapNode.offsetWidth;
        const height = mapNode.offsetHeight;

        const options = {
            width: width,
            height: height,
            quality: 1.0,
            filter: (node) => {
                // Return true to include, false to exclude
                if (node.nodeType === 1 && node.classList) {
                    // Hide Controls (Zoom, Attribution, Scale)
                    if (node.classList.contains('leaflet-control-container')) return false;
                    // Hide Popups (Location Address Text)
                    if (node.classList.contains('leaflet-popup-pane')) return false;
                    // Hide Markers (The Pin) as requested
                    if (node.classList.contains('leaflet-marker-pane')) return false;
                    // Hide Shadows (The black mark underneath)
                    if (node.classList.contains('leaflet-shadow-pane')) return false;
                }
                return true;
            }
        };

        const base64Image = await domtoimage.toPng(mapNode, options);

        statusDiv.innerText = "Procesando e iniciando Inkscape...";

        const response = await fetch('/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                svg_path: targetFile,
                image_data: base64Image
            })
        });

        const result = await response.json();

        if (result.success) {
            statusDiv.innerText = "¡Éxito! Abriendo Inkscape...";
            statusDiv.className = "mt-3 text-xs text-center font-mono font-medium text-emerald-600";
        } else {
            statusDiv.innerText = "Error: " + result.message;
            statusDiv.className = "mt-3 text-xs text-center font-mono font-medium text-red-600";
        }

    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Error general.";
        statusDiv.className = "mt-3 text-xs text-center font-mono font-medium text-red-600";
    }
}

async function openCapturesFolder() {
    try {
        await fetch('/open-captures', { method: 'POST' });
    } catch (e) {
        console.error(e);
    }
}
