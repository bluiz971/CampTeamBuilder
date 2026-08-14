/**
 * Create a Stripe PaymentIntent for camp registration.
 * Secret key stays on the server — never in the browser.
 *
 * POST JSON: {
 *   registrationId, campCode, addons[], email, name,
 *   isDeposit: boolean
 * }
 * Returns: { client_secret, customer_id, amountCents, amountTotalCents, campDate }
 */
const Stripe = require('stripe');
const { computeCharge } = require('./pricing');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(status, body){
  return {
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function findOrCreateCustomer(stripe, email, name){
  const cleaned = String(email || '').trim().toLowerCase();
  if(!cleaned) throw new Error('Email is required for payment');
  const existing = await stripe.customers.list({ email: cleaned, limit: 1 });
  if(existing.data && existing.data[0]){
    const c = existing.data[0];
    if(name && !c.name){
      try{ await stripe.customers.update(c.id, { name: String(name).slice(0, 200) }); }catch(e){}
    }
    return c;
  }
  return stripe.customers.create({
    email: cleaned,
    name: name ? String(name).slice(0, 200) : undefined,
    metadata: { source: 'camp_registration' }
  });
}

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: cors, body: '' };
  }
  if(event.httpMethod !== 'POST'){
    return json(405, { error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if(!secret){
    return json(500, { error: 'Stripe is not configured (STRIPE_SECRET_KEY).' });
  }

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON' }); }

  const registrationId = String(body.registrationId || '').trim();
  const campCode = String(body.campCode || '').trim();
  const addons = Array.isArray(body.addons) ? body.addons : [];
  const email = String(body.email || body.parentEmail || '').trim();
  const name = String(body.name || body.playerName || '').trim();
  const isDeposit = !!(body.isDeposit || body.deposit);

  if(!registrationId || !campCode){
    return json(400, { error: 'Missing registrationId or campCode.' });
  }

  let charge;
  try{ charge = computeCharge(campCode, addons, isDeposit); }
  catch(e){ return json(400, { error: e.message || 'Invalid camp' }); }

  if(charge.chargeNowCents < 50){
    return json(400, { error: 'Amount too small to charge.' });
  }

  try{
    const stripe = new Stripe(secret);
    const customer = await findOrCreateCustomer(stripe, email, name);

    const piParams = {
      amount: charge.chargeNowCents,
      currency: 'usd',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        registration_id: registrationId,
        camp_code: campCode,
        purpose: isDeposit ? 'deposit' : 'full_payment',
        amount_total_cents: String(charge.totalCents)
      },
      description: (isDeposit ? 'Deposit — ' : 'Registration — ') + charge.campName
    };
    if(isDeposit){
      piParams.setup_future_usage = 'off_session';
    }

    const pi = await stripe.paymentIntents.create(piParams);

    // Best-effort: stamp totals on the registration (service role)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(supabaseUrl && serviceKey){
      await fetch(
        supabaseUrl+'/rest/v1/registrations?id=eq.'+encodeURIComponent(registrationId),
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: 'Bearer '+serviceKey,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            amount_total: charge.totalCents,
            amount_cents: charge.totalCents,
            camp_date: charge.campDate || null,
            stripe_customer_id: customer.id,
            stripe_payment_intent: pi.id,
            pay_status: 'unpaid',
            payment_status: 'pending'
          })
        }
      ).catch(()=>{});
    }

    return json(200, {
      client_secret: pi.client_secret,
      customer_id: customer.id,
      paymentIntentId: pi.id,
      amountCents: charge.chargeNowCents,
      amountTotalCents: charge.totalCents,
      remainingCents: charge.remainingCents,
      campDate: charge.campDate || null,
      isDeposit
    });
  }catch(e){
    console.error('create-payment-intent', e && e.message);
    return json(500, { error: 'Could not start payment. Please try again or contact camp staff.' });
  }
};
