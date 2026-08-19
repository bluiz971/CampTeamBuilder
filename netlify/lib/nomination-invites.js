/**
 * Shared nomination-invite sender used by the scheduled function and
 * the HTTP function (admin Send / catch-up).
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY          (preferred) or SENDGRID_API_KEY
 *   MAIL_FROM               e.g. "AAU Select Tour <info@aauselecttour.com>"
 *   SITE_BASE_URL           optional, default https://selecttourevents.com
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DELAY_MS = 3 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TPL_W = 819;
const TPL_H = 1024;
const SCALE = 1;
const PHOTO = { x: 160, y: 446, w: 500, h: 340 };
const BAR = { x: 120, y: 786, w: 571, h: 110 };
const CAMP_BOX = { x: 140, y: 938, w: 540, h: 48 };
const NAVY = '#082554';
const RED = '#ff3355';
const DEFAULT_SITE = 'https://selecttourevents.com';
const DEFAULT_SUPABASE_URL = 'https://nxncasbkrcermftbviuw.supabase.co';

function supabaseUrl(){
  return (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
}

function px(n){ return Math.round(n * SCALE); }

function inviteCampLabel(row){
  let n = String((row && row.camp_name) || '').trim();
  n = n.replace(/\s+(High School|Middle School)$/i, '');
  if (!n) n = String((row && row.camp_code) || '').replace(/-?\d{4}$/, '').replace(/-/g, ' ');
  return n.replace(/\s+/g, ' ').trim().toUpperCase() || 'CAMP';
}

function escapeXml(s){
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function templatePath(){
  const names = [
    path.join(process.cwd(), 'assets/invite-template.png'),
    path.join(__dirname, '../../assets/invite-template.png'),
    path.join(__dirname, '../functions/invite-template.png'),
    path.join(__dirname, 'invite-template.png')
  ];
  for (const p of names){
    if (fs.existsSync(p)) return p;
  }
  throw new Error('invite-template.png not found (include assets/invite-template.png in the function bundle)');
}

function mailConfigured(){
  return !!(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
}

function assertConfigured(){
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — add it in Netlify for All functions (same key the Stripe functions use).');
  }
  if (!mailConfigured()) {
    throw new Error('No email provider configured (set RESEND_API_KEY or SENDGRID_API_KEY, plus MAIL_FROM).');
  }
}

async function supabase(restPath, opts = {}){
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — add it in Netlify for All functions (same key the Stripe functions use).');
  const res = await fetch(url + '/rest/v1/' + restPath, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e){ body = text; }
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 300));
  return body;
}

function parseFrom(raw){
  const s = String(raw || '').trim();
  const m = s.match(/^(.*)<([^>]+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || 'AAU Select Tour', email: m[2].trim() };
  if (s.includes('@')) return { name: 'AAU Select Tour', email: s };
  return { name: 'AAU Select Tour', email: 'info@aauselecttour.com' };
}

function playerEmail(row){
  const direct = String(row.player_email || '').trim();
  if (direct) return direct;
  if (row.nominator_type === 'self') return String(row.nominator_email || '').trim();
  return '';
}

function selectFields(){
  return 'id,camp_code,camp_name,nominator_type,nominator_email,player_name,player_email,grad_year,home_state,instagram_handle,photo_url,invite_attempts,submitted_at';
}

async function composeInvitePng(row){
  const W = px(TPL_W);
  const H = px(TPL_H);
  const photoBox = { x: px(PHOTO.x), y: px(PHOTO.y), w: px(PHOTO.w), h: px(PHOTO.h) };
  const bar = { x: px(BAR.x), y: px(BAR.y), w: px(BAR.w), h: px(BAR.h) };
  const camp = { x: px(CAMP_BOX.x), y: px(CAMP_BOX.y), w: px(CAMP_BOX.w), h: px(CAMP_BOX.h) };

  const base = await sharp(templatePath())
    .resize(W, H, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const layers = [];
  if (row.photo_url){
    const photoRes = await fetch(row.photo_url);
    if (!photoRes.ok) throw new Error('Could not download nomination photo (' + photoRes.status + ')');
    const photoBuf = Buffer.from(await photoRes.arrayBuffer());
    const cropped = await sharp(photoBuf)
      .rotate()
      .resize(photoBox.w, photoBox.h, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();
    layers.push({ input: cropped, left: photoBox.x, top: photoBox.y });
  }

  const name = String(row.player_name || 'Player').trim();
  const year = String(row.grad_year || '').trim();
  const handle = String(row.instagram_handle || '').replace(/^@+/, '').trim();
  const state = String(row.home_state || '').trim().toUpperCase();
  const campName = inviteCampLabel(row);
  const nameSize = name.length > 20 ? 30 : name.length > 16 ? 34 : 38;
  const campSize = campName.length > 18 ? 26 : campName.length > 12 ? 32 : 36;
  const handleShown = handle ? '@' + handle : '';
  const leftX = bar.x + 36;
  const midX = bar.x + bar.w / 2;
  const rightX = bar.x + bar.w - 36;
  const nameY = bar.y + 48;
  const valueY = bar.y + 78;
  const labelY = bar.y + 98;
  const campMidX = camp.x + camp.w / 2;
  const campTextY = camp.y + camp.h / 2 + 12;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" fill="${NAVY}"/>
  <text x="${midX}" y="${nameY}" text-anchor="middle" fill="#ffffff"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="${nameSize}" font-style="italic" font-weight="800" letter-spacing="1">${escapeXml(name.toUpperCase())}</text>
  <text x="${leftX}" y="${valueY}" text-anchor="start" fill="${RED}"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="18" font-style="italic" font-weight="800">${escapeXml(year)}</text>
  <text x="${leftX}" y="${labelY}" text-anchor="start" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="9" font-weight="700" letter-spacing="2">CLASS</text>
  <text x="${midX}" y="${valueY}" text-anchor="middle" fill="${RED}"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="16" font-style="italic" font-weight="800">${escapeXml(handleShown)}</text>
  <text x="${midX}" y="${labelY}" text-anchor="middle" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="9" font-weight="700" letter-spacing="2">USERNAME</text>
  <text x="${rightX}" y="${valueY}" text-anchor="end" fill="${RED}"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="18" font-style="italic" font-weight="800">${escapeXml(state)}</text>
  <text x="${rightX}" y="${labelY}" text-anchor="end" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="9" font-weight="700" letter-spacing="2">STATE</text>
  <rect x="${camp.x}" y="${camp.y}" width="${camp.w}" height="${camp.h}" fill="#ececec"/>
  <text x="${campMidX}" y="${campTextY}" text-anchor="middle" fill="#0a1e4a"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="${campSize}" font-style="italic" font-weight="800">${escapeXml(campName)}</text>
</svg>`;

  layers.push({ input: Buffer.from(svg), top: 0, left: 0 });

  return sharp(base)
    .composite(layers)
    .png()
    .toBuffer();
}

function resendError(body, status){
  if (!body || typeof body !== 'object') return 'Resend failed (' + status + ')';
  return body.message || (body.error && (body.error.message || body.error)) || ('Resend failed (' + status + ')');
}

async function sendEmail({ to, subject, html, png, filename }){
  const from = parseFrom(process.env.MAIL_FROM || 'AAU Select Tour <info@aauselecttour.com>');
  const resendKey = process.env.RESEND_API_KEY || '';
  const sendgridKey = process.env.SENDGRID_API_KEY || '';
  const attachmentB64 = png.toString('base64');

  if (resendKey){
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to: [to],
        subject,
        html,
        attachments: [{ filename, content: attachmentB64 }]
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(resendError(body, res.status));
    return { provider: 'resend', id: body.id };
  }

  if (sendgridKey){
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + sendgridKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from.email, name: from.name },
        subject,
        content: [{ type: 'text/html', value: html }],
        attachments: [{
          content: attachmentB64,
          filename,
          type: 'image/png',
          disposition: 'attachment'
        }]
      })
    });
    if (!res.ok){
      const t = await res.text();
      throw new Error('SendGrid failed (' + res.status + '): ' + t.slice(0, 200));
    }
    return { provider: 'sendgrid' };
  }

  throw new Error('No email provider configured (set RESEND_API_KEY or SENDGRID_API_KEY, plus MAIL_FROM).');
}

function inviteHtml(row, registerUrl){
  const name = escapeXml(row.player_name || 'Player');
  const camp = escapeXml(row.camp_name || 'District Select Camp');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#141a22;line-height:1.5;max-width:560px">
<p>Hi ${name},</p>
<p>You’ve been invited to the <b>AAU Select Tour ${camp}</b> District Select Basketball Camp.</p>
<p>Your official invitation graphic is attached. Save it and share it — then register to reserve your spot.</p>
<p><a href="${escapeXml(registerUrl)}" style="display:inline-block;background:#e8590c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Register for camp</a></p>
<p style="font-size:13px;color:#6b7280">An invitation does not reserve a spot until registration and payment are completed.</p>
<p>AAU Select Tour<br>www.aauselecttour.com</p>
</div>`;
}

async function processRow(row){
  const to = playerEmail(row);
  if (!to) throw new Error('No player email on this nomination');
  const png = await composeInvitePng(row);
  const base = (process.env.SITE_BASE_URL || DEFAULT_SITE).replace(/\/$/, '');
  const registerUrl = base + '/register.html?camp=' + encodeURIComponent(row.camp_code || '');
  const filename = String(row.player_name || 'player').replace(/[^\w]+/g, '_') + '_invited.png';
  await sendEmail({
    to,
    subject: nameSubject(row),
    html: inviteHtml(row, registerUrl),
    png,
    filename
  });
}

function nameSubject(row){
  const first = String(row.player_name || 'Player').trim().split(/\s+/)[0] || 'Player';
  return first + ', you’re invited to AAU Select Tour District Select Camp';
}

async function markRow(id, fields){
  await supabase('nominations?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify(fields)
  });
}

/**
 * @param {{ id?: string, skipDelay?: boolean }} opts
 */
async function run(opts = {}){
  try {
    assertConfigured();
  } catch (e) {
    const msg = e.message || String(e);
    console.error('nomination-invites config', msg);
    return { statusCode: 500, body: { ok: false, error: msg } };
  }

  const onlyId = opts.id ? String(opts.id) : '';
  const skipDelay = !!opts.skipDelay;
  const cutoff = new Date(Date.now() - DELAY_MS).toISOString();

  let rows = [];
  try {
    if (onlyId){
      rows = await supabase(
        'nominations?id=eq.' + encodeURIComponent(onlyId) +
        '&invite_sent_at=is.null&select=' + selectFields()
      );
    } else {
      rows = await supabase(
        'nominations?invite_sent_at=is.null' +
        '&submitted_at=lte.' + encodeURIComponent(cutoff) +
        '&select=' + selectFields() +
        '&order=submitted_at.asc&limit=10'
      );
    }
  } catch (e) {
    const msg = e.message || String(e);
    console.error('nomination-invites fetch', msg);
    return { statusCode: 500, body: { ok: false, error: msg } };
  }

  const list = rows || [];
  if (onlyId && list[0] && !skipDelay){
    const submitted = Date.parse(list[0].submitted_at || '') || 0;
    if (submitted && Date.now() - submitted < DELAY_MS){
      return { statusCode: 200, body: { ok: true, sent: 0, failed: 0, message: 'Not due yet' } };
    }
  }

  const due = [];
  const skipped = [];
  for (const r of list){
    if ((Number(r.invite_attempts) || 0) >= MAX_ATTEMPTS){
      skipped.push({ id: r.id, status: 'max_attempts' });
      continue;
    }
    if (!playerEmail(r)){
      await markRow(r.id, {
        invite_error: 'No player email on this nomination',
        invite_attempts: (Number(r.invite_attempts) || 0) + 1
      }).catch(() => {});
      skipped.push({ id: r.id, status: 'no_email' });
      continue;
    }
    due.push(r);
  }

  if (!due.length){
    return { statusCode: 200, body: { ok: true, sent: 0, failed: 0, message: 'Nothing due', skipped: skipped.length } };
  }

  let sent = 0;
  let failed = 0;
  const results = [];

  for (const row of due){
    const attempts = (Number(row.invite_attempts) || 0) + 1;
    try {
      await processRow(row);
      await markRow(row.id, {
        invite_sent_at: new Date().toISOString(),
        invite_error: null,
        invite_attempts: attempts
      });
      sent++;
      results.push({ id: row.id, status: 'sent' });
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 400);
      await markRow(row.id, {
        invite_error: msg,
        invite_attempts: attempts
      }).catch(() => {});
      failed++;
      results.push({ id: row.id, status: 'failed', error: msg });
    }
  }

  console.log('nomination-invites', { sent, failed, total: due.length });
  return { statusCode: sent && !failed ? 200 : (failed && !sent ? 500 : 200), body: { ok: failed === 0, sent, failed, results } };
}

module.exports = { run, DELAY_MS };
