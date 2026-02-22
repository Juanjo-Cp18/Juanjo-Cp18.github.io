const map = L.map('map').setView([40.4168, -3.7038], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

let drawnLine = null;

map.on('click', function(e) {
    if (!drawnLine) {
        drawnLine = L.polyline([e.latlng], {color: 'red'}).addTo(map);
    } else {
        drawnLine.addLatLng(e.latlng);
    }
});