import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../index.css';

export default function Login() {
  const [email, setEmail] = useState('alice@test.com');
  const [password, setPassword] = useState('password123');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:8000/api/login", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email, password})
      });
      const data = await res.json();
      if (res.ok) {
        // Securely store credentials locally for the dashboards
        localStorage.setItem("USER_ID", data.user_id);
        localStorage.setItem("USER_NAME", data.name);
        localStorage.setItem("USER_ROLE", data.role);
        
        if (data.role === 'RIDER') navigate('/rider');
        else navigate('/driver');
      } else {
        alert(data.detail);
      }
    } catch {
      alert("Error connecting to Python backend");
    }
  };

  return (
    <div style={{height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-dark)'}}>
      <div style={{fontSize: '3rem', marginBottom: '20px'}}>🚕</div>
      <form onSubmit={handleLogin} style={{background: 'var(--bg-panel)', padding: '40px', borderRadius: '24px', boxShadow: 'var(--shadow-main)', width: '90%', maxWidth: '400px'}}>
        <h2 style={{marginBottom: '20px', textAlign: 'center'}}>Sign in to RideNova</h2>
        <div style={{marginBottom: '15px'}}>
          <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>Email Address</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={{width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-light)', outline: 'none', fontSize: '1rem'}}/>
        </div>
        <div style={{marginBottom: '30px'}}>
          <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-light)', outline: 'none', fontSize: '1rem'}}/>
        </div>
        <button type="submit" style={{width: '100%', padding: '16px', background: 'var(--accent-primary)', color: 'black', fontWeight: 900, fontSize: '1.1rem', border: 'none', borderRadius: '12px', cursor: 'pointer'}}>Login</button>
        <div style={{marginTop: '30px', padding: '15px', background: '#fef3c7', borderRadius: '12px', fontSize: '0.85rem', color: '#92400e', textAlign: 'center', lineHeight: '1.5'}}>
          Test Login 1: <strong>alice@test.com</strong> (Rider)<br/>
          Test Login 2: <strong>charlie@test.com</strong> (Driver)<br/>
          Pass: <strong>password123</strong>
        </div>
      </form>
    </div>
  )
}
