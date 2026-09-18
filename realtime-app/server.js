const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-Memory Cache (TTL: 15 minutes)
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

// Curated list of popular Greek & Mediterranean kitesurf/windsurf spots with spot_ids
const POPULAR_SPOTS = [
  { id_spot: 105316, name: "Aggelohori (Αγγελοχώρι)", lat: 40.516667, lon: 22.783333, country: "Greece", region: "Thessaloniki" },
  { id_spot: 49321, name: "Lefkada - Agios Ioannis (Άγιος Ιωάννης)", lat: 38.841, lon: 20.678, country: "Greece", region: "Ionian" },
  { id_spot: 49320, name: "Vassiliki (Βασιλική Λευκάδας)", lat: 38.629, lon: 20.607, country: "Greece", region: "Ionian" },
  { id_spot: 49363, name: "Rhodes - Prasonisi (Πρασονήσι Ρόδου)", lat: 35.881, lon: 27.766, country: "Greece", region: "Dodecanese" },
  { id_spot: 49354, name: "Paros - Pounta (Πούντα Πάρου)", lat: 37.042, lon: 25.108, country: "Greece", region: "Cyclades" },
  { id_spot: 49353, name: "Naxos - Mikri Vigla (Μικρή Βίγλα)", lat: 37.026, lon: 25.372, country: "Greece", region: "Cyclades" },
  { id_spot: 367292, name: "Epanomi - Fanari (Επανομή Φανάρι)", lat: 40.385, lon: 22.889, country: "Greece", region: "Thessaloniki" },
  { id_spot: 49316, name: "Artemida - Loutsa (Αρτέμιδα/Λούτσα)", lat: 37.966, lon: 24.016, country: "Greece", region: "Attica" },
  { id_spot: 187747, name: "Lemnos - Keros (Κέρος Λήμνου)", lat: 39.897, lon: 25.321, country: "Greece", region: "North Aegean" },
  { id_spot: 49358, name: "Karpathos - Afiartis (Αφιάρτης Καρπάθου)", lat: 35.421, lon: 27.145, country: "Greece", region: "Dodecanese" },
  { id_spot: 49339, name: "Crete - Elafonisi (Ελαφόνησος Χανίων)", lat: 35.271, lon: 23.541, country: "Greece", region: "Crete" },
  { id_spot: 49325, name: "Drepano (Δρέπανο Αχαΐας)", lat: 38.336, lon: 21.852, country: "Greece", region: "Peloponnese" }
];

const MODELS_CONFIG = [
  { key: "aladin", id_model: 107, name: "ALADIN 2.3", expected_model: "alace" },
  { key: "zephr", id_model: 64, name: "Zephr-HD 2.6", expected_model: "swrfeu" },
  { key: "wrf3", id_model: 98, name: "WRF 3", expected_model: "wrfgri" },
  { key: "ifs", id_model: 117, name: "IFS-HRES 9", expected_model: "ifs" },
  { key: "gfs", id_model: 3, name: "GFS 13", expected_model: "gfs" }
];

const HOSTS = [
  "https://www.windguru.cz/int/iapi.php",
  "https://www.windguru.net/int/iapi.php"
];

function getCompassDirection(deg) {
  if (deg === null || deg === undefined) return null;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.floor(((parseFloat(deg) + 11.25) % 360) / 22.5)];
}

function knotsToBeaufort(knots) {
  if (knots === null || knots === undefined) return null;
  const k = parseFloat(knots);
  if (k < 1) return 0;
  if (k < 4) return 1;
  if (k < 7) return 2;
  if (k < 11) return 3;
  if (k < 17) return 4;
  if (k < 22) return 5;
  if (k < 28) return 6;
  if (k < 34) return 7;
  if (k < 41) return 8;
  if (k < 48) return 9;
  if (k < 56) return 10;
  if (k < 64) return 11;
  return 12;
}

// Calculate distance between two lat/lon coordinates in km (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function findNearestSpot(lat, lon) {
  let nearest = POPULAR_SPOTS[0];
  let minDistance = haversineDistance(lat, lon, nearest.lat, nearest.lon);
  
  for (const spot of POPULAR_SPOTS) {
    const dist = haversineDistance(lat, lon, spot.lat, spot.lon);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = spot;
    }
  }
  return { spot: nearest, distance_km: Math.round(minDistance * 10) / 10 };
}

function findRundef(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.rundef === 'string' && obj.rundef.trim()) return obj.rundef.trim();
  
  for (const key of Object.keys(obj)) {
    const found = findRundef(obj[key]);
    if (found) return found;
  }
  return null;
}

async function fetchFromWindguru(params, spotId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `https://www.windguru.cz/${spotId || 105316}`,
    'Accept': 'application/json,text/plain,*/*'
  };

  let lastError = null;
  for (const host of HOSTS) {
    try {
      const response = await axios.get(host, { params, headers, timeout: 10000 });
      if (response.data && response.data.return === 'error') {
        throw new Error(`Windguru error: ${response.data.message}`);
      }
      return response.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to reach Windguru servers");
}

async function fetchCurrentRundef(spotId, idModel) {
  try {
    const data = await fetchFromWindguru({
      q: 'wg_model',
      id_model: idModel,
      WGCACHEABLE: 0,
      cachefix: Date.now()
    }, spotId);
    return findRundef(data);
  } catch (err) {
    console.warn(`[Rundef Warning] spot ${spotId}, model ${idModel}:`, err.message);
    return null;
  }
}

async function fetchModelForecast(spotId, modelConfig) {
  const rundef = await fetchCurrentRundef(spotId, modelConfig.id_model);
  const params = {
    q: 'forecast',
    id_model: modelConfig.id_model,
    id_spot: spotId,
    ai: 1,
    WGCACHEABLE: 0,
    cachefix: Date.now()
  };
  if (rundef) params.rundef = rundef;

  const rawData = await fetchFromWindguru(params, spotId);
  return normalizeForecastPayload(rawData, modelConfig, spotId);
}

function normalizeForecastPayload(payload, modelConfig, spotId) {
  const fcst = payload.fcst;
  if (!fcst || !Array.isArray(fcst.hours) || fcst.initstamp === undefined) {
    throw new Error("Invalid forecast payload structure from Windguru");
  }

  const initUtc = new Date(parseInt(fcst.initstamp) * 1000);
  const wgmodel = payload.wgmodel || {};

  const hourlyPoints = fcst.hours.map((hourOffset, i) => {
    const pointUtc = new Date(initUtc.getTime() + parseFloat(hourOffset) * 3600 * 1000);
    const windKnots = fcst.WINDSPD ? fcst.WINDSPD[i] : null;
    const gustKnots = fcst.GUST ? fcst.GUST[i] : null;
    const directionDeg = fcst.WINDDIR ? fcst.WINDDIR[i] : null;
    const precip = fcst.APCP1 ? fcst.APCP1[i] : (fcst.APCP ? fcst.APCP[i] : null);

    return {
      hour_offset: parseFloat(hourOffset),
      time_iso: pointUtc.toISOString(),
      time_formatted: pointUtc.toLocaleString('el-GR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      wind_knots: windKnots,
      wind_beaufort: knotsToBeaufort(windKnots),
      wind_ms: windKnots !== null ? Math.round(windKnots * 0.514444 * 10) / 10 : null,
      wind_kmh: windKnots !== null ? Math.round(windKnots * 1.852 * 10) / 10 : null,
      gust_knots: gustKnots,
      gust_beaufort: knotsToBeaufort(gustKnots),
      direction_deg: directionDeg,
      direction_compass: getCompassDirection(directionDeg),
      temperature_c: fcst.TMP ? fcst.TMP[i] : null,
      pressure_hpa: fcst.SLP ? fcst.SLP[i] : null,
      relative_humidity_pct: fcst.RH ? fcst.RH[i] : null,
      cloud_pct: fcst.TCDC ? fcst.TCDC[i] : null,
      precip_mm: precip
    };
  });

  return {
    spot: {
      id_spot: parseInt(spotId),
      name: payload.spotname || payload.target?.spotname || `Spot #${spotId}`,
      lat: payload.lat ? parseFloat(payload.lat) : null,
      lon: payload.lon ? parseFloat(payload.lon) : null,
      alt: payload.alt ? parseInt(payload.alt) : 0,
      sunrise: payload.sunrise || null,
      sunset: payload.sunset || null
    },
    model: {
      key: modelConfig.key,
      id_model: modelConfig.id_model,
      name: fcst.model_name || wgmodel.model_name || modelConfig.name,
      long_name: fcst.model_longname || wgmodel.model_longname || modelConfig.name,
      resolution_km: wgmodel.resolution_real || wgmodel.resolution || null,
      init_time_utc: initUtc.toISOString()
    },
    fetched_at: new Date().toISOString(),
    forecast: hourlyPoints
  };
}

// REST API Endpoints

// 1. Get List of Popular / Preserved Spots
app.get('/api/spots/popular', (req, res) => {
  res.json({
    count: POPULAR_SPOTS.length,
    spots: POPULAR_SPOTS
  });
});

// 2. Search / Nearest Spot by lat & lon
app.get('/api/spots/resolve', (req, res) => {
  const { lat, lon, spot_id, query } = req.query;

  if (spot_id) {
    const matched = POPULAR_SPOTS.find(s => s.id_spot === parseInt(spot_id));
    return res.json({
      resolved_spot: matched || { id_spot: parseInt(spot_id), name: `Spot #${spot_id}`, lat: null, lon: null },
      source: matched ? "popular_database" : "custom_spot_id"
    });
  }

  if (lat && lon) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      return res.status(400).json({ error: "Invalid lat/lon coordinates" });
    }

    const { spot, distance_km } = findNearestSpot(latNum, lonNum);
    return res.json({
      resolved_spot: {
        ...spot,
        requested_coords: { lat: latNum, lon: lonNum }
      },
      distance_km,
      source: "nearest_geo_lookup"
    });
  }

  if (query) {
    const qLower = query.toLowerCase();
    const matches = POPULAR_SPOTS.filter(s => s.name.toLowerCase().includes(qLower) || s.region.toLowerCase().includes(qLower));
    return res.json({
      count: matches.length,
      spots: matches
    });
  }

  res.status(400).json({ error: "Provide spot_id, lat&lon, or query" });
});

// 3. Main Real-time Forecast Endpoint
app.get('/api/forecast', async (req, res) => {
  try {
    let { spot_id, lat, lon, model } = req.query;

    let targetSpotId = spot_id ? parseInt(spot_id) : null;
    let locationInfo = null;

    if (!targetSpotId && lat && lon) {
      const resolved = findNearestSpot(parseFloat(lat), parseFloat(lon));
      targetSpotId = resolved.spot.id_spot;
      locationInfo = { requested_lat: parseFloat(lat), requested_lon: parseFloat(lon), nearest_spot: resolved.spot.name, distance_km: resolved.distance_km };
    }

    if (!targetSpotId) {
      targetSpotId = 105316; // Default to Aggelohori
    }

    const requestedModelKey = (model || 'aladin').toLowerCase();
    const modelConfig = MODELS_CONFIG.find(m => m.key === requestedModelKey) || MODELS_CONFIG[0];

    const cacheKey = `fcst:${targetSpotId}:${modelConfig.id_model}`;
    const cachedEntry = cache.get(cacheKey);

    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
      return res.json({
        ...cachedEntry.data,
        cache_status: "HIT",
        cache_age_seconds: Math.round((Date.now() - cachedEntry.timestamp) / 1000),
        location_meta: locationInfo
      });
    }

    // Fetch fresh data from Windguru iapi
    const resultData = await fetchModelForecast(targetSpotId, modelConfig);

    // Save to cache
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: resultData
    });

    res.json({
      ...resultData,
      cache_status: "MISS (FRESH_REALTIME)",
      location_meta: locationInfo
    });

  } catch (err) {
    console.error("[Forecast API Error]:", err.message);
    res.status(500).json({
      error: "Failed to fetch real-time forecast",
      message: err.message
    });
  }
});

// Serve frontend assets in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Windguru Real-time Forecast API running on http://localhost:${PORT}`);
});
