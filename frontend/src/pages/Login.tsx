import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { ListTodo } from 'lucide-react';

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [requires2FA, setRequires2FA] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data = await fetchWithAuth('/login', {
                method: 'POST',
                body: JSON.stringify({ primaryMail: email, password, twoFactorCode }),
            });
            localStorage.setItem('token', data.token);
            if (data.userSalt) localStorage.setItem('userSalt', data.userSalt);
            if (data.sessionPepper) localStorage.setItem('sessionPepper', data.sessionPepper);
            toast.success('Successfully logged in');
            navigate('/');
            window.location.reload();
        } catch (err: any) {
            if (err.message === '2FA required') {
                setRequires2FA(true);
                toast('Please enter your 2FA code', { icon: '🔐' });
            } else {
                toast.error(err.message || 'Login failed');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container animate-slide-in glass-panel">
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <ListTodo size={48} color="var(--accent)" style={{ margin: '0 auto' }} />
                <h1 className="heading" style={{ marginBottom: '0.5rem' }}>Welcome Back</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Login to online ToDo</p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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

                {requires2FA && (
                    <input
                        type="text"
                        value={twoFactorCode}
                        onChange={e => setTwoFactorCode(e.target.value)}
                        placeholder="2FA Code"
                        className="input-field animate-slide-in"
                        required
                    />
                )}

                <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
                    {loading ? 'Logging in...' : 'Sign In'}
                </button>

                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Don't have an account? <Link to="/register" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Create one</Link>
                    </p>
                </div>
            </form>
        </div>
    );
}
