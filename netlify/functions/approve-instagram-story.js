const sharp = require('sharp');

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

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function supabaseHeaders(serviceKey, extra) {
  return Object.assign({
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function requireAuthUser(event, supabaseUrl, serviceKey) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const res = await fetch(supabaseUrl + '/auth/v1/user', {
    headers: {
      apikey: serviceKey,
      Authorization: auth
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function patchRegistration(supabaseUrl, serviceKey, id, fields) {
  const res = await fetch(
    supabaseUrl + '/rest/v1/registrations?id=eq.' + encodeURIComponent(id),
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify(fields)
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error('DB update failed (' + res.status + '): ' + t.slice(0, 200));
  }
}

async function fetchRegistration(supabaseUrl, serviceKey, id) {
  const res = await fetch(
    supabaseUrl + '/rest/v1/registrations?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1',
    { headers: supabaseHeaders(serviceKey) }
  );
  if (!res.ok) throw new Error('Could not load registration (' + res.status + ')');
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

async function fetchCampName(supabaseUrl, serviceKey, campCode) {
  if (!campCode) return '';
  const res = await fetch(
    supabaseUrl + '/rest/v1/camps?slug=eq.' + encodeURIComponent(campCode) + '&select=name,slug&limit=1',
    { headers: supabaseHeaders(serviceKey) }
  );
  if (!res.ok) return campCode;
  const rows = await res.json();
  return (rows && rows[0] && (rows[0].name || rows[0].slug)) || campCode;
}

async function composeStoryImage({ photoUrl, playerName, campName, igHandle }) {
  const W = 1080;
  const H = 1920;
  const photoRes = await fetch(photoUrl);
  if (!photoRes.ok) throw new Error('Could not download registration photo (' + photoRes.status + ')');
  const photoBuf = Buffer.from(await photoRes.arrayBuffer());

  const base = await sharp(photoBuf)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 90 })
    .toBuffer();

  const handleLine = igHandle
    ? `<text x="80" y="${H - 170}" fill="#e8590c" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="36" font-weight="700">${escapeXml(igHandle)}</text>`
    : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="banner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#141a22" stop-opacity="0"/>
      <stop offset="35%" stop-color="#141a22" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#141a22" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${H - 560}" width="${W}" height="560" fill="url(#banner)"/>
  <rect x="48" y="${H - 470}" width="10" height="220" rx="4" fill="#e8590c"/>
  <text x="80" y="${H - 420}" fill="#ffffff" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="44" font-weight="700">REGISTERED</text>
  <text x="80" y="${H - 330}" fill="#ffb63d" font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="58" font-weight="700">${escapeXml(playerName)}</text>
  <text x="80" y="${H - 250}" fill="#ffffff" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="38">${escapeXml(campName)}</text>
  ${handleLine}
</svg>`;

  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function uploadComposedStory(supabaseUrl, serviceKey, campCode, regId, jpegBuf) {
  const path = (campCode || 'camp') + '/stories/' + regId + '-' + Date.now() + '.jpg';
  const res = await fetch(supabaseUrl + '/storage/v1/object/registration-photos/' + path, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: jpegBuf
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Story image upload failed (' + res.status + '): ' + t.slice(0, 200));
  }
  return supabaseUrl + '/storage/v1/object/public/registration-photos/' + path;
}

async function waitForIgContainer(containerId, token) {
  for (let i = 0; i < 25; i++) {
    const res = await fetch(
      'https://graph.facebook.com/v19.0/' + encodeURIComponent(containerId)
        + '?fields=status_code&access_token=' + encodeURIComponent(token)
    );
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.error) {
      throw new Error((data.error && data.error.message) || 'Instagram container failed');
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Timed out waiting for Instagram media container');
}

async function publishInstagramStory({ igUserId, token, imageUrl }) {
  const createUrl = new URL('https://graph.facebook.com/v19.0/' + encodeURIComponent(igUserId) + '/media');
  createUrl.searchParams.set('image_url', imageUrl);
  createUrl.searchParams.set('media_type', 'STORIES');
  createUrl.searchParams.set('access_token', token);

  const createRes = await fetch(createUrl.toString(), { method: 'POST' });
  const createBody = await createRes.json();
  if (!createRes.ok || !createBody.id) {
    throw new Error((createBody.error && createBody.error.message) || ('IG media create failed (' + createRes.status + ')'));
  }

  await waitForIgContainer(createBody.id, token);

  const pubUrl = new URL('https://graph.facebook.com/v19.0/' + encodeURIComponent(igUserId) + '/media_publish');
  pubUrl.searchParams.set('creation_id', createBody.id);
  pubUrl.searchParams.set('access_token', token);

  const pubRes = await fetch(pubUrl.toString(), { method: 'POST' });
  const pubBody = await pubRes.json();
  if (!pubRes.ok || !pubBody.id) {
    throw new Error((pubBody.error && pubBody.error.message) || ('IG media_publish failed (' + pubRes.status + ')'));
  }
  return pubBody.id;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON' }); }

  const registrationId = String(body.registrationId || '').trim();
  const action = String(body.action || 'approve').trim().toLowerCase();
  if (!registrationId) return json(400, { error: 'Missing registrationId.' });
  if (action !== 'approve' && action !== 'reject') {
    return json(400, { error: 'action must be approve or reject.' });
  }

  const user = await requireAuthUser(event, supabaseUrl, serviceKey);
  if (!user) return json(401, { error: 'Sign in required.' });

  try {
    if (action === 'reject') {
      await patchRegistration(supabaseUrl, serviceKey, registrationId, {
        ig_story_status: 'rejected',
        ig_story_error: null
      });
      return json(200, { ok: true, message: 'Rejected — will not post to Instagram.' });
    }

    const igToken = process.env.INSTAGRAM_ACCESS_TOKEN || '';
    const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '';
    if (!igToken || !igUserId) {
      return json(500, {
        error: 'Instagram is not configured (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID).'
      });
    }

    const row = await fetchRegistration(supabaseUrl, serviceKey, registrationId);
    if (!row) return json(404, { error: 'Registration not found.' });
    if (!row.photo_url) return json(400, { error: 'This registration has no photo.' });
    if (row.ig_story_status === 'posted') {
      return json(200, { ok: true, message: 'Already posted.' });
    }
    if (row.ig_story_status === 'rejected') {
      return json(400, { error: 'This registration was rejected. Ask the family to re-register with a photo if needed.' });
    }

    await patchRegistration(supabaseUrl, serviceKey, registrationId, {
      ig_story_status: 'approved',
      ig_story_error: null
    });

    const playerName = ((row.first || '') + ' ' + (row.last || '')).trim() || 'Player';
    const campName = await fetchCampName(supabaseUrl, serviceKey, row.camp_code);
    const jpeg = await composeStoryImage({
      photoUrl: row.photo_url,
      playerName,
      campName: campName || row.camp_code || 'AAU Select Tour',
      igHandle: row.instagram_handle || ''
    });
    const storyUrl = await uploadComposedStory(
      supabaseUrl,
      serviceKey,
      row.camp_code || 'camp',
      registrationId,
      jpeg
    );
    const mediaId = await publishInstagramStory({
      igUserId,
      token: igToken,
      imageUrl: storyUrl
    });

    await patchRegistration(supabaseUrl, serviceKey, registrationId, {
      ig_story_status: 'posted',
      ig_story_posted_at: new Date().toISOString(),
      ig_story_error: null
    });

    return json(200, {
      ok: true,
      message: 'Story posted to Instagram.',
      mediaId,
      storyUrl
    });
  } catch (err) {
    const msg = (err && err.message) ? String(err.message).slice(0, 400) : 'Unknown error';
    try {
      await patchRegistration(supabaseUrl, serviceKey, registrationId, {
        ig_story_status: 'failed',
        ig_story_error: msg
      });
    } catch (e2) { /* ignore secondary failure */ }
    return json(500, { error: msg });
  }
};
