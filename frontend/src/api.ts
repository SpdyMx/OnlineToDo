export const API_URL = '/api';

const arrayBufferToBase64 = (buffer: ArrayBuffer | Uint8Array) => {
    let binary = '';
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const base64ToArrayBuffer = (base64: string) => {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
};

const getDerivedKey = async (userSalt: string, sessionPepper: string) => {
    const keyData = new TextEncoder().encode('P@1atf0rmK3y_OOnl1neT0Do!' + userSalt + sessionPepper);
    const hash = await crypto.subtle.digest('SHA-256', keyData);
    return await crypto.subtle.importKey('raw', hash, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
};

export const encryptE2E = async (data: string) => {
    const userSalt = localStorage.getItem('userSalt');
    const sessionPepper = localStorage.getItem('sessionPepper');
    if (!userSalt || !sessionPepper) return data;
    try {
        const key = await getDerivedKey(userSalt, sessionPepper);
        const iv = crypto.getRandomValues(new Uint8Array(16));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(data));
        const b64Encrypted = arrayBufferToBase64(encrypted);
        const b64Iv = arrayBufferToBase64(iv);
        return btoa(b64Encrypted + '::' + b64Iv);
    } catch (e) { return data; }
};

export const decryptE2E = async (payload: string) => {
    const userSalt = localStorage.getItem('userSalt');
    const sessionPepper = localStorage.getItem('sessionPepper');
    if (!userSalt || !sessionPepper) return payload;
    try {
        const decodedPayload = window.atob(payload);
        const parts = decodedPayload.split('::');
        if (parts.length !== 2) return payload;
        const key = await getDerivedKey(userSalt, sessionPepper);
        const encryptedBytes = base64ToArrayBuffer(parts[0]);
        const ivBytes = base64ToArrayBuffer(parts[1]);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(ivBytes) }, key, encryptedBytes);
        return new TextDecoder().decode(decrypted);
    } catch (e) { return payload; }
};

export const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('token');
    const headers = new Headers(options.headers || {});

    const isPublic = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password'].includes(endpoint);

    headers.set('Content-Type', 'application/json');
    if (token && !isPublic) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    if (options.body && typeof options.body === 'string' && token && !isPublic) {
        options.body = await encryptE2E(options.body);
        headers.set('Content-Type', 'text/plain');
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/plain')) {
        const encryptedText = await response.text();
        const decryptedJson = await decryptE2E(encryptedText);
        try {
            const data = JSON.parse(decryptedJson);
            if (!response.ok) throw new Error(data.error || 'API Error');
            return data;
        } catch {
            return decryptedJson;
        }
    }

    if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'API Error');
        }
        return data;
    }

    return response.text();
};
