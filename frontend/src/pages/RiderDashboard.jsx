import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../index.css';

// ── Map helpers ──────────────────────────────────────────────────────────────
function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 15); }, [center, map]);
  return null;
}
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [60, 60] }); }, [bounds, map]);
  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────
const VEHICLES = [
  { id: 'bike',    label: 'Bike',    icon: '🏍️', desc: 'Fastest · 1 seat',         base: 15, perKm: 6,  etaLabel: '2 mins'  },
  { id: 'auto',    label: 'Auto',    icon: '🛺', desc: 'Affordable · 3 seats',      base: 20, perKm: 8,  etaLabel: '3 mins'  },
  { id: 'car',     label: 'Car',     icon: '🚗', desc: 'Comfortable · 4 seats',     base: 50, perKm: 14, etaLabel: '5 mins'  },
  { id: 'premier', label: 'Premier', icon: '🚙', desc: 'Premium SUV · 6 seats',     base: 80, perKm: 20, etaLabel: '7 mins'  },
];
const calcFare   = (v, km) => Math.round(v.base + v.perKm * (km || 1));
const fmtDist    = (km) =>  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

const SOURCE_BADGES = {
  saved:   { label: '📌 Saved',   bg: '#ede9fe', color: '#7c3aed' },
  history: { label: '🕘 Recent',  bg: '#dbeafe', color: '#1d4ed8' },
  popular: { label: '🔥 Popular', bg: '#fef3c7', color: '#92400e' },
  photon:  { label: '🌍 Nearby',  bg: '#f0fdf4', color: '#166534' },
};

const SAVED_ICONS = { Home: '🏠', Work: '🏢', default: '📌' };

// ── OSM → emoji icon map ─────────────────────────────────────────────────────
function placeIcon(key, val) {
  if (key === 'aeroway') return '✈️';
  if (key === 'railway') return '🚉';
  if (key === 'amenity') {
    const m = { restaurant: '🍽️', cafe: '☕', hospital: '🏥', clinic: '🏥',
                school: '🎓', university: '🎓', college: '🎓', bank: '🏦',
                fuel: '⛽', shopping_mall: '🛍️', place_of_worship: '🛕', parking: '🅿️' };
    return m[val] || '🏢';
  }
  if (key === 'tourism')  return '🏛️';
  if (key === 'leisure')  return '🌳';
  if (key === 'shop')     return '🛒';
  if (key === 'place')    return val === 'city' || val === 'town' ? '🏙️' : '🏘️';
  if (key === 'highway')  return '🛣️';
  return '📍';
}

// ── Component ────────────────────────────────────────────────────────────────
export default function RiderDashboard() {
  const [rideState,      setRideState]      = useState('IDLE');
  const [userLocation,   setUserLocation]   = useState([28.6139, 77.2090]);
  const [currentAddress, setCurrentAddress] = useState('Fetching location…');
  const [driverDetails,  setDriverDetails]  = useState(null);
  const [rideOTP,        setRideOTP]        = useState(null);
  const rideOTPRef = useRef(null);

  // Destination
  const [destQuery,    setDestQuery]    = useState('');
  const [destLocation, setDestLocation] = useState(null);
  const [destName,     setDestName]     = useState('');
  const [destDistKm,   setDestDistKm]   = useState(null);

  // Search state
  const [suggestions,    setSuggestions]    = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [zeroState,      setZeroState]      = useState(null);   // { saved, recent, popular }
  const [searchLoading,  setSearchLoading]  = useState(false);

  // Vehicle
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Route
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeETA,    setRouteETA]    = useState(null);
  const [routeBounds, setRouteBounds] = useState(null);

  // Rating modal
  const [showRating,  setShowRating]  = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [givenRating, setGivenRating] = useState(0);

  const socketRef   = useRef(null);
  const debounceRef = useRef(null);
  const navigate    = useNavigate();
  const userId      = localStorage.getItem('USER_ID');
  const userName    = localStorage.getItem('USER_NAME') || 'Guest Rider';

  useEffect(() => { rideOTPRef.current = rideOTP; }, [rideOTP]);

  // ── GPS watch ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserLocation([lat, lng]);
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          .then(r => r.json()).then(d => {
            const a = d.address;
            const label = [a.road || a.pedestrian, a.suburb || a.neighbourhood,
                           a.city || a.town || a.village].filter(Boolean).join(', ');
            setCurrentAddress(label || d.display_name.split(',').slice(0, 3).join(', '));
          }).catch(() => setCurrentAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`));
      },
      () => setCurrentAddress('Location unavailable'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) navigate('/login');
    let ws;
    try {
      ws = new WebSocket('ws://localhost:8000/ws/live-tracking');
      socketRef.current = ws;
      ws.onmessage = ({ data }) => {
        const p = JSON.parse(data);
        if (p.type === 'RIDE_ACCEPTED' && rideState === 'SEARCHING') {
          const otp = Math.floor(1000 + Math.random() * 9000).toString();
          setRideOTP(otp);
          setRideState('FOUND');
          setDriverDetails({
            name: p.driver_name, vehicle: p.vehicle, eta: p.eta,
            rating: (4 + Math.random()).toFixed(1),
            trips: Math.floor(200 + Math.random() * 800),
          });
          if (p.driver_lat && p.driver_lng)
            fetchRoute(p.driver_lat, p.driver_lng, userLocation[0], userLocation[1], true);
        } else if (p.type === 'VERIFY_OTP') {
          if (p.otp === rideOTPRef.current) {
            socketRef.current.send(JSON.stringify({ type: 'RIDE_STARTED' }));
            setRideState('RIDING');
            if (destLocation) fetchRoute(userLocation[0], userLocation[1], destLocation[0], destLocation[1], false);
          } else {
            socketRef.current.send(JSON.stringify({ type: 'OTP_FAILED' }));
          }
        } else if (p.type === 'RIDE_STARTED') {
          setRideState('RIDING');
          if (destLocation) fetchRoute(userLocation[0], userLocation[1], destLocation[0], destLocation[1], false);
        } else if (p.type === 'RIDE_ENDED') {
          setRideState('PAYMENT');
        } else if (p.type === 'PAYMENT_COMPLETED') {
          setRideState('IDLE'); setDriverDetails(null); setRideOTP(null);
          setDestQuery(''); setDestLocation(null); setDestName('');
          setRouteCoords(null); setRouteETA(null); setRouteBounds(null);
          setDestDistKm(null); setSelectedVehicle(null);
          setShowRating(true);
        } else if (p.type === 'RIDE_CANCELLED') {
          setRideState('IDLE'); setDriverDetails(null); setRideOTP(null);
        }
      };
    } catch { /* ignore */ }
    return () => { if (ws?.readyState === WebSocket.OPEN) ws.close(); };
  }, [rideState, navigate, userId]);

  // ── OSRM route ─────────────────────────────────────────────────────────────
  const fetchRoute = useCallback((fLat, fLng, tLat, tLng, isPickup) => {
    return fetch(`https://router.project-osrm.org/route/v1/driving/${fLng},${fLat};${tLng},${tLat}?overview=full&geometries=geojson`)
      .then(r => r.json()).then(data => {
        if (!data.routes?.length) return;
        const route  = data.routes[0];
        const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const mins   = Math.round(route.duration / 60);
        const eta    = mins < 60 ? `${mins} mins` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const lats   = coords.map(c => c[0]), lngs = coords.map(c => c[1]);
        const bounds = [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
        if (isPickup) {
          setDriverDetails(prev => ({ ...prev, etaToRider: eta }));
        } else {
          setRouteCoords(coords); setRouteETA(eta); setRouteBounds(bounds);
          setDestDistKm(route.distance / 1000);
        }
      }).catch(() => {});
  }, []);

  // ── Zero-state (focus while empty) ─────────────────────────────────────────
  const loadZeroState = useCallback(() => {
    const [lat, lng] = userLocation;
    const params = new URLSearchParams({ lat, lng, ...(userId ? { user_id: userId } : {}) });
    fetch(`http://localhost:8000/api/search/zero-state?${params}`)
      .then(r => r.json()).then(setZeroState).catch(() => {});
  }, [userLocation, userId]);

  const handleSearchFocus = () => {
    if (!destQuery.trim()) { loadZeroState(); setShowSuggestions(true); }
    else if (suggestions.length) setShowSuggestions(true);
  };

  // ── Keyword search ──────────────────────────────────────────────────────────
  const handleDestInput = useCallback((e) => {
    const val = e.target.value;
    setDestQuery(val);
    setDestLocation(null); setRouteCoords(null); setRouteETA(null);
    setRouteBounds(null);  setDestDistKm(null);  setSelectedVehicle(null);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]); loadZeroState(); setShowSuggestions(true); return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(() => {
      const [lat, lng] = userLocation;
      fetch('http://localhost:8000/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: val, user_id: userId || null, lat, lng }),
      }).then(r => r.json()).then(results => {
        setSuggestions(results); setShowSuggestions(true); setZeroState(null);
      }).catch(() => setSuggestions([])).finally(() => setSearchLoading(false));
    }, 280);
  }, [userLocation, userId, loadZeroState]);

  // ── Select suggestion ───────────────────────────────────────────────────────
  const handleSelectPlace = useCallback((place) => {
    const destLat = place.lat, destLng = place.lng;
    const name    = place.place_name || place.label;
    setDestQuery(name); setDestLocation([destLat, destLng]); setDestName(name);
    setSuggestions([]); setShowSuggestions(false); setZeroState(null);
    // Record to history + popular places
    if (userId && name) {
      fetch('http://localhost:8000/api/search/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, place_name: name, lat: destLat, lng: destLng }),
      }).catch(() => {});
    }
    // Fetch OSRM route
    const [uLat, uLng] = userLocation;
    fetch(`https://router.project-osrm.org/route/v1/driving/${uLng},${uLat};${destLng},${destLat}?overview=full&geometries=geojson`)
      .then(r => r.json()).then(data => {
        if (!data.routes?.length) return;
        const route  = data.routes[0];
        const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const distKm = route.distance / 1000;
        const mins   = Math.round(route.duration / 60);
        const eta    = mins < 60 ? `${mins} mins` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const lats = coords.map(c => c[0]), lngs = coords.map(c => c[1]);
        setRouteCoords(coords); setRouteETA(eta); setDestDistKm(distKm);
        setRouteBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]);
      }).catch(() => {});
  }, [userLocation, userId]);

  // ── Book ride ───────────────────────────────────────────────────────────────
  const handleRequestRide = async () => {
    if (!selectedVehicle || !destLocation) return;
    setRideState('SEARCHING');
    const payload = {
      pickup_lat: userLocation[0], pickup_lng: userLocation[1],
      offered_fare: calcFare(selectedVehicle, destDistKm),
      dest_lat: destLocation[0], dest_lng: destLocation[1],
      dest_name: destName || '',
    };
    try {
      const res = await fetch('http://localhost:8000/api/rides/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); alert(d.detail); setRideState('IDLE'); }
    } catch { alert('Cannot reach server.'); setRideState('IDLE'); }
  };

  const handleCancelRide = () => {
    socketRef.current?.send(JSON.stringify({ type: 'RIDE_CANCELLED' }));
    setRideState('IDLE'); setDriverDetails(null); setRideOTP(null);
  };

  const handleEndRide = () => {
    socketRef.current?.send(JSON.stringify({ type: 'RIDE_ENDED' }));
    setRideState('PAYMENT');
  };

  const finishPaymentAndReset = () => {
    socketRef.current?.send(JSON.stringify({ type: 'PAYMENT_COMPLETED' }));
    setRideState('IDLE'); setDriverDetails(null); setRideOTP(null);
    setDestQuery(''); setDestLocation(null); setDestName('');
    setRouteCoords(null); setRouteETA(null); setRouteBounds(null);
    setDestDistKm(null); setSelectedVehicle(null);
    setShowRating(true);
  };

  const estimatedFare = selectedVehicle ? calcFare(selectedVehicle, destDistKm) : null;

  // ── Dropdown content ────────────────────────────────────────────────────────
  const renderDropdown = () => {
    // Keyword results
    if (suggestions.length > 0) {
      return (
        <>
          <div style={s.dropHeader}>RESULTS</div>
          {suggestions.map((r, i) => {
            const badge = SOURCE_BADGES[r.source] || SOURCE_BADGES.photon;
            const icon  = r.source === 'saved' ? (SAVED_ICONS[r.label] || '📌')
                        : r.source === 'history' ? '🕘'
                        : r.source === 'popular' ? '🔥'
                        : placeIcon(r.osm_key, r.osm_value);
            const distLabel = r.dist < 1 ? `${Math.round(r.dist * 1000)} m` : `${r.dist.toFixed(1)} km`;
            return (
              <div key={i} style={s.dropItem}
                onMouseDown={() => handleSelectPlace(r)}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                <div style={s.dropIconBox}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.dropPrimary}>{r.place_name}</div>
                  <div style={s.dropSecondary}>{r.secondary || ''}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span style={{ ...s.sourceBadge, background: badge.bg, color: badge.color }}>{badge.label}</span>
                  <span style={s.distBadge}>{distLabel}</span>
                </div>
              </div>
            );
          })}
          <div style={s.dropFooter}>Powered by OpenStreetMap + History</div>
        </>
      );
    }

    // Zero-state (empty query)
    if (zeroState) {
      return (
        <>
          {/* Saved shortcuts (Home / Work) */}
          {zeroState.saved?.length > 0 && (
            <>
              {zeroState.saved.map((sp, i) => (
                <div key={i} style={s.dropItem}
                  onMouseDown={() => handleSelectPlace(sp)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  <div style={{ ...s.dropIconBox, background: '#ede9fe', fontSize: '1.3rem' }}>
                    {SAVED_ICONS[sp.label] || '📌'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{sp.label}</div>
                    <div style={s.dropSecondary}>{sp.place_name || 'Set location'}</div>
                  </div>
                  <span style={{ ...s.sourceBadge, ...{ background: '#ede9fe', color: '#7c3aed' } }}>📌 Saved</span>
                </div>
              ))}
              <div style={s.sectionDivider}></div>
            </>
          )}

          {/* Recent */}
          {zeroState.recent?.length > 0 && (
            <>
              <div style={s.dropHeader}>RECENT</div>
              {zeroState.recent.map((r, i) => (
                <div key={i} style={s.dropItem}
                  onMouseDown={() => handleSelectPlace(r)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  <div style={s.dropIconBox}>🕘</div>
                  <div style={{ flex: 1 }}>
                    <div style={s.dropPrimary}>{r.place_name}</div>
                  </div>
                  <span style={{ ...s.sourceBadge, background: '#dbeafe', color: '#1d4ed8' }}>🕘 Recent</span>
                </div>
              ))}
              <div style={s.sectionDivider}></div>
            </>
          )}

          {/* Popular */}
          {zeroState.popular?.length > 0 && (
            <>
              <div style={s.dropHeader}>🔥 POPULAR NEAR YOU</div>
              {zeroState.popular.map((p, i) => (
                <div key={i} style={s.dropItem}
                  onMouseDown={() => handleSelectPlace(p)}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  <div style={{ ...s.dropIconBox, background: '#fef3c7' }}>🔥</div>
                  <div style={{ flex: 1 }}>
                    <div style={s.dropPrimary}>{p.place_name}</div>
                    <div style={s.dropSecondary}>{p.search_count} rides this week</div>
                  </div>
                  <span style={{ ...s.sourceBadge, background: '#fef3c7', color: '#92400e' }}>Popular</span>
                </div>
              ))}
            </>
          )}
          <div style={s.dropFooter}>Showing personalized suggestions</div>
        </>
      );
    }
    return null;
  };

  const showDropdown = showSuggestions && (suggestions.length > 0 || (zeroState && (zeroState.saved?.length || zeroState.recent?.length || zeroState.popular?.length)));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={s.appContainer}>

      {/* Rating modal */}
      {showRating && (
        <div style={s.modalOverlay}>
          <div style={s.ratingModal}>
            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🏁</div>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.3rem', fontWeight: 800 }}>You've arrived!</h2>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 22px', fontSize: '0.9rem' }}>
              Rate your trip with {driverDetails?.name || 'your driver'}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '22px' }}>
              {[1,2,3,4,5].map(star => (
                <span key={star}
                  onMouseEnter={() => setHoveredStar(star)}
                  onMouseLeave={() => setHoveredStar(0)}
                  onClick={() => setGivenRating(star)}
                  style={{ fontSize: '2.8rem', cursor: 'pointer', transition: 'transform 0.12s',
                    transform: star <= (hoveredStar || givenRating) ? 'scale(1.25)' : 'scale(1)',
                    color: star <= (hoveredStar || givenRating) ? '#f59e0b' : '#e5e7eb', lineHeight: 1 }}>★</span>
              ))}
            </div>
            {givenRating > 0 && (
              <button style={s.ratingBtn} onClick={() => { setShowRating(false); setGivenRating(0); }}>
                Submit Rating ★{givenRating}
              </button>
            )}
            <button style={{ ...s.ratingBtn, background: 'transparent', color: 'var(--text-muted)', boxShadow: 'none' }}
              onClick={() => { setShowRating(false); setGivenRating(0); }}>Skip</button>
          </div>
        </div>
      )}

      {/* ── Left Panel ──────────────────────────────────────────────────────── */}
      <div style={s.leftPanel}>
        <header style={s.header}>
          <div style={s.menuIcon}>☰</div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>{userName}</h1>
          <div style={s.profileIcon}>🧑</div>
        </header>

        <div style={s.controlPanel}>

          {/* ── IDLE / SEARCHING modes ──────────────────────────────────── */}
          {(rideState === 'IDLE' || rideState === 'SEARCHING') && (
            <>
              <div style={s.whereLabel}>Where to?</div>

              {/* Route input card */}
              <div style={s.routeCard}>
                <div style={s.routeRow}>
                  <div style={s.dotFrom}></div>
                  <input value={currentAddress} readOnly style={{ ...s.routeInput, fontWeight: 600 }} />
                </div>
                <div style={s.routeConnector}></div>
                <div style={s.routeRow}>
                  <div style={s.dotTo}></div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Search destination…"
                      value={destQuery}
                      onChange={handleDestInput}
                      onFocus={handleSearchFocus}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 220)}
                      style={{ ...s.routeInput, color: destLocation ? 'var(--text-main)' : '#9ca3af',
                               fontWeight: destLocation ? 600 : 400 }}
                      autoComplete="off"
                    />
                    {searchLoading && (
                      <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                                    fontSize: '0.75rem', color: 'var(--text-muted)' }}>Searching…</div>
                    )}
                    {/* Dropdown */}
                    {showDropdown && (
                      <div style={s.dropBox}>{renderDropdown()}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Vehicle selection */}
              {destLocation && (
                <>
                  <div style={s.sectionLabel}>CHOOSE A RIDE</div>
                  <div style={s.vehicleList}>
                    {VEHICLES.map(v => {
                      const price = calcFare(v, destDistKm);
                      const sel   = selectedVehicle?.id === v.id;
                      return (
                        <div key={v.id}
                          style={{ ...s.vehicleCard, ...(sel ? s.vehicleCardSel : {}) }}
                          onClick={() => setSelectedVehicle(v)}>
                          <div style={{ fontSize: '2rem' }}>{v.icon}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700 }}>{v.label}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{v.desc}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 900, fontSize: '1.05rem', color: sel ? '#6c63ff' : 'var(--text-main)' }}>₹{price}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.etaLabel}</div>
                          </div>
                          {sel && <div style={s.checkmark}>✓</div>}
                        </div>
                      );
                    })}
                  </div>

                  {selectedVehicle && (
                    <div style={s.fareRow}>
                      <div><span style={s.fareLabel}>Distance</span><br/><b>{destDistKm ? fmtDist(destDistKm) : '…'}</b></div>
                      <div style={{ textAlign: 'center' }}><span style={s.fareLabel}>ETA</span><br/><b>{routeETA || '…'}</b></div>
                      <div style={{ textAlign: 'right' }}><span style={s.fareLabel}>Fare</span><br/><b style={{ fontSize: '1.2rem', color: '#6c63ff' }}>₹{estimatedFare}</b></div>
                    </div>
                  )}
                </>
              )}

              <button
                style={{ ...s.bookBtn,
                  opacity: (selectedVehicle && rideState === 'IDLE') ? 1 : 0.55,
                  cursor:  (selectedVehicle && rideState === 'IDLE') ? 'pointer' : 'default',
                  background: rideState === 'SEARCHING' ? '#fde68a' : 'var(--accent-primary)',
                }}
                onClick={handleRequestRide}
                disabled={!selectedVehicle || rideState === 'SEARCHING'}>
                {rideState === 'IDLE'
                  ? (selectedVehicle ? `Book ${selectedVehicle.label} · ₹${estimatedFare}` : 'Select a vehicle to book')
                  : '🔍  Finding your driver…'}
              </button>
            </>
          )}

          {/* ── FOUND mode ─────────────────────────────────────────────── */}
          {rideState === 'FOUND' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
              <div style={s.driverCard}>
                <div style={s.driverAvatar}>{driverDetails?.name?.[0] || 'D'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>{driverDetails?.name}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{driverDetails?.vehicle}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    <span style={{ color: '#f59e0b' }}>★</span>
                    <b style={{ fontSize: '0.85rem' }}>{driverDetails?.rating}</b>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>({driverDetails?.trips} trips)</span>
                  </div>
                </div>
                <div style={s.callBtn}>📞</div>
              </div>

              <div style={{ ...s.etaCard, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', border: '1.5px solid #86efac' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#166534' }}>Driver arrives in</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d' }}>
                    {selectedVehicle?.icon} {driverDetails?.etaToRider || driverDetails?.eta}
                  </div>
                </div>
                <div style={{ fontSize: '2rem' }}>📡</div>
              </div>

              <div style={s.otpCard}>
                <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 700, marginBottom: '8px', letterSpacing: '0.06em' }}>
                  🔐 YOUR RIDE OTP
                </div>
                <div style={s.otpDigits}>
                  {rideOTP?.split('').map((d, i) => <div key={i} style={s.otpDigit}>{d}</div>)}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#92400e', marginTop: '6px', opacity: 0.8 }}>
                  Share this with your driver to start the ride
                </div>
              </div>

              <div style={s.fareRow}>
                <div><span style={s.fareLabel}>Vehicle</span><br/><b>{selectedVehicle?.label}</b></div>
                <div style={{ textAlign: 'right' }}><span style={s.fareLabel}>Fare</span><br/><b style={{ color: '#15803d', fontSize: '1.2rem' }}>₹{estimatedFare}</b></div>
              </div>

              <button style={{ ...s.bookBtn, background: '#ffe4e6', color: '#e11d48', marginTop: 'auto' }} onClick={handleCancelRide}>
                Cancel Ride
              </button>
            </div>
          )}

          {/* ── RIDING mode ────────────────────────────────────────────── */}
          {rideState === 'RIDING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
              <div style={s.driverCard}>
                <div style={s.driverAvatar}>{driverDetails?.name?.[0] || 'D'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>{driverDetails?.name}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{driverDetails?.vehicle}</div>
                </div>
                <div style={s.callBtn}>📞</div>
              </div>
              <div style={{ ...s.etaCard, background: 'linear-gradient(135deg,#ede9fe,#dbeafe)', border: '1.5px solid #c4b5fd' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#5b21b6' }}>ETA to destination</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#7c3aed' }}>🕐 {routeETA || '…'}</div>
                </div>
                <div style={{ fontSize: '2rem' }}>🏁</div>
              </div>
              <div style={{ background: 'var(--bg-dark)', borderRadius: '12px', padding: '14px 16px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                🗺️ Follow the purple route on the map. Sit back and enjoy!
              </div>
              <div style={s.fareRow}>
                <div><span style={s.fareLabel}>Vehicle</span><br/><b>{selectedVehicle?.label}</b></div>
                <div style={{ textAlign: 'center' }}><span style={s.fareLabel}>Distance</span><br/><b>{destDistKm ? fmtDist(destDistKm) : '…'}</b></div>
                <div style={{ textAlign: 'right' }}><span style={s.fareLabel}>Total Fare</span><br/><b style={{ color: '#15803d', fontSize: '1.2rem' }}>₹{estimatedFare}</b></div>
              </div>
              <button style={{ ...s.bookBtn, background: 'var(--accent-success)', color: 'white', marginTop: 'auto' }} onClick={handleEndRide}>
                End Ride (Testing)
              </button>
            </div>
          )}

          {/* ── PAYMENT mode ────────────────────────────────────────────── */}
          {rideState === 'PAYMENT' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '4rem', marginBottom: '10px' }}>🏁</div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0', color: 'var(--text-main)' }}>You've Arrived!</h2>
              <p style={{ color: 'var(--text-muted)', margin: '0 0 20px 0' }}>Please pay your driver</p>
              
              <div style={{ background: 'var(--bg-dark)', borderRadius: '16px', padding: '24px', width: '100%', marginBottom: '20px' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Total Fare</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#15803d', margin: '10px 0' }}>₹{estimatedFare}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 600 }}>{selectedVehicle?.label} Ride</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                <button style={{ ...s.bookBtn, background: '#1f2937', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }} onClick={finishPaymentAndReset}>
                  <span>📱</span> Pay with UPI
                </button>
                <button style={{ ...s.bookBtn, background: 'var(--bg-dark)', border: '2px solid #e2e8f0', color: 'var(--text-main)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }} onClick={finishPaymentAndReset}>
                  <span>💵</span> Pay Cash
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Map ───────────────────────────────────────────────────────────────── */}
      <div style={s.mapArea}>
        <MapContainer center={userLocation} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          {routeBounds ? <FitBounds bounds={routeBounds} /> : <MapRecenter center={userLocation} />}
          <TileLayer attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          <Marker position={userLocation} icon={L.divIcon({ className: 'custom-icon', html: `<div style="font-size:2rem">🧍</div>`, iconSize: [40, 40], iconAnchor: [20, 20] })} />
          {destLocation && <Marker position={destLocation} icon={L.divIcon({ className: 'custom-icon', html: `<div style="font-size:1.8rem">🏁</div>`, iconSize: [36, 36], iconAnchor: [18, 36] })} />}
          {rideState === 'RIDING' && routeCoords && <Polyline positions={routeCoords} pathOptions={{ color: '#6c63ff', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />}
          {(rideState === 'IDLE' || rideState === 'SEARCHING') && routeCoords && <Polyline positions={routeCoords} pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.6, dashArray: '8 6', lineCap: 'round' }} />}
          {rideState === 'FOUND' && <Marker position={[userLocation[0] + 0.002, userLocation[1] + 0.002]} icon={L.divIcon({ className: 'custom-icon', html: `<div style="font-size:2rem">${selectedVehicle?.icon || '🚗'}</div>`, iconSize: [45, 45], iconAnchor: [22, 22] })} />}
        </MapContainer>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  appContainer: { width: '100vw', height: '100vh', display: 'flex', backgroundColor: 'var(--bg-dark)' },
  leftPanel:    { width: '400px', minWidth: '350px', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', boxShadow: '4px 0 20px rgba(0,0,0,0.08)', zIndex: 10 },
  mapArea:      { flex: 1, height: '100%', zIndex: 0 },
  header:       { padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' },
  menuIcon:     { fontSize: '1.4rem', cursor: 'pointer' },
  profileIcon:  { fontSize: '1.4rem', background: 'var(--bg-dark)', borderRadius: '50%', padding: '5px' },
  controlPanel: { padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, overflowY: 'auto' },
  whereLabel:   { fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' },
  sectionLabel: { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' },

  // Route card
  routeCard:      { background: 'var(--bg-dark)', borderRadius: '16px', padding: '12px 16px' },
  routeRow:       { display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 0' },
  routeConnector: { height: '1px', background: '#e2e8f0', margin: '0 0 0 8px' },
  dotFrom:        { width: '12px', height: '12px', borderRadius: '50%', background: '#6c63ff', flexShrink: 0 },
  dotTo:          { width: '11px', height: '11px', borderRadius: '2px', background: '#1f2937', flexShrink: 0 },
  routeInput:     { background: 'transparent', border: 'none', outline: 'none', fontSize: '0.9rem', width: '100%', fontFamily: 'var(--font-sans)', color: 'var(--text-main)' },

  // Dropdown
  dropBox:      { position: 'absolute', top: 'calc(100% + 6px)', left: '-30px', right: '-30px', background: 'white', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.07), 0 14px 36px rgba(0,0,0,0.14)', zIndex: 1000, overflow: 'hidden', border: '1px solid #f1f5f9', maxHeight: '380px', overflowY: 'auto' },
  dropHeader:   { padding: '8px 16px 5px', fontSize: '0.7rem', color: '#9ca3af', fontWeight: 700, letterSpacing: '0.07em', borderBottom: '1px solid #f1f5f9' },
  dropFooter:   { padding: '6px 14px', fontSize: '0.68rem', color: '#d1d5db', textAlign: 'right', borderTop: '1px solid #f1f5f9' },
  dropItem:     { padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', background: 'white', transition: 'background 0.12s', borderBottom: '1px solid #f8fafc' },
  dropIconBox:  { width: '36px', height: '36px', borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 },
  dropPrimary:  { fontWeight: 600, fontSize: '0.9rem', color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  dropSecondary:{ fontSize: '0.76rem', color: '#6b7280', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  sourceBadge:  { fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' },
  distBadge:    { fontSize: '0.7rem', fontWeight: 700, color: '#6c63ff', background: '#ede9fe', padding: '2px 7px', borderRadius: '10px', whiteSpace: 'nowrap' },
  sectionDivider: { height: '1px', background: '#f1f5f9', margin: '4px 0' },

  // Vehicle
  vehicleList:      { display: 'flex', flexDirection: 'column', gap: '8px' },
  vehicleCard:      { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'var(--bg-dark)', borderRadius: '14px', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.15s', position: 'relative' },
  vehicleCardSel:   { border: '2px solid #6c63ff', background: '#ede9fe22' },
  checkmark:        { position: 'absolute', top: '8px', right: '10px', color: '#6c63ff', fontWeight: 900, fontSize: '0.85rem' },

  // Fare row
  fareRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-dark)', borderRadius: '14px', padding: '14px 18px' },
  fareLabel: { fontSize: '0.78rem', color: 'var(--text-muted)' },

  // Book button
  bookBtn: { padding: '16px', border: 'none', borderRadius: '14px', fontSize: '1.02rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s', color: 'var(--text-main)', marginTop: 'auto', width: '100%' },

  // Driver card
  driverCard:   { display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--bg-dark)', borderRadius: '16px', padding: '14px 16px' },
  driverAvatar: { width: '48px', height: '48px', borderRadius: '50%', background: 'linear-gradient(135deg,#6c63ff,#48bb78)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 900, color: 'white', flexShrink: 0 },
  callBtn:      { fontSize: '1.6rem', background: '#e2e8f0', padding: '8px', borderRadius: '50%', cursor: 'pointer' },
  etaCard:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderRadius: '14px' },

  // OTP
  otpCard:   { background: 'linear-gradient(135deg,#fef3c7,#fde68a)', border: '2px solid #f59e0b', borderRadius: '16px', padding: '16px 20px', textAlign: 'center' },
  otpDigits: { display: 'flex', gap: '10px', justifyContent: 'center', margin: '8px 0' },
  otpDigit:  { width: '52px', height: '58px', background: 'white', border: '2px solid #f59e0b', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', fontWeight: 900, color: '#92400e', boxShadow: '0 2px 8px rgba(245,158,11,0.2)' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' },
  ratingModal:  { background: 'white', borderRadius: '24px', padding: '36px 40px', minWidth: '320px', textAlign: 'center', boxShadow: '0 25px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  ratingBtn:    { width: '100%', padding: '14px', background: 'var(--accent-primary)', color: 'var(--text-main)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 800, cursor: 'pointer', marginTop: '8px', boxShadow: '0 4px 12px rgba(249,211,66,0.4)' },
};
