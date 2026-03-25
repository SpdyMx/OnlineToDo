import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { UserPlus } from 'lucide-react';

export default function Register() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await fetchWithAuth('/register', {
                method: 'POST',
                body: JSON.stringify({ name, displayName, primaryMail: email, password }),
            });
            toast.success('Account created! Please login.');
            navigate('/login');
        } catch (err: any) {
            toast.error(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container animate-slide-in glass-panel">
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <UserPlus size={48} color="var(--accent)" style={{ margin: '0 auto' }} />
                <h1 className="heading" style={{ marginBottom: '0.5rem' }}>Create Account</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Sign up to start organizing</p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Full Name"
                    className="input-field"
                    required
                />
                <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Display Name"
                    className="input-field"
                    required
                />
                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Email address"
                    className="input-field"
                    required
                />
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Password"
                    className="input-field"
                    required
                />

                <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
                    {loading ? 'Creating...' : 'Register'}
                </button>

                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Already have an account? <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Login</Link>
                    </p>
                </div>
            </form>
        </div>
    );
}
