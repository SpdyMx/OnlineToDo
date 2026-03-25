import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { ShieldCheck } from 'lucide-react';

export default function ResetPassword() {
    const navigate = useNavigate();
    const location = useLocation();
    const [token, setToken] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const t = params.get('token');
        if (t) setToken(t);
    }, [location]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) {
            toast.error('Missing reset token');
            return;
        }
        setLoading(true);
        try {
            await fetchWithAuth('/reset-password', {
                method: 'POST',
                body: JSON.stringify({ token, password }),
            });
            toast.success('Password changed successfully');
            navigate('/login');
        } catch (err: any) {
            toast.error(err.message || 'Failed to reset password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container animate-slide-in glass-panel">
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <ShieldCheck size={48} color="var(--accent)" style={{ margin: '0 auto' }} />
                <h1 className="heading" style={{ marginBottom: '0.5rem' }}>Create New Password</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Choose a secure password</p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="New Password"
                    className="input-field"
                    required
                    minLength={6}
                />

                <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
                    {loading ? 'Saving...' : 'Reset Password'}
                </button>

                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 600 }}>Cancel</Link>
                    </p>
                </div>
            </form>
        </div>
    );
}
