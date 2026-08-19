/**
 * HTTP nomination invite sender.
 * Scheduled functions cannot be called by URL (they 403), so this
 * is the invokable path for admin Send and catch-up of due invites.
 *
 * POST JSON:
 *   { "sendDue": true }           — send invites at least 3 hours old
 *   { "id": "<uuid>", "sendNow": true } — send one invite immediately (auth required)
 */
const { run } = require('../lib/nomination-invites');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function requireAuthUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const url = (process.env.SUPABASE_URL || 'https://nxncasbkrcermftbviuw.supabase.co').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  const res = await fetch(url + '/auth/v1/user', {
    headers: { apikey: key, Authorization: auth }
  });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'POST only' });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const id = body.id ? String(body.id) : '';
  const sendNow = !!body.sendNow;
  const sendDue = !!body.sendDue || (!id && !sendNow);

  if (sendNow) {
    const user = await requireAuthUser(event);
    if (!user) return json(401, { ok: false, error: 'Sign in to send an invitation now.' });
    if (!id) return json(400, { ok: false, error: 'Missing nomination id' });
    const result = await run({ id, skipDelay: true });
    return json(result.statusCode, result.body);
  }

  if (id) {
    const result = await run({ id });
    return json(result.statusCode, result.body);
  }

  if (sendDue) {
    const result = await run({});
    return json(result.statusCode, result.body);
  }

  return json(400, { ok: false, error: 'Nothing to send' });
};
