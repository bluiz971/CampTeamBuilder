const Stripe = require('stripe');
const { buildLineItems } = require('./pricing');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: cors, body: '' };
  }
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if(!secret){
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Stripe is not configured (STRIPE_SECRET_KEY).' }) };
  }

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const registrationId = String(body.registrationId || '').trim();
  const campCode = String(body.campCode || '').trim();
  const addons = Array.isArray(body.addons) ? body.addons : [];
  const email = String(body.email || body.parentEmail || '').trim();
  const playerName = String(body.playerName || '').trim();
  const successUrl = String(body.successUrl || '').trim();
  const cancelUrl = String(body.cancelUrl || '').trim();

  if(!registrationId || !campCode || !successUrl || !cancelUrl){
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing registrationId, campCode, successUrl, or cancelUrl.' }) };
  }

  let line;
  try{ line = buildLineItems(campCode, addons); }
  catch(e){
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message || 'Invalid camp' }) };
  }

  try{
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: line.items,
      success_url: successUrl.includes('{CHECKOUT_SESSION_ID}')
        ? successUrl
        : successUrl + (successUrl.includes('?')?'&':'?') + 'session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      client_reference_id: registrationId,
      metadata: {
        registration_id: registrationId,
        camp_code: campCode,
        addons: addons.join(','),
        player_name: playerName.slice(0, 200)
      },
      payment_intent_data: {
        metadata: {
          registration_id: registrationId,
          camp_code: campCode
        }
      }
    });

    // Best-effort: store session id + amount on the registration (service role)
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
            stripe_session_id: session.id,
            amount_cents: line.totalCents,
            payment_status: 'pending'
          })
        }
      ).catch(()=>{});
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id,
        amountCents: line.totalCents
      })
    };
  }catch(e){
    console.error('create-checkout', e);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message || 'Could not create checkout session' })
    };
  }
};
