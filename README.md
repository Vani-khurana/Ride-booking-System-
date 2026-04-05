# RideNova (Ride Hailing System)

RideNova is a full-stack web application for a ride-hailing and sharing system. It provides real-time ride matching, live vehicle tracking via WebSockets, and a smart, personalized search system for finding destinations based on user history, saved places, and popularity.

## Features
- **Smart Destination Search**: A hybrid search system that scores and ranks results combining user search history, saved places (Home/Work), popular places, and global geocoding (via Photon API).
- **Real-time Live Tracking**: WebSockets are used to provide live updates of ride statuses and driver locations for active rides.
- **Ride Matching Engine**: An API that finds available drivers nearby and matches them with ride requests, calculating the Haversine distance for proximity matching.
- **RESTful Backend API**: Built using FastAPI and SQLAlchemy (PostgreSQL).
- **Interactive UI**: A React frontend built with Vite, Leaflet maps, and Socket.io.

---

## Project Architecture

- **`backend/`**: A Python FastAPI backend application that handles application logic, WebSockets, and the Postgres database interactions.
- **`frontend/`**: A React application set up with Vite and styled for a modern web experience.

---

## Prerequisites

Before you start, make sure you have the following installed:
- [Node.js](https://nodejs.org/en/) (v16+ recommended)
- [Python](https://www.python.org/downloads/) (3.10+ recommended)
- Git

---

## How to Run the Project locally

You will need to start both the backend server and the frontend development server separately to run the project.

### 1. Starting the Backend Server

Open your terminal, navigate to the `backend` directory, and start the python server:

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```
2. **Activate the Virtual Environment** (The project already has a `venv` created):
   - **Windows**: `venv\Scripts\activate`
   - **macOS/Linux**: `source venv/bin/activate`
3. **Install dependencies** *(if not already installed)*:
   ```bash
   pip install fastapi uvicorn sqlalchemy pydantic websockets
   ```
4. **Run the FastAPI server**:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *The backend will now be running on `http://localhost:8000`. You can view the API documentation at `http://localhost:8000/docs`.*

*(Optional First-Time Setup)*: You can generate dummy data to test the platform by hitting the mock data endpoint:
- Send a POST request to: `http://localhost:8000/api/test/seed-mock-data`

---

### 2. Starting the Frontend (React / Vite)

Open a **new, separate terminal tab**, navigate to the `frontend` folder, and start the app:

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```
2. **Install project dependencies**:
   ```bash
   npm install
   ```
3. **Start the development server**:
   ```bash
   npm run dev
   ```
   *The frontend will start running on the local port provided in the terminal (usually `http://localhost:5173`).*

---

## Database Configuration

The backend is connected to a PostgreSQL database hosted on Supabase.
All connection strings are pre-configured in `backend/database.py`. No local database setup is required, though you must ensure you have internet access to reach the managed Supabase instance.
