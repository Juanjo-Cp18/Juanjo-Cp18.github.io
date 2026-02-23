// ===============================
// INICIALIZACIÓN MAPA
// ===============================

const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;
let selectedLayer;

// ===============================
// CAPAS
// ===============================

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
        version: "1.3.0"
    }
);

currentLayer = catastroLayer.addTo(map);

document.getElementById("mapSelector").addEventListener("change", function (e) {

    map.removeLayer(currentLayer);

    switch (e.target.value) {
        case "catastro": currentLayer = catastroLayer; break;
        case "standard": currentLayer = standardLayer; break;
        case "grayscale": currentLayer = grayscaleLayer; break;
        case "satellite": currentLayer = satelliteLayer; break;
    }

    currentLayer.addTo(map);
});

// ===============================
// DIBUJO
// ===============================

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    draw: {
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
        polyline: true
    },
    edit: { featureGroup: drawnItems }
});

map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (event) {
    drawnItems.clearLayers();
    selectedLayer = event.layer;
    drawnItems.addLayer(selectedLayer);
});

// ===============================
// EXPORTACIÓN CORREGIDA
// ===============================

document.getElementById("generateBtn").addEventListener("click", async function () {

    if (!selectedLayer) {
        alert("Debe dibujar un tramo primero.");
        return;
    }

    const scale = parseInt(document.getElementById("scale").value);
    const latlngs = selectedLayer.getLatLngs();

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    latlngs.forEach(p => {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    const usableWidthMM = 277;
    const usableHeightMM = 190;

    const halfWidthMeters = (usableWidthMM / 1000) * scale / 2;
    const halfHeightMeters = (usableHeightMM / 1000) * scale / 2;

    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);

    const deltaLat = halfHeightMeters / metersPerDegreeLat;
    const deltaLng = halfWidthMeters / metersPerDegreeLng;

    const minLatFinal = centerLat - deltaLat;
    const maxLatFinal = centerLat + deltaLat;
    const minLngFinal = centerLng - deltaLng;
    const maxLngFinal = centerLng + deltaLng;

    const widthPx = 1400;
    const heightPx = Math.round(widthPx * (usableHeightMM / usableWidthMM));

    const wmsUrl =
        "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?" +
        "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap" +
        "&LAYERS=Catastro" +
        "&FORMAT=image/png" +
        "&SRS=EPSG:4326" +
        "&BBOX=" + minLngFinal + "," + minLatFinal + "," + maxLngFinal + "," + maxLatFinal +
        "&WIDTH=" + widthPx +
        "&HEIGHT=" + heightPx;

    const imageResponse = await fetch(wmsUrl);
    const blob = await imageResponse.blob();

    const reader = new FileReader();

    reader.onloadend = async function () {

        const base64data = reader.result;

        // Cargar plantilla real
        const templateResponse = await fetch("PLANIFICADOR.svg");
        const templateText = await templateResponse.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(templateText, "image/svg+xml");

        const svgElement = xmlDoc.documentElement;

        // Crear grupo contenedor
        const g = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("id", "MAPA_GENERADO");

        const image = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "image");
        image.setAttributeNS(null, "href", base64data);
        image.setAttribute("x", "10");
        image.setAttribute("y", "10");
        image.setAttribute("width", "277");
        image.setAttribute("height", "190");

        g.appendChild(image);
        svgElement.appendChild(g);

        const serializer = new XMLSerializer();
        const finalSvg = serializer.serializeToString(xmlDoc);

        const finalBlob = new Blob([finalSvg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(finalBlob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "croquis_catastral.svg";
        a.click();

        URL.revokeObjectURL(url);
    };

    reader.readAsDataURL(blob);
});