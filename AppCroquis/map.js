const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;

// --- CAPAS DISPONIBLES ---

// 1️⃣ Catastro oficial (WMS)
const catastroLayer = L.tileLayer.wms(
    "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?", {
        layers: "Catastro",
        format: "image/png",
        transparent: false,
        version: "1.1.1",
        attribution: "Dirección General del Catastro"
    }
);

// 2️⃣ Estándar color
const standardLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "OpenStreetMap"
    }
);

// 3️⃣ Escala de grises
const grayscaleLayer = L.tileLayer(
    "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: "Stadia Maps"
    }
);

// 4️⃣ Satélite
const satelliteLayer = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: "OpenTopoMap"
    }
);

// Añadir por defecto Catastro
currentLayer = catastroLayer.addTo(map);

// --- CAMBIO DINÁMICO DE CAPA ---

document.getElementById("mapSelector").addEventListener("change", function (e) {

    map.removeLayer(currentLayer);

    switch (e.target.value) {
        case "catastro":
            currentLayer = catastroLayer;
            break;
        case "standard":
            currentLayer = standardLayer;
            break;
        case "grayscale":
            currentLayer = grayscaleLayer;
            break;
        case "satellite":
            currentLayer = satelliteLayer;
            break;
    }

    currentLayer.addTo(map);
});

// Ajuste de tamaño
setTimeout(function () {
    map.invalidateSize();
}, 200);