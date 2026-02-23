const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;

// 1️⃣ CATASTRO OFICIAL
const catastroLayer = L.tileLayer.wms(
    "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?", {
        layers: "Catastro",
        format: "image/png",
        transparent: false,
        version: "1.1.1",
        attribution: "Dirección General del Catastro"
    }
);

// 2️⃣ ESTÁNDAR COLOR
const standardLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
    }
);

// 3️⃣ TÉCNICO (ESCALA DE GRISES REAL)
const grayscaleLayer = L.tileLayer(
    "https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap (Grayscale)"
    }
);

// 4️⃣ SATÉLITE REAL (ORTOFOTO PNOA - IGN)
const satelliteLayer = L.tileLayer.wms(
    "https://www.ign.es/wms-inspire/pnoa-ma?", {
        layers: "OI.OrthoimageCoverage",
        format: "image/jpeg",
        transparent: false,
        version: "1.3.0",
        attribution: "Instituto Geográfico Nacional"
    }
);

// Capa por defecto
currentLayer = catastroLayer.addTo(map);

// Cambio dinámico
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

// Ajuste tamaño
setTimeout(function () {
    map.invalidateSize();
}, 200);