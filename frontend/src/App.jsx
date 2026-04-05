import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import RiderDashboard from './pages/RiderDashboard';
import DriverDashboard from './pages/DriverDashboard';
import Login from './pages/Login';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/rider" element={<RiderDashboard />} />
        <Route path="/driver" element={<DriverDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  return (
    <div style={styles.container}>
      <h1 style={{fontSize: '3.5rem', color: 'var(--text-main)', marginBottom: '5px', fontWeight: 900}}>
        Ride<span style={{color: 'var(--accent-primary)'}}>Nova</span>
      </h1>
      <p style={{opacity: 0.6, marginBottom: '2rem', fontSize: '1.2rem'}}>inDrive x Rapido Demo</p>
      
      <button 
        style={styles.seedBtn}
        onClick={async () => {
          await fetch("http://localhost:8000/api/test/seed-mock-data", {method: 'POST'});
          alert("Database accurately populated with Alice (Rider) and Charlie (Driver)!");
        }}
      >
        📥 1. Click here first to Setup Mock DB
      </button>

      <div style={styles.grid}>
        <Link to="/login" style={styles.card}>
          <div style={{fontSize: '3rem', marginBottom: '1rem'}}>🔑</div>
          <h2 style={{color: 'var(--text-main)', margin: '0 0 10px 0'}}>Login Portal</h2>
          <p style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Sign in securely into the database</p>
        </Link>
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', background: 'var(--bg-dark)' },
  grid: { display: 'flex', gap: '30px', flexWrap: 'wrap', justifyContent: 'center' },
  seedBtn: { padding: '15px 30px', background: 'var(--text-main)', color: 'white', borderRadius: '30px', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '30px', fontSize: '1.1rem', boxShadow: 'var(--shadow-main)' },
  card: { padding: '3rem 2rem', background: 'var(--bg-panel)', border: '2px solid var(--accent-primary)', borderRadius: '24px', textDecoration: 'none', minWidth: '280px', transition: 'all 0.3s ease', cursor: 'pointer', boxShadow: 'var(--shadow-main)' }
}
