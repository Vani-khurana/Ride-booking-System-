from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import json, uuid, math, urllib.request, urllib.parse

from database import engine, get_db
import models
from utils import calculate_haversine_distance

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="RideShare API")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── WebSocket connection manager ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                pass

manager = ConnectionManager()

# ── Pydantic models ──────────────────────────────────────────────────────────

class RideRequest(BaseModel):
    pickup_lat: float
    pickup_lng: float
    offered_fare: float
    dest_lat: float | None = None
    dest_lng: float | None = None
    dest_name: str | None = None       # For popular_places tracking

class LoginRequest(BaseModel):
    email: str
    password: str

class SearchRequest(BaseModel):
    query: str = ""
    user_id: str | None = None
    lat: float = 28.6139
    lng: float = 77.2090

class RecordSearchRequest(BaseModel):
    user_id: str
    place_name: str
    lat: float
    lng: float

class SavedPlaceRequest(BaseModel):
    user_id: str
    label: str          # "Home", "Work", etc.
    place_name: str
    lat: float
    lng: float

# ── Scoring helper ───────────────────────────────────────────────────────────

def _score(dist_km: float, frequency: int = 0, search_count: int = 0,
           last_used: datetime | None = None, source: str = "photon") -> float:
    proximity  = max(0.0, 1.0 - dist_km / 50.0)
    freq       = min(frequency / 10.0, 1.0)
    popularity = min(search_count / 100.0, 1.0)
    recency    = 1.0
    if last_used:
        hrs = (datetime.utcnow() - last_used).total_seconds() / 3600
        recency = max(0.0, 1.0 - hrs / (24 * 7))  # decays over 1 week
    saved_boost = 0.3 if source == "saved" else 0.0
    return (0.4 * proximity + 0.3 * freq + 0.2 * popularity + 0.1 * recency + saved_boost)

# ── Auth ─────────────────────────────────────────────────────────────────────

@app.get("/")
def health_check():
    return {"status": "online"}

@app.post("/api/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == request.email).first()
    if not user or user.password_hash != request.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"status": "success", "user_id": str(user.id), "name": user.name, "role": user.role}

# ── Seed ─────────────────────────────────────────────────────────────────────

@app.post("/api/test/seed-mock-data")
def seed_mock_data(db: Session = Depends(get_db)):
    rider1 = models.User(id=uuid.uuid4(), name="Alice (Rider)", email="alice@test.com", password_hash="password123", role="RIDER")
    rider2 = models.User(id=uuid.uuid4(), name="Bob (Rider)",   email="bob@test.com",   password_hash="password123", role="RIDER")
    driver_user = models.User(id=uuid.uuid4(), name="Charlie (Driver)", email="charlie@test.com", password_hash="password123", role="DRIVER")
    db.add_all([rider1, rider2, driver_user])
    db.commit()
    d1 = models.Driver(id=uuid.uuid4(), user_id=driver_user.id, current_lat=28.6139, current_lng=77.2090, status="AVAILABLE", vehicle_info="Yellow Bajaj RE (Auto)")
    db.add(d1)
    # Seed some popular places in Delhi
    for name, lat, lng in [
        ("Indira Gandhi International Airport", 28.5562, 77.1000),
        ("Connaught Place", 28.6315, 77.2167),
        ("India Gate", 28.6129, 77.2295),
        ("New Delhi Railway Station", 28.6424, 77.2197),
        ("Cyber City, Gurugram", 28.4949, 77.0887),
        ("Lajpat Nagar Market", 28.5673, 77.2434),
    ]:
        pp = models.PopularPlace(id=uuid.uuid4(), place_name=name, lat=lat, lng=lng, search_count=int(100 + hash(name) % 900))
        db.add(pp)
    db.commit()
    return {"message": "Mock data seeded!"}

# ── Smart Search ─────────────────────────────────────────────────────────────

@app.post("/api/search")
def smart_search(data: SearchRequest, db: Session = Depends(get_db)):
    q    = (data.query or "").lower().strip()
    uLat = data.lat
    uLng = data.lng
    results: list[dict] = []
    seen: set[str] = set()

    def _key(name, lat, lng):
        return f"{name.lower()}_{round(lat,3)}_{round(lng,3)}"

    def _add(r: dict):
        k = _key(r["place_name"], r["lat"], r["lng"])
        if k not in seen:
            seen.add(k)
            r["dist"] = calculate_haversine_distance(uLat, uLng, r["lat"], r["lng"])
            r["score"] = _score(r["dist"], r.get("frequency",0), r.get("search_count",0),
                                r.get("last_used_dt"), r.get("source","photon"))
            results.append(r)

    # ── Source 1: Saved places ───────────────────────────────────────────────
    if data.user_id:
        try:
            uid = uuid.UUID(data.user_id)
            saved = db.query(models.SavedPlace).filter(models.SavedPlace.user_id == uid).all()
            for sp in saved:
                if not q or q in sp.label.lower() or (sp.place_name and q in sp.place_name.lower()):
                    _add({"place_name": sp.place_name or sp.label, "secondary": sp.label,
                          "lat": sp.lat, "lng": sp.lng, "source": "saved",
                          "label": sp.label, "frequency": 10, "search_count": 0})
        except Exception:
            pass

    # ── Source 2: User history ───────────────────────────────────────────────
    if data.user_id and q:
        try:
            uid = uuid.UUID(data.user_id)
            history = (db.query(models.UserSearch)
                       .filter(models.UserSearch.user_id == uid,
                               models.UserSearch.place_name.ilike(f"%{q}%"))
                       .order_by(models.UserSearch.frequency.desc())
                       .limit(5).all())
            for h in history:
                _add({"place_name": h.place_name, "secondary": "Recent",
                      "lat": h.lat, "lng": h.lng, "source": "history",
                      "label": None, "frequency": h.frequency, "search_count": 0,
                      "last_used_dt": h.last_used})
        except Exception:
            pass

    # ── Source 3: Popular places ─────────────────────────────────────────────
    try:
        pop_q = db.query(models.PopularPlace)
        if q:
            pop_q = pop_q.filter(models.PopularPlace.place_name.ilike(f"%{q}%"))
        popular = pop_q.order_by(models.PopularPlace.search_count.desc()).limit(6).all()
        for p in popular:
            _add({"place_name": p.place_name, "secondary": "Popular",
                  "lat": p.lat, "lng": p.lng, "source": "popular",
                  "label": None, "frequency": 0, "search_count": p.search_count})
    except Exception:
        pass  # table may not exist yet — Photon fallback handles it

    # ── Source 4: Photon API (keyword fallback) ──────────────────────────────
    if q:
        try:
            url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(data.query)}&lat={uLat}&lon={uLng}&limit=6&lang=en"
            req = urllib.request.Request(url, headers={'User-Agent': 'RideNova'})
            with urllib.request.urlopen(req, timeout=3) as response:
                resp_data = json.loads(response.read().decode())
            feats = resp_data.get("features", [])
            for f in feats:
                lng_r, lat_r = f["geometry"]["coordinates"]
                p = f["properties"]
                name = p.get("name") or p.get("street") or p.get("city") or "Unknown"
                city  = p.get("city") or p.get("town") or p.get("village") or p.get("county") or ""
                state = p.get("state") or ""
                country = p.get("country") or ""
                secondary = ", ".join(filter(None, [p.get("street") if p.get("name") else None, city, state, country]))
                _add({"place_name": name, "secondary": secondary,
                      "lat": lat_r, "lng": lng_r, "source": "photon",
                      "osm_key": p.get("osm_key"), "osm_value": p.get("osm_value"),
                      "label": None, "frequency": 0, "search_count": 0})
        except Exception:
            pass

    # Sort by score descending
    results.sort(key=lambda r: r["score"], reverse=True)
    # Clean up internal-only field
    for r in results:
        r.pop("last_used_dt", None)

    return results[:8]


@app.get("/api/search/zero-state")
def zero_state(user_id: str | None = None, lat: float = 28.6139, lng: float = 77.2090,
               db: Session = Depends(get_db)):
    """Return Home/Work shortcuts, recent searches, and popular nearby places."""
    result = {"saved": [], "recent": [], "popular": []}

    if user_id:
        try:
            uid = uuid.UUID(user_id)
            saved = db.query(models.SavedPlace).filter(models.SavedPlace.user_id == uid).all()
            result["saved"] = [{"label": s.label, "place_name": s.place_name, "lat": s.lat, "lng": s.lng} for s in saved]
            recent = (db.query(models.UserSearch)
                      .filter(models.UserSearch.user_id == uid)
                      .order_by(models.UserSearch.last_used.desc())
                      .limit(5).all())
            result["recent"] = [{"place_name": h.place_name, "lat": h.lat, "lng": h.lng} for h in recent]
        except Exception:
            pass

    try:
        popular = (db.query(models.PopularPlace)
                   .order_by(models.PopularPlace.search_count.desc())
                   .limit(6).all())
        result["popular"] = [{"place_name": p.place_name, "lat": p.lat, "lng": p.lng,
                               "search_count": p.search_count} for p in popular]
    except Exception:
        pass  # table may not exist yet
    return result


@app.post("/api/search/record")
def record_search(data: RecordSearchRequest, db: Session = Depends(get_db)):
    """Record a successful place selection to user history + boost popular_places."""
    try:
        uid = uuid.UUID(data.user_id)
        existing = (db.query(models.UserSearch)
                    .filter(models.UserSearch.user_id == uid,
                            models.UserSearch.place_name == data.place_name)
                    .first())
        if existing:
            existing.frequency += 1
            existing.last_used = datetime.utcnow()
        else:
            db.add(models.UserSearch(id=uuid.uuid4(), user_id=uid,
                                     place_name=data.place_name,
                                     lat=data.lat, lng=data.lng,
                                     frequency=1, last_used=datetime.utcnow()))
    except Exception:
        pass

    # Update / create popular place
    popular = db.query(models.PopularPlace).filter(
        models.PopularPlace.place_name == data.place_name).first()
    if popular:
        popular.search_count += 1
    else:
        db.add(models.PopularPlace(id=uuid.uuid4(), place_name=data.place_name,
                                   lat=data.lat, lng=data.lng, search_count=1))
    db.commit()
    return {"status": "recorded"}


@app.get("/api/saved-places")
def get_saved_places(user_id: str, db: Session = Depends(get_db)):
    try:
        uid = uuid.UUID(user_id)
        places = db.query(models.SavedPlace).filter(models.SavedPlace.user_id == uid).all()
        return [{"id": str(p.id), "label": p.label, "place_name": p.place_name,
                 "lat": p.lat, "lng": p.lng} for p in places]
    except Exception:
        return []


@app.post("/api/saved-places")
def save_place(data: SavedPlaceRequest, db: Session = Depends(get_db)):
    try:
        uid = uuid.UUID(data.user_id)
        existing = (db.query(models.SavedPlace)
                    .filter(models.SavedPlace.user_id == uid,
                            models.SavedPlace.label == data.label)
                    .first())
        if existing:
            existing.place_name, existing.lat, existing.lng = data.place_name, data.lat, data.lng
        else:
            db.add(models.SavedPlace(id=uuid.uuid4(), user_id=uid, label=data.label,
                                     place_name=data.place_name, lat=data.lat, lng=data.lng))
        db.commit()
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── Ride matching ─────────────────────────────────────────────────────────────

@app.post("/api/rides/request")
async def request_ride(request: RideRequest, db: Session = Depends(get_db)):
    available_drivers = db.query(models.Driver).filter(models.Driver.status == "AVAILABLE").all()
    if not available_drivers:
        raise HTTPException(status_code=404, detail="No available drivers nearby.")

    closest_driver, min_dist = None, float('inf')
    for driver in available_drivers:
        if driver.current_lat is None or driver.current_lng is None: continue
        dist = calculate_haversine_distance(request.pickup_lat, request.pickup_lng,
                                            driver.current_lat, driver.current_lng)
        if dist < min_dist:
            min_dist, closest_driver = dist, driver

    if not closest_driver:
        raise HTTPException(status_code=404, detail="Error calculating distances.")

    # Boost popular places count if dest_name provided
    if request.dest_name:
        pp = db.query(models.PopularPlace).filter(
            models.PopularPlace.place_name == request.dest_name).first()
        if pp:
            pp.search_count += 1
        else:
            db.add(models.PopularPlace(id=uuid.uuid4(), place_name=request.dest_name,
                                       lat=request.dest_lat or 0, lng=request.dest_lng or 0, search_count=1))
        db.commit()

    await manager.broadcast({
        "type": "INCOMING_RIDE",
        "driver_id": str(closest_driver.id),
        "fare": f"₹{request.offered_fare}",
        "pickup_lat": request.pickup_lat,
        "pickup_lng": request.pickup_lng,
        "dest_lat": request.dest_lat,
        "dest_lng": request.dest_lng,
        "distance_km": round(min_dist, 2)
    })
    return {"status": "success"}

# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/live-tracking")
async def websocket_tracking(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                await manager.broadcast(payload)
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
