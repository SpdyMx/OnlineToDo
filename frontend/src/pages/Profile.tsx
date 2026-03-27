import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { ArrowLeft, User, Shield } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface UserProfile {
    name: string;
    display_name: string;
    primary_mail: string;
    recovery_mail: string;
    '2fa_enabled': boolean;
    is_verified: boolean;
}

export default function Profile() {
    const [profile, setProfile] = useState<UserProfile | null>(null);

    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [primaryMail, setPrimaryMail] = useState('');
    const [recoveryMail, setRecoveryMail] = useState('');
    const [password, setPassword] = useState('');

    const [twoFactorSecret, setTwoFactorSecret] = useState('');
    const [twoFactorCode, setTwoFactorCode] = useState('');

    const loadData = async () => {
        try {
            const data = await fetchWithAuth('/me');
            setProfile(data);
            setName(data.name || '');
            setDisplayName(data.display_name || '');
            setPrimaryMail(data.primary_mail || '');
            setRecoveryMail(data.recovery_mail || '');
        } catch (err) {
            toast.error('Failed to load profile');
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetchWithAuth('/me/update', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    displayName,
                    primaryMail,
                    recoveryMail,
                    password: password ? password : undefined
                })
            });
            toast.success('Profile updated');
            setPassword('');
            loadData();
        } catch (err) {
            toast.error('Failed to update profile');
        }
    };

    const handleGenerate2FA = async () => {
        try {
            const data = await fetchWithAuth('/me/2fa/generate', { method: 'POST' });
            setTwoFactorSecret(data.secret);
        } catch (err) {
            toast.error('Failed to generate 2FA secret');
        }
    };

    const handleActivate2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetchWithAuth('/me/2fa/activate', {
                method: 'POST',
                body: JSON.stringify({ secret: twoFactorSecret, code: twoFactorCode })
            });
            toast.success('2FA Activated Successfully');
            setTwoFactorSecret('');
            setTwoFactorCode('');
            loadData();
        } catch (err: any) {
            toast.error(err.message || 'Failed to activate 2FA');
        }
    };

    const handleRemove2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetchWithAuth('/me/2fa/remove', {
                method: 'POST',
                body: JSON.stringify({ code: twoFactorCode })
            });
            toast.success('2FA Disabled');
            setTwoFactorCode('');
            loadData();
        } catch (err: any) {
            toast.error(err.message || 'Failed to remove 2FA');
        }
    };

    if (!profile) return null;

    return (
        <div className="app-container">
            <nav className="navbar" style={{ justifyContent: 'flex-start' }}>
                <Link to="/" className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 1rem' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </Link>
            </nav>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>

                <div className="glass-panel animate-slide-in">
                    <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <User size={24} color="var(--accent)" /> General Information
                    </h2>
                    <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                                Email <span style={{ color: profile.is_verified ? 'var(--success)' : 'var(--danger)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{profile.is_verified ? '(Verified)' : '(Unverified)'}</span>
                            </label>
                            <input type="email" value={primaryMail} onChange={e => setPrimaryMail(e.target.value)} className="input-field" required />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Full Name</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} className="input-field" required />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Display Name</label>
                            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="input-field" required />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Recovery Email (Optional)</label>
                            <input type="email" value={recoveryMail} onChange={e => setRecoveryMail(e.target.value)} className="input-field" />
                        </div>

                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>New Password (Optional)</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="Leave blank to keep current" />
                        </div>

                        <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Changes</button>
                    </form>
                </div>

                <div className="glass-panel animate-slide-in" style={{ animationDelay: '0.1s' }}>
                    <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Shield size={24} color="var(--accent)" /> Two-Factor Authentication
                    </h2>

                    {profile['2fa_enabled'] ? (
                        <div>
                            <div style={{ padding: '1rem', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', border: '1px solid var(--success)', marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <CheckCircle size={20} /> 2FA is currently enabled on your account.
                            </div>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>To disable 2FA, please verify your current code below.</p>

                            <form onSubmit={handleRemove2FA} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <input type="text" placeholder="6-digit code from your app" value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value)} className="input-field" required />
                                <button type="submit" className="btn btn-danger" style={{ alignSelf: 'flex-start' }}>Disable 2FA</button>
                            </form>
                        </div>
                    ) : (
                        <div>
                            {!twoFactorSecret ? (
                                <>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                                        Enhance your account security by enabling Two-Factor Authentication (2FA). You will need an authenticator app like Google Authenticator or Authy.
                                    </p>
                                    <button className="btn btn-primary" onClick={handleGenerate2FA}>Setup 2FA</button>
                                </>
                            ) : (
                                <div className="animate-slide-in">
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>1. Scan this QR code with your authenticator app</p>
                                    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', display: 'inline-block', marginBottom: '1rem' }}>
                                        <QRCodeSVG value={`otpauth://totp/OnlineToDo:${profile.primary_mail}?secret=${twoFactorSecret}&issuer=OnlineToDo`} size={150} />
                                    </div>

                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                                        Or enter this secret manually: <br /><strong style={{ color: 'var(--text-primary)', letterSpacing: '1px', fontSize: '1.1rem' }}>{twoFactorSecret}</strong>
                                    </p>

                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>2. Enter the code generated by your app to verify</p>
                                    <form onSubmit={handleActivate2FA} style={{ display: 'flex', gap: '1rem' }}>
                                        <input type="text" placeholder="6-digit code" value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value)} className="input-field" style={{ margin: 0 }} required />
                                        <button type="submit" className="btn btn-primary">Verify & Activate</button>
                                    </form>
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}

const CheckCircle = ({ size }: { size: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
);
