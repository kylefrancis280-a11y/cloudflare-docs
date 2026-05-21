const https = require('https');
const crypto = require('crypto');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'atlas-secret-key-change-in-prod';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function httpsPost(hostname, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPostForm(hostname, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(password) {
  return crypto.createHmac('sha256', JWT_SECRET).update(password).digest('hex');
}

async function firebaseSignUp(email, password) {
  return httpsPost('identitytoolkit.googleapis.com',
    `/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    { email, password, returnSecureToken: true });
}

async function firebaseSignIn(email, password) {
  return httpsPost('identitytoolkit.googleapis.com',
    `/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    { email, password, returnSecureToken: true });
}

async function createStripeCheckout(priceId, email, plan) {
  const res = await httpsPostForm('api.stripe.com', '/v1/checkout/sessions', {
    'payment_method_types[]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'subscription',
    customer_email: email,
    success_url: 'https://atlasanalysis.net/dashboard.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://atlasanalysis.net/?canceled=true',
    'metadata[plan]': plan,
    'metadata[email]': email,
  }, { Authorization: `Bearer ${STRIPE_SECRET_KEY}` });
  return res;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, email, password, plan, priceId, token } = JSON.parse(event.body || '{}');

    if (action === 'signup') {
      const res = await firebaseSignUp(email, password);
      if (res.status !== 200) return { statusCode: 400, headers, body: JSON.stringify({ error: res.body.error?.message || 'Signup failed' }) };
      const jwt = makeJWT({ uid: res.body.localId, email, plan: 'free' });
      return { statusCode: 200, headers, body: JSON.stringify({ token: jwt, email, plan: 'free' }) };
    }

    if (action === 'login') {
      const res = await firebaseSignIn(email, password);
      if (res.status !== 200) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid credentials' }) };
      const jwt = makeJWT({ uid: res.body.localId, email, plan: 'free' });
      return { statusCode: 200, headers, body: JSON.stringify({ token: jwt, email, plan: 'free' }) };
    }

    if (action === 'checkout') {
      const priceMap = {
        core: process.env.STRIPE_PRICE_CORE,
        pro: process.env.STRIPE_PRICE_PRO,
        institutional: process.env.STRIPE_PRICE_INSTITUTIONAL
      };
      const selectedPrice = priceMap[plan] || priceId;
      if (!selectedPrice) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
      const res = await createStripeCheckout(selectedPrice, email, plan);
      if (res.status !== 200) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Checkout failed' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ url: res.body.url }) };
    }

    if (action === 'verify') {
      const payload = verifyJWT(token);
      if (!payload) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ valid: true, ...payload }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
