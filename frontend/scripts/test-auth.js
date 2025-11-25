// Native fetch is available in Node 18+

const BASE_URL = 'http://localhost:3000/api/auth';
const EMAIL = `test-${Date.now()}@example.com`;
const PASSWORD = 'password123';

async function testAuth() {
    console.log('Testing Signup...');
    const signupRes = await fetch(`${BASE_URL}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, fullName: 'Test User' }),
    });
    const signupData = await signupRes.json();
    console.log('Signup:', signupRes.status, signupData);

    if (signupRes.status !== 200) return;

    console.log('Testing Login (Unverified)...');
    const loginRes1 = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const loginData1 = await loginRes1.json();
    console.log('Login (Unverified):', loginRes1.status, loginData1);

    // Note: Cannot easily test verification without reading DB or logs for token.
    // This script assumes manual verification or DB access to get token.
    console.log('Please verify user manually via DB or logs to continue testing login.');
}

testAuth();
