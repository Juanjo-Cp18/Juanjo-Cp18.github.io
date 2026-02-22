// Inicializar mapa

const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 15
});

// Capa base oscura compatible con el diseño
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// Forzar recalculo tamaño tras carga
setTimeout(() => {
    map.invalidateSize();
}, 200);