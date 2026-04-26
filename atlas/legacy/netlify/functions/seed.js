// DISABLED — this function previously seeded hardcoded password hashes
// directly into Firebase. It must never be deployed to production.
//
// To create admin/analyst accounts, use the Workers admin bootstrap endpoint:
//   POST /api/admin
//   Header: X-Admin-Bootstrap: <ADMIN_BOOTSTRAP_TOKEN>
//   Body:   {"action":"create-staff","email":"...","name":"...","password":"...","role":"admin"}
//
// See atlas/workers/src/handlers/admin.ts

exports.handler = async () => ({
  statusCode: 410,
  body: JSON.stringify({ error: 'Seed endpoint disabled. Use the Workers admin bootstrap.' }),
});
