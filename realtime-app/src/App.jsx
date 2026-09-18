import React, { useState, useEffect } from 'react';
import { 
  Wind, Compass, MapPin, Search, Thermometer, CloudRain, 
  Code, RefreshCw, Copy, Check, Info, Layers, Navigation,
  Calendar, Gauge, ArrowUp, Download
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const MODELS = [
  { key: 'aladin', id_model: 107, name: 'ALADIN 2.3', desc: 'High-Res Aegean & Greece (2.3km)' },
  { key: 'zephr', id_model: 64, name: 'Zephr-HD', desc: 'Europe Super High-Res (2.6km)' },
  { key: 'wrf3', id_model: 98, name: 'WRF 3', desc: 'Weather Research & Forecasting (3km)' },
  { key: 'ifs', id_model: 117, name: 'IFS-HRES', desc: 'ECMWF Global High-Res (9km)' },
  { key: 'gfs', id_model: 3, name: 'GFS 13', desc: 'NOAA Global Model (13km)' },
];

function MapClickHandler({ onSelectCoords }) {
  useMapEvents({
    click(e) {
      onSelectCoords(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function App() {
  const [popularSpots, setPopularSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState({ id_spot: 105316, name: "Aggelohori (Αγγελοχώρι)", lat: 40.516667, lon: 22.783333 });
  const [currentCoords, setCurrentCoords] = useState({ lat: 40.516667, lon: 22.783333 });
  const [selectedModel, setSelectedModel] = useState('aladin');
  const [windUnit, setWindUnit] = useState('knots'); // 'knots', 'beaufort', 'ms', 'kmh'
  const [activeTab, setActiveTab] = useState('forecast'); // 'forecast', 'chart', 'json'
  
  const [forecastData, setForecastData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  // Fetch popular spots on mount
  useEffect(() => {
    fetch('/api/spots/popular')
      .then(res => res.json())
      .then(data => {
        if (data.spots) setPopularSpots(data.spots);
      })
      .catch(console.error);
  }, []);

  // Fetch forecast data whenever selectedSpot, currentCoords, or selectedModel changes
  useEffect(() => {
    fetchForecast();
  }, [selectedSpot.id_spot, currentCoords.lat, currentCoords.lon, selectedModel]);

  const fetchForecast = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/forecast?model=${selectedModel}`;
      if (selectedSpot && selectedSpot.id_spot) {
        url += `&spot_id=${selectedSpot.id_spot}`;
      } else {
        url += `&lat=${currentCoords.lat.toFixed(4)}&lon=${currentCoords.lon.toFixed(4)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Failed to load forecast');
      }
      const data = await res.json();
      setForecastData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMapClick = (lat, lon) => {
    setCurrentCoords({ lat, lon });
    // Resolve nearest spot
    fetch(`/api/spots/resolve?lat=${lat}&lon=${lon}`)
      .then(res => res.json())
      .then(data => {
        if (data.resolved_spot) {
          setSelectedSpot(data.resolved_spot);
        }
      })
      .catch(console.error);
  };

  const handleSpotSelect = (spot) => {
    setSelectedSpot(spot);
    setCurrentCoords({ lat: spot.lat, lon: spot.lon });
    setSearchQuery('');
  };

  const handleCustomSpotSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Check if user entered numbers as spot_id or lat,lon
    const numRegex = /^(\d{4,8})$/;
    const coordsRegex = /^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/;

    if (numRegex.test(searchQuery.trim())) {
      const spotId = parseInt(searchQuery.trim());
      setSelectedSpot({ id_spot: spotId, name: `Custom Spot #${spotId}` });
    } else if (coordsRegex.test(searchQuery.trim())) {
      const match = searchQuery.trim().match(coordsRegex);
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[3]);
      handleMapClick(lat, lon);
    } else {
      // Name search
      const matched = popularSpots.find(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
      if (matched) {
        handleSpotSelect(matched);
      } else {
        setError(`Δεν βρέθηκε προκαθορισμένο spot με όνομα "${searchQuery}". Δοκιμάστε να κάνετε κλικ στο χάρτη.`);
      }
    }
  };

  const getWindSpeedValue = (pt) => {
    if (!pt) return '-';
    if (windUnit === 'beaufort') return `${pt.wind_beaufort} Bft`;
    if (windUnit === 'ms') return `${pt.wind_ms} m/s`;
    if (windUnit === 'kmh') return `${pt.wind_kmh} km/h`;
    return `${pt.wind_knots} kts`;
  };

  const getGustSpeedValue = (pt) => {
    if (!pt) return '-';
    if (windUnit === 'beaufort') return `${pt.gust_beaufort} Bft`;
    if (windUnit === 'ms') return `${pt.gust_ms || Math.round(pt.gust_knots * 0.514 * 10)/10} m/s`;
    if (windUnit === 'kmh') return `${pt.gust_kmh || Math.round(pt.gust_knots * 1.852 * 10)/10} km/h`;
    return `${pt.gust_knots} kts`;
  };

  const getWindBgClass = (beaufort) => {
    if (beaufort === null || beaufort === undefined) return 'wind-bg-0';
    const b = Math.min(Math.max(beaufort, 0), 8);
    return `wind-bg-${b}`;
  };

  const copyJsonToClipboard = () => {
    if (!forecastData) return;
    navigator.clipboard.writeText(JSON.stringify(forecastData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadJson = () => {
    if (!forecastData) return;
    const blob = new Blob([JSON.stringify(forecastData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `windguru_forecast_${forecastData.spot?.id_spot}_${selectedModel}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentPt = forecastData?.forecast?.[0];

  return (
    <div className="app-container">
      
      {/* 🟢 HEADER */}
      <header className="glass-card" style={{ padding: '20px 28px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', padding: '10px', borderRadius: '12px', color: 'white' }}>
                <Wind size={28} />
              </div>
              <div>
                <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
                  Windguru Realtime API & Dashboard
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  Δυναμική πρόγνωση ανέμου σε real-time με βάση συντεταγμένες (Lat/Lon) & Spot IDs
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Status Badge */}
            {forecastData && (
              <span className={`badge ${forecastData.cache_status?.includes('HIT') ? 'badge-cache' : 'badge-live'}`}>
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                {forecastData.cache_status?.includes('HIT') ? `Cached (${forecastData.cache_age_seconds}s)` : 'Realtime Live'}
              </span>
            )}

            {/* Units Selector */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
              {['knots', 'beaufort', 'ms', 'kmh'].map(unit => (
                <button
                  key={unit}
                  onClick={() => setWindUnit(unit)}
                  className={`glass-button ${windUnit === unit ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: '7px', textTransform: 'uppercase' }}
                >
                  {unit === 'knots' ? 'Kts' : unit === 'beaufort' ? 'Bft' : unit === 'ms' ? 'm/s' : 'km/h'}
                </button>
              ))}
            </div>

            <button onClick={fetchForecast} className="glass-button" disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Ανανέωση
            </button>
          </div>
        </div>
      </header>

      {/* 🗺️ LOCATION SELECTOR & MAP SECTION */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        
        {/* Left: Search & Popular Spots */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin size={18} color="#3b82f6" /> Επιλογή Τοποθεσίας / Συντεταγμένων
          </h2>

          <form onSubmit={handleCustomSpotSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Αναζήτηση spot, ID (π.χ. 105316) ή 40.51, 22.78..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px',
                  padding: '10px 10px 10px 36px',
                  color: 'white',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.88rem'
                }}
              />
            </div>
            <button type="submit" className="glass-button active">
              Αναζήτηση
            </button>
          </form>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Δημοφιλή Spots Ελλάδας:
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
            {popularSpots.map(spot => (
              <button
                key={spot.id_spot}
                onClick={() => handleSpotSelect(spot)}
                className={`glass-button ${selectedSpot.id_spot === spot.id_spot ? 'active' : ''}`}
                style={{ fontSize: '0.78rem', padding: '5px 10px' }}
              >
                {spot.name.split(' ')[0]}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            <strong>Ενεργό Spot:</strong> {forecastData?.spot?.name || selectedSpot.name} <br />
            <strong>Συντεταγμένες:</strong> {currentCoords.lat.toFixed(4)}°, {currentCoords.lon.toFixed(4)}°
          </div>
        </div>

        {/* Right: Interactive Leaflet Map */}
        <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Navigation size={16} color="#06b6d4" /> Διαδραστικός Χάρτης (Κάντε κλικ οπουδήποτε)
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Lat: {currentCoords.lat.toFixed(3)}, Lon: {currentCoords.lon.toFixed(3)}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: '220px' }}>
            <MapContainer center={[currentCoords.lat, currentCoords.lon]} zoom={7} scrollWheelZoom={true} style={{ width: '100%', height: '100%', borderRadius: '12px' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapClickHandler onSelectCoords={handleMapClick} />
              <Marker position={[currentCoords.lat, currentCoords.lon]}>
                <Popup>{selectedSpot.name}</Popup>
              </Marker>
            </MapContainer>
          </div>
        </div>

      </div>

      {/* 📊 MODEL SELECTOR TABS */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '20px' }}>
        {MODELS.map(m => (
          <button
            key={m.key}
            onClick={() => setSelectedModel(m.key)}
            className={`glass-card ${selectedModel === m.key ? 'active-model' : ''}`}
            style={{
              padding: '12px 18px',
              border: selectedModel === m.key ? '1px solid #3b82f6' : '1px solid var(--bg-card-border)',
              background: selectedModel === m.key ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(6, 182, 212, 0.15))' : 'var(--bg-card)',
              borderRadius: '12px',
              cursor: 'pointer',
              color: 'white',
              textAlign: 'left',
              minWidth: '180px',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: selectedModel === m.key ? '#60a5fa' : 'white' }}>
              {m.name}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {m.desc}
            </div>
          </button>
        ))}
      </div>

      {/* 🔴 ERROR ALERT */}
      {error && (
        <div className="glass-card" style={{ padding: '16px', marginBottom: '20px', borderLeft: '4px solid #ef4444', background: 'rgba(239, 68, 68, 0.1)' }}>
          <strong style={{ color: '#fca5a5' }}>Σφάλμα:</strong> {error}
        </div>
      )}

      {/* 🌤️ CURRENT WEATHER SUMMARY CARDS */}
      {currentPt && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          
          {/* Wind Speed Card */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '8px' }}>
              <span>Ένταση Ανέμου</span>
              <Wind size={18} color="#60a5fa" />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#93c5fd' }}>
              {getWindSpeedValue(currentPt)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Μποφόρ: {currentPt.wind_beaufort} Bft
            </div>
          </div>

          {/* Wind Direction Card */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '8px' }}>
              <span>Διεύθυνση</span>
              <Compass size={18} color="#38bdf8" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div 
                className="compass-arrow" 
                style={{ 
                  transform: `rotate(${(currentPt.direction_deg || 0) + 180}deg)`,
                  background: 'rgba(56, 189, 248, 0.15)',
                  padding: '8px',
                  borderRadius: '50%',
                  border: '1px solid rgba(56, 189, 248, 0.4)'
                }}
              >
                <ArrowUp size={22} color="#38bdf8" />
              </div>
              <div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {currentPt.direction_compass || '-'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {currentPt.direction_deg}°
                </div>
              </div>
            </div>
          </div>

          {/* Gusts Card */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '8px' }}>
              <span>Ριπές (Gusts)</span>
              <Gauge size={18} color="#f59e0b" />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fcd34d' }}>
              {getGustSpeedValue(currentPt)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Μέγιστη ριπή μοντέλου
            </div>
          </div>

          {/* Temp & Rain Card */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '8px' }}>
              <span>Θερμοκρασία / Βροχή</span>
              <Thermometer size={18} color="#f43f5e" />
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
              {currentPt.temperature_c !== null ? `${currentPt.temperature_c}°C` : '-'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CloudRain size={14} color="#38bdf8" /> Βροχή: {currentPt.precip_mm || 0} mm
            </div>
          </div>

        </div>
      )}

      {/* 📌 MAIN VIEW TABS (Forecast Table vs Chart vs Raw JSON) */}
      <div className="glass-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('forecast')}
              className={`glass-button ${activeTab === 'forecast' ? 'active' : ''}`}
            >
              <Calendar size={16} /> Πίνακας Πρόγνωσης
            </button>
            <button
              onClick={() => setActiveTab('chart')}
              className={`glass-button ${activeTab === 'chart' ? 'active' : ''}`}
            >
              <Layers size={16} /> Διάγραμμα Ανέμου
            </button>
            <button
              onClick={() => setActiveTab('json')}
              className={`glass-button ${activeTab === 'json' ? 'active' : ''}`}
            >
              <Code size={16} /> Real-time JSON API
            </button>
          </div>

          {forecastData && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Μοντέλο: <strong>{forecastData.model?.name}</strong> | Spot: <strong>{forecastData.spot?.name}</strong>
            </div>
          )}
        </div>

        {/* TAB 1: HOURLY FORECAST TABLE */}
        {activeTab === 'forecast' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Ώρα / Ημερομηνία</th>
                  <th style={{ padding: '10px' }}>Άνεμος</th>
                  <th style={{ padding: '10px' }}>Ριπή (Gust)</th>
                  <th style={{ padding: '10px' }}>Διεύθυνση</th>
                  <th style={{ padding: '10px' }}>Temp</th>
                  <th style={{ padding: '10px' }}>Βροχή</th>
                  <th style={{ padding: '10px' }}>Σύννεφα</th>
                  <th style={{ padding: '10px' }}>Πίεση</th>
                </tr>
              </thead>
              <tbody>
                {forecastData?.forecast?.slice(0, 48).map((pt, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px', textAlign: 'left', fontWeight: 500 }}>
                      {pt.time_formatted}
                    </td>
                    <td style={{ padding: '6px' }}>
                      <span className={`badge ${getWindBgClass(pt.wind_beaufort)}`} style={{ width: '70px', justifyContent: 'center' }}>
                        {getWindSpeedValue(pt)}
                      </span>
                    </td>
                    <td style={{ padding: '6px' }}>
                      <span style={{ color: '#fcd34d', fontWeight: 600 }}>
                        {getGustSpeedValue(pt)}
                      </span>
                    </td>
                    <td style={{ padding: '6px' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <ArrowUp size={14} style={{ transform: `rotate(${(pt.direction_deg || 0) + 180}deg)` }} color="#38bdf8" />
                        <span>{pt.direction_compass}</span>
                      </div>
                    </td>
                    <td style={{ padding: '6px' }}>
                      {pt.temperature_c !== null ? `${pt.temperature_c}°C` : '-'}
                    </td>
                    <td style={{ padding: '6px', color: pt.precip_mm > 0 ? '#38bdf8' : 'var(--text-muted)' }}>
                      {pt.precip_mm ? `${pt.precip_mm} mm` : '-'}
                    </td>
                    <td style={{ padding: '6px', color: 'var(--text-muted)' }}>
                      {pt.cloud_pct !== null ? `${pt.cloud_pct}%` : '-'}
                    </td>
                    <td style={{ padding: '6px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                      {pt.pressure_hpa || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: WIND CHART */}
        {activeTab === 'chart' && (
          <div style={{ width: '100%', height: '360px', paddingTop: '10px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData?.forecast?.slice(0, 48) || []}>
                <defs>
                  <linearGradient id="colorWind" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorGust" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time_formatted" stroke="var(--text-muted)" fontSize={11} />
                <YAxis stroke="var(--text-muted)" fontSize={11} unit={` ${windUnit === 'knots' ? 'kts' : windUnit}`} />
                <Tooltip contentStyle={{ background: '#121826', borderColor: 'rgba(255,255,255,0.15)', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="gust_knots" name="Ριπή (kts)" stroke="#f59e0b" fillOpacity={1} fill="url(#colorGust)" />
                <Area type="monotone" dataKey="wind_knots" name="Άνεμος (kts)" stroke="#3b82f6" fillOpacity={1} fill="url(#colorWind)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TAB 3: REALTIME JSON API VIEW */}
        {activeTab === 'json' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', background: 'rgba(0,0,0,0.4)', padding: '10px 16px', borderRadius: '10px' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#60a5fa' }}>
                GET /api/forecast?spot_id={selectedSpot.id_spot}&model={selectedModel}
              </code>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={copyJsonToClipboard} className="glass-button" style={{ padding: '4px 10px', fontSize: '0.78rem' }}>
                  {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                  {copied ? 'Αντιγράφηκε!' : 'Αντιγραφή JSON'}
                </button>
                <button onClick={downloadJson} className="glass-button" style={{ padding: '4px 10px', fontSize: '0.78rem' }}>
                  <Download size={14} /> Λήψη JSON
                </button>
              </div>
            </div>

            <pre style={{
              background: '#090d16',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.82rem',
              maxHeight: '400px',
              overflowY: 'auto',
              color: '#a7f3d0'
            }}>
              {JSON.stringify(forecastData, null, 2)}
            </pre>
          </div>
        )}

      </div>

    </div>
  );
}
