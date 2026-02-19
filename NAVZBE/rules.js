// Título: Configuración de Reglas de Tráfico
// Fecha: 19/2/2026, 13:21:58
// Descarga este archivo al directorio de tu proyecto (reemplazando el anterior) para guardar los cambios.

const PRELOADED_RULES = [
    {
        "angle": 308,
        "id": 1769900715703,
        "lat": 39.510857015820754,
        "lng": 2.544880735136102,
        "type": "forbidden"
    },
    {
        "angle": 170,
        "id": 1770139370135.0154,
        "lat": 39.767311,
        "lng": 2.7193012,
        "type": "forbidden"
    },
    {
        "angle": 84,
        "id": 1770139370135.0374,
        "lat": 39.7654887,
        "lng": 2.7167884,
        "type": "forbidden"
    },
    {
        "angle": 163,
        "id": 1770139370135.0662,
        "lat": 39.7657121,
        "lng": 2.7164862,
        "type": "forbidden"
    },
    {
        "angle": 333,
        "id": 1770139370135.1125,
        "lat": 39.7622517,
        "lng": 2.7117858,
        "type": "forbidden"
    },
    {
        "angle": 242,
        "id": 1770139370135.1262,
        "lat": 39.7654561,
        "lng": 2.7165888,
        "type": "forbidden"
    },
    {
        "angle": 56,
        "id": 1770139370135.2656,
        "lat": 39.7645419,
        "lng": 2.7162487,
        "type": "forbidden"
    },
    {
        "angle": 249,
        "id": 1770139370135.3472,
        "lat": 39.7674687,
        "lng": 2.7198234,
        "type": "forbidden"
    },
    {
        "angle": 83,
        "id": 1770139370135.3586,
        "lat": 39.7656072,
        "lng": 2.7182849,
        "type": "forbidden"
    },
    {
        "angle": 259,
        "id": 1770139370135.4036,
        "lat": 39.7657682,
        "lng": 2.7196643,
        "type": "forbidden"
    },
    {
        "angle": 41,
        "id": 1770139370135.4446,
        "lat": 39.7637702,
        "lng": 2.7184364,
        "type": "forbidden"
    },
    {
        "angle": 82,
        "id": 1770139370135.4595,
        "lat": 39.7656663,
        "lng": 2.7189191,
        "type": "forbidden"
    },
    {
        "angle": 351,
        "id": 1770139370135.5454,
        "lat": 39.7658047,
        "lng": 2.7199637,
        "type": "forbidden"
    },
    {
        "angle": 351,
        "id": 1770139370135.5564,
        "lat": 39.766476,
        "lng": 2.718916,
        "type": "forbidden"
    },
    {
        "angle": 68,
        "id": 1770139370135.5767,
        "lat": 39.7678655,
        "lng": 2.719741,
        "type": "forbidden"
    },
    {
        "angle": 10,
        "id": 1770139370135.5833,
        "lat": 39.7629881,
        "lng": 2.714493,
        "type": "forbidden"
    },
    {
        "angle": 247,
        "id": 1770139370135.5884,
        "lat": 39.7667345,
        "lng": 2.717385,
        "type": "forbidden"
    },
    {
        "angle": 147,
        "id": 1770139370135.9417,
        "lat": 39.7653384,
        "lng": 2.715594,
        "type": "forbidden"
    },
    {
        "angle": 157,
        "id": 1770139370135.9587,
        "lat": 39.7663392,
        "lng": 2.716297,
        "type": "forbidden"
    },
    {
        "angle": 356,
        "id": 1770139370135.9785,
        "lat": 39.7679286,
        "lng": 2.7188172,
        "type": "forbidden"
    },
    {
        "angle": 351,
        "id": 1770139370136.2551,
        "lat": 39.7656849,
        "lng": 2.7190811,
        "type": "forbidden"
    },
    {
        "angle": 333,
        "id": 1770139370136.2817,
        "lat": 39.7666013,
        "lng": 2.717472,
        "type": "forbidden"
    },
    {
        "angle": 249,
        "id": 1770139370136.383,
        "lat": 39.7670412,
        "lng": 2.7208399,
        "type": "forbidden"
    },
    {
        "angle": 150,
        "id": 1770999363196,
        "lat": 39.76841579441031,
        "lng": 2.712155776850041,
        "type": "forbidden"
    },
    {
        "angle": 234,
        "id": 1770999462017,
        "lat": 39.765962477849975,
        "lng": 2.712991047312916,
        "type": "forbidden"
    },
    {
        "angle": 324,
        "id": 1770999496196,
        "lat": 39.76600981484652,
        "lng": 2.713010073930198,
        "type": "forbidden"
    },
    {
        "angle": 260,
        "id": 1770999518061,
        "lat": 39.765976827395896,
        "lng": 2.7134416824140306,
        "type": "forbidden"
    },
    {
        "angle": 229,
        "id": 1770999552046,
        "lat": 39.76621804776379,
        "lng": 2.71389474574804,
        "type": "forbidden"
    },
    {
        "angle": 254,
        "id": 1770999598198,
        "lat": 39.76648400770265,
        "lng": 2.714645369198197,
        "type": "forbidden"
    },
    {
        "angle": 51,
        "id": 1770999648313,
        "lat": 39.76432949647956,
        "lng": 2.7133906526889455,
        "type": "forbidden"
    },
    {
        "angle": 43,
        "id": 1770999666815,
        "lat": 39.76371921119144,
        "lng": 2.712682922007366,
        "type": "forbidden"
    },
    {
        "angle": 46,
        "id": 1770999680967,
        "lat": 39.76283676208814,
        "lng": 2.7115462636400167,
        "type": "forbidden"
    },
    {
        "angle": 0,
        "id": 1770999741965,
        "lat": 39.761005850306255,
        "lng": 2.7114703885713096,
        "type": "forbidden"
    },
    {
        "angle": 21,
        "id": 1770999773589,
        "lat": 39.76258109715098,
        "lng": 2.7112023087676733,
        "type": "forbidden"
    },
    {
        "angle": 27,
        "id": 1771503669073,
        "lat": 39.771172156084674,
        "lng": 2.7062496542930603,
        "type": "forbidden"
    }
];
