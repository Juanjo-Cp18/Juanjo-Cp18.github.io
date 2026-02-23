const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;
let drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

let selectedLayer = null;

/* ===========================
   CAPAS BASE
=========================== */

const catastroLayer = L.tileLayer.wms(
    "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?", {
        layers: "Catastro",
        format: "image/png",
        transparent: false,
        version: "1.1.1"
    }
);

const standardLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
);

const grayscaleLayer = L.tileLayer(
    "https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png"
);

const satelliteLayer = L.tileLayer.wms(
    "https://www.ign.es/wms-inspire/pnoa-ma?", {
        layers: "OI.OrthoimageCoverage",
        format: "image/jpeg",
        transparent: false,
        version: "1.3.0"
    }
);

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

map.on(L.Draw.Event.CREATED, function (event) {

    drawnItems.clearLayers();
    selectedLayer = event.layer;
    drawnItems.addLayer(selectedLayer);

    const latlngs = selectedLayer.getLatLngs();
    let totalDistance = 0;

    for (let i = 0; i < latlngs.length - 1; i++) {
        totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
    }

    alert("Longitud del tramo: " + totalDistance.toFixed(2) + " metros");
});

/* ===========================
   GENERAR SVG
=========================== */

document.getElementById("generateBtn").addEventListener("click", async function () {

    if (!selectedLayer) {
        alert("Debe dibujar un tramo primero.");
        return;
    }

    const scale = parseInt(document.getElementById("scale").value);
    const latlngs = selectedLayer.getLatLngs();

    // Punto origen
    const origin = latlngs[0];

    let svgPath = "";
    let minX = Infinity;
    let minY = Infinity;

    let coords = [];

    for (let i = 0; i < latlngs.length; i++) {

        const dx = origin.distanceTo([origin.lat, latlngs[i].lng]);
        const dy = origin.distanceTo([latlngs[i].lat, origin.lng]);

        const xMeters = latlngs[i].lng >= origin.lng ? dx : -dx;
        const yMeters = latlngs[i].lat >= origin.lat ? -dy : dy;

        const xMM = (xMeters / scale) * 1000;
        const yMM = (yMeters / scale) * 1000;

        coords.push({x: xMM, y: yMM});

        minX = Math.min(minX, xMM);
        minY = Math.min(minY, yMM);
    }

    // Normalizar coordenadas
    coords = coords.map(p => ({
        x: p.x - minX + 100,
        y: p.y - minY + 100
    }));

    coords.forEach((p, index) => {
        if (index === 0) {
            svgPath += `M ${p.x} ${p.y} `;
        } else {
            svgPath += `L ${p.x} ${p.y} `;
        }
    });

    const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
    <g id="TRAMO_MAPA">
        <path d="${svgPath}" stroke="black" stroke-width="0.8" fill="none"/>
    </g>
</svg>
`;

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "croquis_tramo.svg";
    a.click();

    URL.revokeObjectURL(url);
});

// Ajuste tamaño
setTimeout(function () {
    map.invalidateSize();
}, 200);