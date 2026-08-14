/**
 * After Stripe.js confirms a PaymentIntent, finalize the registration row
 * (service role — anon cannot UPDATE registrations).
 *
 * POST JSON: { registrationId, paymentIntentId, isDeposit }
 */
const Stripe = require('stripe');

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

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: cors, body: '' };
  }
  if(event.httpMethod !== 'POST'){
    return json(405, { error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret) return json(500, { error: 'Stripe is not configured.' });
  if(!supabaseUrl || !serviceKey) return json(500, { error: 'Database is not configured.' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON' }); }

  const registrationId = String(body.registrationId || '').trim();
  const paymentIntentId = String(body.paymentIntentId || '').trim();
  const isDeposit = !!(body.isDeposit || body.deposit);

  if(!registrationId || !paymentIntentId){
    return json(400, { error: 'Missing registrationId or paymentIntentId.' });
  }

  try{
    const stripe = new Stripe(secret);
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if(pi.metadata && pi.metadata.registration_id && pi.metadata.registration_id !== registrationId){
      return json(400, { error: 'Payment does not match this registration.' });
    }
    if(pi.status !== 'succeeded'){
      return json(400, { error: 'Payment is not complete yet (status: '+pi.status+').' });
    }

    const amountPaid = Number(pi.amount_received || pi.amount) || 0;
    const totalFromMeta = Number(pi.metadata && pi.metadata.amount_total_cents) || 0;
    const amountTotal = totalFromMeta > 0 ? totalFromMeta : amountPaid;
    const depositFlag = isDeposit || (pi.metadata && pi.metadata.purpose === 'deposit');

    let paymentMethodId = null;
    if(typeof pi.payment_method === 'string') paymentMethodId = pi.payment_method;
    else if(pi.payment_method && pi.payment_method.id) paymentMethodId = pi.payment_method.id;

    const customerId = typeof pi.customer === 'string'
      ? pi.customer
      : (pi.customer && pi.customer.id) || null;

    const pay_status = depositFlag ? 'deposit_paid' : 'paid_in_full';
    const patch = {
      amount_paid: amountPaid,
      amount_total: amountTotal,
      amount_cents: amountTotal,
      pay_status,
      payment_status: depositFlag ? 'pending' : 'paid',
      stripe_payment_intent: pi.id,
      paid_at: new Date().toISOString()
    };
    if(customerId) patch.stripe_customer_id = customerId;
    if(paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;

    const res = await fetch(
      supabaseUrl+'/rest/v1/registrations?id=eq.'+encodeURIComponent(registrationId),
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer '+serviceKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(patch)
      }
    );
    if(!res.ok){
      const t = await res.text();
      console.error('confirm-registration-payment patch', res.status, t);
      return json(500, { error: 'Payment succeeded but registration update failed — contact camp staff with your confirmation.' });
    }

    return json(200, {
      ok: true,
      pay_status,
      amount_paid: amountPaid,
      amount_total: amountTotal
    });
  }catch(e){
    console.error('confirm-registration-payment', e && e.message);
    return json(500, { error: 'Could not confirm payment. Contact camp staff if you were charged.' });
  }
};
