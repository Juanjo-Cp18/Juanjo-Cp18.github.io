document.addEventListener("DOMContentLoaded", function () {

// ===============================
// INICIALIZACIÓN
// ===============================

const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 16
});

let currentLayer;
let selectedRectangle = null;

// ===============================
// CAPAS
// ===============================

const catastroLayer = L.tileLayer.wms(
    "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?", {
        layers: "Catastro",
        format: "image/png",
        version: "1.1.1"
    }
);

currentLayer = catastroLayer.addTo(map);

// ===============================
// DIBUJO RECTÁNGULO
// ===============================

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    draw: {
        rectangle: true,
        polygon: false,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false
    },
    edit: { featureGroup: drawnItems }
});

map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (event) {
    drawnItems.clearLayers();
    selectedRectangle = event.layer;
    drawnItems.addLayer(selectedRectangle);
});

// ===============================
// EXPORTACIÓN
// ===============================

const generateBtn = document.getElementById("generateBtn");

generateBtn.addEventListener("click", async function () {

    console.log("Botón pulsado");

    if (!selectedRectangle) {
        alert("Debe dibujar un rectángulo primero.");
        return;
    }

    const bounds = selectedRectangle.getBounds();

    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();
    const minLng = bounds.getWest();
    const maxLng = bounds.getEast();

    const usableWidthMM = 277;
    const usableHeightMM = 190;

    const widthPx = 1400;
    const heightPx = Math.round(widthPx * (usableHeightMM / usableWidthMM));

    const wmsUrl =
        "https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx?" +
        "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap" +
        "&LAYERS=Catastro" +
        "&FORMAT=image/png" +
        "&SRS=EPSG:4326" +
        "&BBOX=" + minLng + "," + minLat + "," + maxLng + "," + maxLat +
        "&WIDTH=" + widthPx +
        "&HEIGHT=" + heightPx;

    const imageResponse = await fetch(wmsUrl);
    const blob = await imageResponse.blob();

    const reader = new FileReader();

    reader.onloadend = async function () {

        const base64data = reader.result;

        const templateResponse = await fetch("PLANIFICADOR.svg");
        const templateText = await templateResponse.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(templateText, "image/svg+xml");

        const svgElement = xmlDoc.documentElement;

        const image = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "image");
        image.setAttributeNS(null, "href", base64data);
        image.setAttribute("x", "10");
        image.setAttribute("y", "10");
        image.setAttribute("width", "277");
        image.setAttribute("height", "190");

        svgElement.appendChild(image);

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

});