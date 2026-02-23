const map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 15
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

setTimeout(function () {
    map.invalidateSize();
}, 200);