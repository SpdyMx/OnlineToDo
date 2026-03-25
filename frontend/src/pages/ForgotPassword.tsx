import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { KeyRound } from 'lucide-react';

export default function ForgotPassword() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await fetchWithAuth('/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });
            setSent(true);
            toast.success('If the email exists, a reset link was sent.');
        } catch (err: any) {
            toast.error('Failed to request reset');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container animate-slide-in glass-panel">
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <KeyRound size={48} color="var(--accent)" style={{ margin: '0 auto' }} />
                <h1 className="heading" style={{ marginBottom: '0.5rem' }}>Reset Password</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Get a link to reset your password</p>
            </div>

            {sent ? (
                <div style={{ textAlign: 'center' }}>
                    <p style={{ marginBottom: '1.5rem' }}>Check your email inbox for the reset link.</p>
                    <Link to="/login" className="btn btn-outline">Back to Login</Link>
                </div>
            ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="Account Email"
                        className="input-field"
                        required
                    />

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
                        {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>

                    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Remembered your password? <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Login</Link>
                        </p>
                    </div>
                </form>
            )}
        </div>
    );
}
