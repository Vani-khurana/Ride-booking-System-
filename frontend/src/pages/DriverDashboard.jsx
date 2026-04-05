import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../index.css';

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 15); }, [center, map]);
  return null;
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [60, 60] });
  }, [bounds, map]);
  return null;
}

export default function DriverDashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [incomingRide, setIncomingRide] = useState(null);
  // rideStatus: IDLE | GOING_TO_RIDER | RIDING
  const [rideStatus, setRideStatus] = useState('IDLE');
  const [earnings, setEarnings] = useState(0);
  const [driverLocation, setDriverLocation] = useState([28.6139, 77.2090]);

  // OTP entry
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
  const [otpError, setOtpError] = useState(false);
  const [otpShake, setOtpShake] = useState(false);
  const otpRefs = [useRef(), useRef(), useRef(), useRef()];

  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // ETA to pickup
  const [pickupETA, setPickupETA] = useState(null);
  const [pickupSteps, setPickupSteps] = useState([]);
  // Route to destination (only shown during RIDING)
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeETA, setRouteETA] = useState(null);
  const [routeBounds, setRouteBounds] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);

  const socketRef = useRef(null);
  const navigate = useNavigate();
  const userName = localStorage.getItem("USER_NAME") || "Guest Driver";

  // --- GPS Watch ---
  useEffect(() => {
    if (!navigator.geolocation) return;
    const geoId = navigator.geolocation.watchPosition(
      (pos) => setDriverLocation([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(geoId);
  }, []);

  // --- WebSocket ---
  useEffect(() => {
    if (!localStorage.getItem("USER_ID")) navigate('/login');
    let ws;
    try {
      ws = new WebSocket("ws://localhost:8000/ws/live-tracking");
      socketRef.current = ws;
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'INCOMING_RIDE' && rideStatus === 'IDLE' && isOnline) {
          setIncomingRide(payload);
        } else if (payload.type === 'RIDE_CANCELLED') {
          setRideStatus(prev => {
            if (prev !== 'IDLE') alert("❌ The passenger cancelled the ride.");
            return 'IDLE';
          });
          setIncomingRide(null);
          setPickupETA(null);
          setRouteCoords(null);
          setRouteETA(null);
          setRouteBounds(null);
          setOtpDigits(['', '', '', '']);
          setOtpError(false);
          setPaymentSuccess(false);
        } else if (payload.type === 'OTP_FAILED') {
          setOtpError(true);
          setOtpShake(true);
          setOtpDigits(['', '', '', '']);
          setTimeout(() => { setOtpShake(false); otpRefs[0].current?.focus(); }, 600);
        } else if (payload.type === 'RIDE_STARTED') {
          setRideStatus('RIDING');
        } else if (payload.type === 'RIDE_ENDED') {
          setRideStatus('PAYMENT');
          setPaymentSuccess(false);
        } else if (payload.type === 'PAYMENT_COMPLETED') {
          setPaymentSuccess(true);
        }
      };
    } catch {}
    return () => { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); };
  }, [isOnline, rideStatus, navigate]);

  // --- Fetch OSRM route ---
  const fetchOSRM = useCallback((fromLat, fromLng, toLat, toLng) => {
    return fetch(`https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`)
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return null;
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const mins = Math.round(route.duration / 60);
        const eta = mins < 60 ? `${mins} mins` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const lats = coords.map(c => c[0]), lngs = coords.map(c => c[1]);
        const bounds = [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
        // Parse step-by-step directions
        const steps = (route.legs[0]?.steps || []).map(s => ({
          type: s.maneuver?.type || 'continue',
          modifier: s.maneuver?.modifier || '',
          name: s.name || '',
          distance: s.distance || 0,
        })).filter(s => s.type !== 'depart' || s.name);
        return { coords, eta, bounds, steps };
      })
      .catch(() => null);
  }, []);

  // --- Maneuver icon helper ---
  const maneuverIcon = (type, modifier = '') => {
    if (type === 'arrive') return '🏁';
    if (type === 'roundabout' || type === 'rotary') return '🔄';
    if (modifier.includes('uturn')) return '↩️';
    if (modifier === 'left') return '⬅️';
    if (modifier === 'right') return '➡️';
    if (modifier === 'slight left') return '↖️';
    if (modifier === 'slight right') return '↗️';
    if (modifier === 'sharp left') return '↰';
    if (modifier === 'sharp right') return '↱';
    if (type === 'depart') return '🚀';
    return '⬆️';
  };

  // --- Accept ride ---
  const handleAccept = useCallback(async () => {
    if (!incomingRide) return;
    const { pickup_lat, pickup_lng } = incomingRide;

    // Broadcast acceptance with driver location so rider can compute ETA
    socketRef.current.send(JSON.stringify({
      type: 'RIDE_ACCEPTED',
      driver_name: userName,
      eta: '~3 mins',
      vehicle: 'Yellow Bajaj RE',
      driver_lat: driverLocation[0],
      driver_lng: driverLocation[1],
    }));

    setRideStatus('GOING_TO_RIDER');

    // Compute ETA / route from driver → pickup
    const result = await fetchOSRM(driverLocation[0], driverLocation[1], pickup_lat, pickup_lng);
    if (result) {
      setPickupETA(result.eta);
      setRouteBounds(result.bounds);
      setPickupSteps(result.steps || []);
    }
    setIncomingRide({ ...incomingRide });
  }, [incomingRide, driverLocation, userName, fetchOSRM]);

  // --- Compute route to destination when ride starts ---
  useEffect(() => {
    if (rideStatus === 'RIDING' && incomingRide?.dest_lat && incomingRide?.dest_lng) {
      fetchOSRM(
        incomingRide.pickup_lat, incomingRide.pickup_lng,
        incomingRide.dest_lat, incomingRide.dest_lng
      ).then(result => {
        if (result) {
          setRouteCoords(result.coords);
          setRouteETA(result.eta);
          setRouteBounds(result.bounds);
          setRouteSteps(result.steps || []);
        }
      });
    }
  }, [rideStatus, incomingRide, fetchOSRM]);

  // --- End ride ---
  const handleEndRide = () => {
    socketRef.current?.send(JSON.stringify({ type: 'RIDE_ENDED' }));
    setRideStatus('PAYMENT');
    setPaymentSuccess(false);
  };

  const handleFinishPayment = () => {
    if (!paymentSuccess) {
      socketRef.current?.send(JSON.stringify({ type: 'PAYMENT_COMPLETED' }));
    }
    setRideStatus('IDLE');
    const fareNum = parseInt((incomingRide?.fare || "0").replace(/\D/g, ''), 10);
    setEarnings(prev => prev + (isNaN(fareNum) ? 0 : fareNum));
    setIncomingRide(null);
    setPickupETA(null);
    setPickupSteps([]);
    setRouteCoords(null);
    setRouteETA(null);
    setRouteBounds(null);
    setRouteSteps([]);
    setPaymentSuccess(false);
  };

  const pickupPos = incomingRide ? [incomingRide.pickup_lat, incomingRide.pickup_lng] : null;
  const destPos = incomingRide?.dest_lat ? [incomingRide.dest_lat, incomingRide.dest_lng] : null;

  return (
    <div style={styles.appContainer}>
      {/* Left Panel */}
      <div style={styles.leftPanel}>
        <div style={styles.topBar}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{userName}</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Earnings: ₹{earnings}</span>
          </div>
          <div
            onClick={() => rideStatus === 'IDLE' && setIsOnline(!isOnline)}
            style={{ ...styles.toggleBtn, backgroundColor: isOnline ? 'var(--accent-success)' : '#e5e7eb', color: isOnline ? 'white' : 'black', opacity: rideStatus !== 'IDLE' ? 0.5 : 1 }}
          >
            {isOnline ? 'On Duty' : 'Off Duty'}
          </div>
        </div>

        <div style={styles.controlPanel}>
          {/* IDLE — no ride yet */}
          {rideStatus === 'IDLE' && !incomingRide && (
            <div style={styles.emptyState}>
              <div style={{ fontSize: '3.5rem', marginBottom: '15px' }}>📡</div>
              <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-main)' }}>{isOnline ? 'Scanning for passengers...' : 'You are offline'}</h3>
              <p style={{ color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>{isOnline ? 'Stay in high-demand areas for more rides.' : 'Go online to start receiving requests.'}</p>
            </div>
          )}

          {/* Incoming offer */}
          {incomingRide && rideStatus === 'IDLE' && (
            <div style={styles.rideCard}>
              <h2 style={{ color: 'var(--text-main)', marginTop: 0 }}>New Offer!</h2>
              <div style={{ margin: '10px 0' }}>
                <p style={{ margin: '5px 0' }}>📍 Pickup nearby</p>
                <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent-success)', margin: '15px 0' }}>{incomingRide.fare}</p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>Distance: {incomingRide.distance_km} km</p>
                {incomingRide.dest_lat && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }}>📍→🏁 Destination set</p>}
              </div>
              <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                <button style={styles.rejectBtn} onClick={() => setIncomingRide(null)}>Decline</button>
                <button style={styles.acceptBtn} onClick={handleAccept}>Accept Fare</button>
              </div>
            </div>
          )}

          {/* Going to pickup */}
          {rideStatus === 'GOING_TO_RIDER' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '3.5rem' }}>🧭</div>
                <h2 style={{ margin: '10px 0 4px 0', color: 'var(--text-main)' }}>Navigate to Pickup</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Passenger is waiting</p>
              </div>

              {/* ETA to pickup */}
              <div style={{ ...styles.etaCard, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', border: '1.5px solid #86efac' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#166534' }}>ETA to pickup</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#15803d' }}>🚗 {pickupETA || 'Calculating...'}</div>
                </div>
                <div style={{ fontSize: '2.5rem' }}>📍</div>
              </div>

              {/* OTP Entry */}
              <div style={{
                background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                border: `2px solid ${otpError ? '#ef4444' : '#f59e0b'}`,
                borderRadius: '16px', padding: '20px', textAlign: 'center',
                animation: otpShake ? 'shake 0.5s ease' : 'none'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#92400e', fontWeight: 700, marginBottom: '12px', letterSpacing: '0.05em' }}>
                  🔐 ENTER PASSENGER OTP
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '12px' }}>
                  {otpDigits.map((d, i) => (
                    <input
                      key={i}
                      ref={otpRefs[i]}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        const newDigits = [...otpDigits];
                        newDigits[i] = val;
                        setOtpDigits(newDigits);
                        setOtpError(false);
                        if (val && i < 3) otpRefs[i + 1].current?.focus();
                        // Auto-submit when all 4 filled
                        if (val && i === 3) {
                          const fullOTP = [...newDigits.slice(0, 3), val].join('');
                          if (fullOTP.length === 4) {
                            socketRef.current.send(JSON.stringify({ type: 'VERIFY_OTP', otp: fullOTP }));
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !d && i > 0) otpRefs[i - 1].current?.focus();
                      }}
                      style={{
                        width: '52px', height: '60px', textAlign: 'center',
                        fontSize: '1.8rem', fontWeight: 900,
                        border: `2px solid ${otpError ? '#ef4444' : '#f59e0b'}`,
                        borderRadius: '12px', outline: 'none',
                        background: d ? 'white' : '#fffbeb',
                        color: '#92400e', caretColor: '#f59e0b'
                      }}
                    />
                  ))}
                </div>
                {otpError && (
                  <div style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>
                    ❌ Wrong OTP — please try again
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '6px', opacity: 0.8 }}>
                  Ask the passenger for their 4-digit OTP
                </div>
              </div>

              <div style={{ background: 'var(--bg-dark)', padding: '14px 16px', borderRadius: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                🗺️ Rider's pin is shown on the map. Drive towards the <strong style={{ color: 'var(--text-main)' }}>📍 pickup marker</strong>.
              </div>

              {/* Turn-by-turn directions */}
              {pickupSteps.length > 0 && (
                <div style={styles.directionsBox}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>DIRECTIONS TO PICKUP</div>
                  {pickupSteps.slice(0, 8).map((step, i) => (
                    <div key={i} style={styles.stepRow}>
                      <div style={styles.stepIcon}>{maneuverIcon(step.type, step.modifier)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                          {step.type === 'arrive' ? 'Arrive at pickup' : step.modifier ? `${step.modifier.charAt(0).toUpperCase() + step.modifier.slice(1)} on ` : 'Continue on '}
                          {step.name && <span style={{ color: '#6c63ff' }}>{step.name}</span>}
                        </div>
                        {step.distance > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {step.distance < 1000 ? `${Math.round(step.distance)} m` : `${(step.distance/1000).toFixed(1)} km`}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Riding to destination */}
          {rideStatus === 'RIDING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '3.5rem' }}>🛣️</div>
                <h2 style={{ margin: '10px 0 4px 0', color: 'var(--text-main)' }}>Ride in Progress</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Follow the route on the map</p>
              </div>

              <div style={{ ...styles.etaCard, background: 'linear-gradient(135deg,#ede9fe,#dbeafe)', border: '1.5px solid #c4b5fd' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#5b21b6' }}>ETA to destination</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#7c3aed' }}>🕐 {routeETA || '...'}</div>
                </div>
                <div style={{ fontSize: '2.5rem' }}>🏁</div>
              </div>

              <div style={{ background: 'var(--bg-dark)', padding: '14px 16px', borderRadius: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                🗺️ Follow the <strong style={{ color: '#6c63ff' }}>purple route</strong> on the map to reach the destination.
              </div>

              {/* Turn-by-turn directions */}
              {routeSteps.length > 0 && (
                <div style={styles.directionsBox}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>DIRECTIONS TO DESTINATION</div>
                  {routeSteps.slice(0, 8).map((step, i) => (
                    <div key={i} style={styles.stepRow}>
                      <div style={styles.stepIcon}>{maneuverIcon(step.type, step.modifier)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                          {step.type === 'arrive' ? 'Arrive at destination' : step.modifier ? `${step.modifier.charAt(0).toUpperCase() + step.modifier.slice(1)} on ` : 'Continue on '}
                          {step.name && <span style={{ color: '#6c63ff' }}>{step.name}</span>}
                        </div>
                        {step.distance > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {step.distance < 1000 ? `${Math.round(step.distance)} m` : `${(step.distance/1000).toFixed(1)} km`}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button style={{ ...styles.endRideBtn, marginTop: 'auto' }} onClick={handleEndRide}>
                Drop Off & Finish Trip
              </button>
            </div>
          )}

          {/* PAYMENT mode */}
          {rideStatus === 'PAYMENT' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '4rem', marginBottom: '10px' }}>
                {!paymentSuccess ? '⏱️' : '✅'}
              </div>
              <h2 style={{ margin: '0 0 5px 0', color: 'var(--text-main)' }}>
                {!paymentSuccess ? 'Awaiting Payment' : 'Payment Received'}
              </h2>
              <p style={{ color: 'var(--text-muted)', margin: '0 0 20px 0', textAlign: 'center' }}>
                {!paymentSuccess ? "Waiting for the passenger to complete the payment..." : "The passenger has paid successfully."}
              </p>
              
              <div style={{ background: 'var(--bg-dark)', borderRadius: '16px', padding: '24px', width: '100%', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Fare Amount</div>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#15803d', margin: '10px 0' }}>{incomingRide?.fare}</div>
              </div>

              {paymentSuccess ? (
                <button style={{ ...styles.endRideBtn, marginTop: '20px', width: '100%' }} onClick={handleFinishPayment}>
                  Done & Go Online
                </button>
              ) : (
                <button style={{ ...styles.rejectBtn, width: '100%', marginTop: '20px' }} onClick={handleFinishPayment}>
                  Collect Cash & Finish
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Map */}
      <div style={styles.mapArea}>
        <MapContainer center={driverLocation} zoom={15} style={{ height: "100%", width: "100%" }} zoomControl={false}>
          {routeBounds ? <FitBounds bounds={routeBounds} /> : <MapRecenter center={driverLocation} />}
          <TileLayer
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          {/* Driver pin */}
          <Marker
            position={driverLocation}
            icon={L.divIcon({
              className: 'custom-icon',
              html: `<div style="font-size:2.5rem; text-align:center; position:relative;">
                       ${isOnline && rideStatus === 'IDLE' ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;background:var(--accent-success);opacity:0.25;border-radius:50%;animation:pulse 2s infinite;z-index:-1;"></div>' : ''}
                       🚗
                     </div>`,
              iconSize: [50, 50], iconAnchor: [25, 25]
            })}
          />

          {/* Pickup pin */}
          {pickupPos && (rideStatus === 'GOING_TO_RIDER') && (
            <Marker
              position={pickupPos}
              icon={L.divIcon({ className: 'custom-icon', html: `<div style="font-size:2rem; text-align:center;">🧍</div>`, iconSize: [40, 40], iconAnchor: [20, 40] })}
            />
          )}

          {/* Destination pin — only when RIDING */}
          {destPos && rideStatus === 'RIDING' && (
            <Marker
              position={destPos}
              icon={L.divIcon({ className: 'custom-icon', html: `<div style="font-size:2rem; text-align:center;">🏁</div>`, iconSize: [40, 40], iconAnchor: [20, 40] })}
            />
          )}

          {/* Route polyline — only during active RIDING */}
          {rideStatus === 'RIDING' && routeCoords && (
            <Polyline positions={routeCoords} pathOptions={{ color: '#6c63ff', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

const styles = {
  appContainer: { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'row', backgroundColor: 'var(--bg-dark)' },
  leftPanel: { width: '400px', minWidth: '350px', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', boxShadow: '4px 0 20px rgba(0,0,0,0.08)', zIndex: 10 },
  topBar: { padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' },
  toggleBtn: { padding: '10px 20px', borderRadius: '30px', cursor: 'pointer', fontWeight: 800, transition: '0.3s' },
  controlPanel: { padding: '25px', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' },
  mapArea: { flex: 1, position: 'relative', height: '100%', zIndex: 0 },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.85 },
  rideCard: { background: '#fffcf0', border: '2px solid var(--accent-primary)', padding: '25px', borderRadius: '16px', display: 'flex', flexDirection: 'column' },
  etaCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'linear-gradient(135deg, #ede9fe, #dbeafe)', borderRadius: '14px', border: '1.5px solid #c4b5fd' },
  acceptBtn: { flex: 2, padding: '18px', background: 'var(--accent-primary)', color: 'var(--text-main)', border: 'none', borderRadius: '16px', fontSize: '1.1rem', fontWeight: 900, cursor: 'pointer' },
  rejectBtn: { flex: 1, padding: '18px', background: '#f3f4f6', color: 'var(--text-main)', border: 'none', borderRadius: '16px', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 'bold' },
  endRideBtn: { width: '100%', padding: '18px', background: 'var(--accent-success)', color: 'white', border: 'none', borderRadius: '16px', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 'bold' },
  directionsBox: { background: 'var(--bg-dark)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflowY: 'auto' },
  stepRow: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 0', borderBottom: '1px solid #e2e8f0' },
  stepIcon: { fontSize: '1.2rem', width: '28px', textAlign: 'center', flexShrink: 0, marginTop: '1px' }
};
