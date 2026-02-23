const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;
let drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

/* ===========================
   CAPAS BASE
=========================== */

// Catastro oficial
const catastroLayer = L.tileLayer.wms(
    "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?", {
        layers: "Catastro",
        format: "image/png",
        transparent: false,
        version: "1.1.1"
    }
);

// OpenStreetMap estándar
const standardLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
);

// Escala de grises
const grayscaleLayer = L.tileLayer(
    "https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png"
);

// Satélite IGN (PNOA)
const satelliteLayer = L.tileLayer.wms(
    "https://www.ign.es/wms-inspire/pnoa-ma?", {
        layers: "OI.OrthoimageCoverage",
        format: "image/jpeg",
        transparent: false,
        version: "1.3.0"
    }
);

// Capa inicial
currentLayer = catastroLayer.addTo(map);

/* ===========================
   CAMBIO DE CAPA
=========================== */

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

/* ===========================
   HERRAMIENTA DE DIBUJO
=========================== */

const drawControl = new L.Control.Draw({
    draw: {
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
        polyline: {
            shapeOptions: {
                color: '#ff0000',
                weight: 4
            }
        }
    },
    edit: {
        featureGroup: drawnItems
    }
});

map.addControl(drawControl);

// Evento al crear tramo
map.on(L.Draw.Event.CREATED, function (event) {

    drawnItems.clearLayers();
    const layer = event.layer;
    drawnItems.addLayer(layer);

    const latlngs = layer.getLatLngs();
    let totalDistance = 0;

    for (let i = 0; i < latlngs.length - 1; i++) {
        totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
    }

    alert("Longitud del tramo: " + totalDistance.toFixed(2) + " metros");
});

// Ajuste tamaño
setTimeout(function () {
    map.invalidateSize();
}, 200);