import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, ForeignKey, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="RIDER")
    created_at = Column(DateTime, default=datetime.utcnow)

class Driver(Base):
    __tablename__ = "drivers"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    current_lat = Column(Float, nullable=True, index=True)
    current_lng = Column(Float, nullable=True, index=True)
    status = Column(String, default="OFFLINE", index=True)
    vehicle_info = Column(String, nullable=True)
    user = relationship("User")

class Ride(Base):
    __tablename__ = "rides"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rider_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=True)
    pickup_lat = Column(Float, nullable=False)
    pickup_lng = Column(Float, nullable=False)
    dropoff_lat = Column(Float, nullable=False)
    dropoff_lng = Column(Float, nullable=False)
    status = Column(String, default="REQUESTED")
    fare = Column(Float, nullable=True)

# ── Smart Search Tables ──────────────────────────────────────────────────────

class UserSearch(Base):
    """Per-user search history with frequency tracking."""
    __tablename__ = "user_searches"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    place_name = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    frequency = Column(Integer, default=1)
    last_used = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SavedPlace(Base):
    """User's pinned places like Home / Work."""
    __tablename__ = "saved_places"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    label = Column(String, nullable=False)      # "Home", "Work", custom
    place_name = Column(String, nullable=True)  # Human-readable address
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)

class PopularPlace(Base):
    """Globally popular destinations (auto-updated on every ride request)."""
    __tablename__ = "popular_places"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_name = Column(String, nullable=False, unique=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    search_count = Column(Integer, default=1, index=True)
