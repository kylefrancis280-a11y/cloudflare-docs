const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;

const TEAM = [
  { email: 'kyle@atlasanalysis.net', name: 'Kyle', password_hash: '36528548bad31d9c58f9300aba765aaa874fb3c302cfd1f9f2fda6d1ed7985a7', role: 'admin', subscription_status: 'active' },
  { email: 'scott@atlasanalysis.net', name: 'Scott', password_hash: '36528548bad31d9c58f9300aba765aaa874fb3c302cfd1f9f2fda6d1ed7985a7', role: 'analyst', subscription_status: 'active' },
  { email: 'mark@jftire.ca', name: 'Mark', password_hash: '36528548bad31d9c58f9300aba765aaa874fb3c302cfd1f9f2fda6d1ed7985a7', role: 'analyst', subscription_status: 'active' },
  { email: 'steve@atlasanalysis.net', name: 'Steve', password_hash: '36528548bad31d9c58f9300aba765aaa874fb3c302cfd1f9f2fda6d1ed7985a7', role: 'analyst', subscription_status: 'active' },
  { email: 'mdiskin', name: 'M. Diskin', password_hash: '13b6554184c7aacbc2d0fcd5976769bbd9817eb59d6e6248e6da9541761d9ba9', role: 'analyst', subscription_status: 'active' },
  { email: 'tester1', name: 'Core Tester', password_hash: '7abcddbb2c74e4c0789c2c0aa6abcf5172e82e9f4916bc6409fc3989ed673e08', role: 'subscriber', subscription_status: 'active', tier: 'core' },
  { email: 'tester2', name: 'Pro Tester', password_hash: '7cd477192d54ceb8673be093f443b8622c612896880f6879c7f8ec16fa7ba114', role: 'subscriber', subscription_status: 'active', tier: 'pro' },
  { email: 'tester3', name: 'Institutional Tester', password_hash: '7c9543538b43366b6d5c0926e3eb20b3efd122ce5d654afff907f2d134fe4f03', role: 'subscriber', subscription_status: 'active', tier: 'institutional' }
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: '<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto;background:#0b0e18;color:#e2e8f0"><h2>Atlas — Seed Team Accounts</h2><p>Click below to add team accounts to Firebase. Run once.</p><form method="POST"><button style="padding:12px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer">Seed Now</button></form></body></html>' };
  }
  if (!SECRET) return { statusCode: 500, body: JSON.stringify({ error: 'Set FIREBASE_DB_SECRET in Netlify env vars' }) };
  try {
    let added = 0, skipped = 0;
    for (const u of TEAM) {
      const res = await fetch(`${DB}/users.json?auth=${SECRET}&orderBy="email"&equalTo="${u.email}"`);
      const data = await res.json();
      if (data && Object.keys(data).length) { skipped++; continue; }
      await fetch(`${DB}/users.json?auth=${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...u, created_at: new Date().toISOString() }) });
      added++;
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: `<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto;background:#0b0e18;color:#e2e8f0"><h2>✓ Done!</h2><p>${added} accounts created, ${skipped} already existed.</p><p>You can close this page.</p></body></html>` };
  } catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};
