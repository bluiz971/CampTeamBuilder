/**
 * Netlify scheduled function — charge remaining balances when camp is
 * 7 days away (or overdue if a prior daily run was missed).
 *
 * ONE ATTEMPT ONLY:
 *   pay_status = 'deposit_paid' → 'balance_charged' | 'charge_failed'
 * Failures are never retried automatically (query is deposit_paid only).
 *
 * Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const Stripe = require('stripe');

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

/** Days from UTC today until camp_date (negative = past). */
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

  let rows = [];
  try {
    // Deposit rows with a camp date — charge when ≤7 days remain (includes overdue)
    rows = await supabase(
      'registrations?pay_status=eq.deposit_paid&camp_date=not.is.null' +
      '&select=id,camp_code,camp_date,amount_total,amount_paid,stripe_customer_id,stripe_payment_method_id,email,parent_email,first,last'
    );
  } catch (e) {
    console.error('charge-remaining-balance fetch', e.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }

  const due = (rows || []).filter(r => {
    const d = daysUntil(r.camp_date);
    return d !== null && d <= 7;
  });

  if (!due.length) {
    console.log('charge-remaining-balance: no deposit_paid rows due (≤7 days)');
    return { statusCode: 200, body: JSON.stringify({ ok: true, charged: 0, failed: 0, message: 'Nothing due' }) };
  }

  let charged = 0;
  let failed = 0;
  const results = [];

  for (const r of due) {
    const total = Number(r.amount_total) || 0;
    const paid = Number(r.amount_paid) || 0;
    const amountDue = Math.max(0, total - paid);

    if (amountDue <= 0) {
      await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({ pay_status: 'paid_in_full', payment_status: 'paid' })
      });
      charged++;
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
      failed++;
      results.push({ id: r.id, status: 'charge_failed', error: 'no_pm' });
      continue;
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountDue,
        currency: 'usd',
        customer,
        payment_method: pm,
        off_session: true,
        confirm: true,
        metadata: {
          registration_id: r.id,
          camp_code: r.camp_code || '',
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
        charged++;
        results.push({ id: r.id, status: 'balance_charged' });
      } else {
        await supabase('registrations?id=eq.' + encodeURIComponent(r.id), {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: JSON.stringify({
            pay_status: 'charge_failed',
            balance_charge_error: 'PaymentIntent status: ' + pi.status,
            balance_charge_attempted_at: new Date().toISOString()
          })
        });
        failed++;
        results.push({ id: r.id, status: 'charge_failed', error: pi.status });
      }
    } catch (err) {
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
      failed++;
      results.push({ id: r.id, status: 'charge_failed', error: String(msg).slice(0, 200) });
    }
  }

  console.log('charge-remaining-balance summary:', { charged, failed, total: due.length });
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, charged, failed, results })
  };
};
