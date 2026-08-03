/**
 * Netlify scheduled function — charge remaining balances ONE WEEK before camp.
 *
 * ONE ATTEMPT ONLY (see payment addendum):
 *   - Selects rows with pay_status = 'deposit_paid' only
 *   - On success → pay_status = 'balance_charged', amount_paid = amount_total
 *   - On any failure → pay_status = 'charge_failed' (+ balance_charge_error)
 *   - Never retries charge_failed (they no longer match the deposit_paid query)
 *
 * Remaining balance is then collected in person at check-in via the existing
 * Owes $X badge (Pull Registrations maps charge_failed → Balance Due).
 *
 * Schedule (Netlify UI or netlify.toml): once daily is fine — the status
 * transition prevents repeat charges.
 *
 * Requires env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * NOTE: Full deposit-checkout + camp_date wiring comes from
 * CURSOR_PROMPT_payments.txt. Until camps.camp_date (or equivalent) is
 * available, this function no-ops safely.
 */
const Stripe = require('stripe');

const PAID_OK = new Set(['paid_in_full', 'balance_charged']);

async function supabase(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(url + '/rest/v1/' + path, {
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
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 300));
  return body;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + (String(dateStr).length <= 10 ? 'T12:00:00Z' : ''));
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const utcCamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utcCamp - utcToday) / 86400000);
}

exports.handler = async () => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { statusCode: 500, body: 'STRIPE_SECRET_KEY missing' };
  }
  const stripe = new Stripe(secret);

  // Camps with a date exactly 7 days out (adjust when prompt specifies window)
  let camps = [];
  try {
    camps = await supabase('camps?select=id,slug,camp_date,name&camp_date=not.is.null');
  } catch (e) {
    console.warn('camps fetch skipped:', e.message);
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no camps table or dates', detail: e.message }) };
  }

  const dueCamps = (camps || []).filter(c => daysUntil(c.camp_date) === 7);
  if (!dueCamps.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'No camps 7 days out' }) };
  }

  const results = [];
  for (const camp of dueCamps) {
    // ONLY deposit_paid — charge_failed is never selected again (one attempt)
    const rows = await supabase(
      'registrations?camp_code=eq.' + encodeURIComponent(camp.slug) +
      '&pay_status=eq.deposit_paid&select=id,amount_total,amount_paid,stripe_customer_id,stripe_payment_method_id,email,parent_email,first,last'
    );

    for (const r of (rows || [])) {
      if (PAID_OK.has(r.pay_status)) continue;
      const total = Number(r.amount_total) || 0;
      const paid = Number(r.amount_paid) || 0;
      const due = Math.max(0, total - paid);
      if (due <= 0) {
        await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: JSON.stringify({ pay_status: 'paid_in_full', payment_status: 'paid' })
        });
        results.push({ id: r.id, status: 'paid_in_full' });
        continue;
      }

      const customer = r.stripe_customer_id;
      const pm = r.stripe_payment_method_id;
      if (!customer || !pm) {
        await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: JSON.stringify({
            pay_status: 'charge_failed',
            balance_charge_error: 'Missing saved payment method for automatic balance charge',
            balance_charge_attempted_at: new Date().toISOString()
          })
        });
        results.push({ id: r.id, status: 'charge_failed', error: 'no_pm' });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount: due,
          currency: 'usd',
          customer,
          payment_method: pm,
          off_session: true,
          confirm: true,
          metadata: {
            registration_id: r.id,
            camp_code: camp.slug,
            purpose: 'balance_charge'
          }
        });
        if (pi.status === 'succeeded') {
          await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: JSON.stringify({
              pay_status: 'balance_charged',
              payment_status: 'paid',
              amount_paid: total,
              stripe_payment_intent: pi.id,
              paid_at: new Date().toISOString(),
              balance_charge_error: null,
              balance_charge_attempted_at: new Date().toISOString()
            })
          });
          results.push({ id: r.id, status: 'balance_charged' });
        } else {
          // Requires action / processing / etc. — do NOT retry later
          await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: JSON.stringify({
              pay_status: 'charge_failed',
              balance_charge_error: 'PaymentIntent status: ' + pi.status,
              balance_charge_attempted_at: new Date().toISOString()
            })
          });
          results.push({ id: r.id, status: 'charge_failed', error: pi.status });
        }
      } catch (err) {
        // Declined, expired, auth required — one attempt only
        const msg = (err && (err.message || err.code)) || 'charge failed';
        await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: JSON.stringify({
            pay_status: 'charge_failed',
            balance_charge_error: String(msg).slice(0, 500),
            balance_charge_attempted_at: new Date().toISOString()
          })
        });
        results.push({ id: r.id, status: 'charge_failed', error: String(msg).slice(0, 200) });
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, camps: dueCamps.map(c => c.slug), results }) };
};
