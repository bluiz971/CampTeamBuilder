const Stripe = require('stripe');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if(!secret || !webhookSecret){
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return { statusCode: 500, body: 'Webhook not configured' };
  }
  if(!supabaseUrl || !serviceKey){
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Database not configured' };
  }

  const stripe = new Stripe(secret);
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  let stripeEvent;
  try{
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'],
      webhookSecret
    );
  }catch(err){
    console.error('Webhook signature failed', err.message);
    return { statusCode: 400, body: 'Invalid signature' };
  }

  if(stripeEvent.type === 'checkout.session.completed'){
    const session = stripeEvent.data.object;
    const registrationId = session.metadata?.registration_id || session.client_reference_id;
    if(!registrationId){
      console.error('No registration_id on session', session.id);
      return { statusCode: 200, body: 'ok' };
    }
    const paid = session.payment_status === 'paid' || session.status === 'complete';
    const patch = {
      payment_status: paid ? 'paid' : 'pending',
      stripe_session_id: session.id,
      stripe_payment_intent: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id || null),
      amount_cents: session.amount_total != null ? session.amount_total : undefined,
      currency: session.currency || 'usd',
      paid_at: paid ? new Date().toISOString() : null
    };
    Object.keys(patch).forEach(k=>{ if(patch[k]===undefined) delete patch[k]; });

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
      console.error('Supabase patch failed', res.status, t);
      return { statusCode: 500, body: 'DB update failed' };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
