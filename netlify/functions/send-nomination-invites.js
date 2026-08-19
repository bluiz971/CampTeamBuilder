/**
 * Netlify scheduled function — email nomination invitation graphics
 * 3 hours after submit. The public form never shows the invite.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY          (preferred) or SENDGRID_API_KEY
 *   MAIL_FROM               e.g. "AAU Select Tour <invites@yourdomain.com>"
 *   SITE_BASE_URL           optional, default https://selecttour.camphq.net
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DELAY_MS = 3 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TPL_W = 792;
const TPL_H = 988;
const SCALE = 2;
const PHOTO = { x: 188, y: 430, w: 416, h: 326 };
const BAR = { x: 161, y: 754, w: 470, h: 96 };
const CAMP_BOX = { x: 70, y: 896, w: 652, h: 46 };
const NAVY = '#082554';
const DEFAULT_SITE = 'https://selecttour.camphq.net';

function px(n){ return Math.round(n * SCALE); }

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
    path.join(__dirname, '../../assets/invite-template.png'),
    path.join(process.cwd(), 'assets/invite-template.png'),
    path.join(__dirname, 'invite-template.png')
  ];
  for (const p of names){
    if (fs.existsSync(p)) return p;
  }
  throw new Error('invite-template.png not found (include assets/invite-template.png in the function bundle)');
}

async function supabase(restPath, opts = {}){
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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
  return { name: 'AAU Select Tour', email: 'noreply@aauselecttour.com' };
}

function playerEmail(row){
  const direct = String(row.player_email || '').trim();
  if (direct) return direct;
  if (row.nominator_type === 'self') return String(row.nominator_email || '').trim();
  return '';
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
  const campName = String(row.camp_name || '').trim() || 'District Select Camp';
  const nameSize = name.length > 22 ? 44 : name.length > 16 ? 54 : 64;
  const campSize = campName.length > 22 ? 40 : campName.length > 16 ? 48 : 56;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" fill="${NAVY}"/>
  <text x="${bar.x + bar.w / 2}" y="${bar.y + 76}" text-anchor="middle" fill="#ffffff"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="${nameSize}" font-style="italic" font-weight="800">${escapeXml(name)}</text>
  <text x="${bar.x + 32}" y="${bar.y + 148}" text-anchor="start" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="26">${escapeXml(year)}</text>
  <text x="${bar.x + bar.w / 2}" y="${bar.y + 148}" text-anchor="middle" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="26">${escapeXml(handle)}</text>
  <text x="${bar.x + bar.w - 32}" y="${bar.y + 148}" text-anchor="end" fill="#ffffff"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="26">${escapeXml(state)}</text>
  <rect x="${camp.x}" y="${camp.y}" width="${camp.w}" height="${camp.h}" fill="#f7f7f7"/>
  <text x="${camp.x + camp.w / 2}" y="${camp.y + camp.h / 2 + 16}" text-anchor="middle" fill="${NAVY}"
    font-family="Arial Black, Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="${campSize}" font-weight="800">${escapeXml(campName)}</text>
</svg>`;

  layers.push({ input: Buffer.from(svg), top: 0, left: 0 });

  return sharp(base)
    .composite(layers)
    .png()
    .toBuffer();
}

async function sendEmail({ to, subject, html, png, filename }){
  const from = parseFrom(process.env.MAIL_FROM || 'AAU Select Tour <noreply@aauselecttour.com>');
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
    if (!res.ok) throw new Error((body && (body.message || body.error)) || ('Resend failed (' + res.status + ')'));
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

exports.handler = async () => {
  const cutoff = new Date(Date.now() - DELAY_MS).toISOString();
  let rows = [];
  try {
    rows = await supabase(
      'nominations?invite_sent_at=is.null' +
      '&submitted_at=lte.' + encodeURIComponent(cutoff) +
      '&select=id,camp_code,camp_name,nominator_type,nominator_email,player_name,player_email,grad_year,home_state,instagram_handle,photo_url,invite_attempts,submitted_at' +
      '&order=submitted_at.asc&limit=20'
    );
  } catch (e) {
    const msg = e.message || String(e);
    console.error('send-nomination-invites fetch', msg);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: msg }) };
  }

  const due = (rows || []).filter((r) => (Number(r.invite_attempts) || 0) < MAX_ATTEMPTS && playerEmail(r));
  if (!due.length){
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, failed: 0, message: 'Nothing due' }) };
  }

  let sent = 0;
  let failed = 0;
  const results = [];

  for (const row of due){
    const attempts = (Number(row.invite_attempts) || 0) + 1;
    try {
      await processRow(row);
      await supabase('nominations?id=eq.' + encodeURIComponent(row.id), {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          invite_sent_at: new Date().toISOString(),
          invite_error: null,
          invite_attempts: attempts
        })
      });
      sent++;
      results.push({ id: row.id, status: 'sent', to: playerEmail(row) });
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 400);
      await supabase('nominations?id=eq.' + encodeURIComponent(row.id), {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          invite_error: msg,
          invite_attempts: attempts
        })
      }).catch(() => {});
      failed++;
      results.push({ id: row.id, status: 'failed', error: msg });
    }
  }

  console.log('send-nomination-invites', { sent, failed, total: due.length });
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, failed, results }) };
};
