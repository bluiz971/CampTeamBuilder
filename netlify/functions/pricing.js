/**
 * Server-side prices for camp registration + add-ons (amounts in USD cents).
 * Keep in sync with CAMPS / ADDONS in register.html.
 */
const CAMPS = {
  'georgia-2026': {
    name: 'Georgia Select Tour Camp 2026',
    priceCents: 14000
  },
  'mid-atlantic-2026': {
    name: 'Mid-Atlantic Select Tour Camp 2026',
    priceCents: 14500
  }
};

const ADDONS = {
  Mixtape: { name: 'Recruiting Highlight Tape', priceCents: 12000 },
  Eval: { name: 'Digital In-Depth Player Evaluation', priceCents: 9000 },
  Zoom: { name: 'Player Zoom Meeting', priceCents: 7500 }
};

function buildLineItems(campCode, addonTags){
  const camp = CAMPS[campCode];
  if(!camp) throw new Error('Unknown camp: '+campCode);
  const items = [{
    price_data: {
      currency: 'usd',
      unit_amount: camp.priceCents,
      product_data: { name: camp.name + ' — Registration' }
    },
    quantity: 1
  }];
  let total = camp.priceCents;
  const tags = [...new Set((addonTags||[]).map(String))];
  for(const tag of tags){
    const a = ADDONS[tag];
    if(!a) continue;
    items.push({
      price_data: {
        currency: 'usd',
        unit_amount: a.priceCents,
        product_data: { name: a.name + ' (add-on)' }
      },
      quantity: 1
    });
    total += a.priceCents;
  }
  return { items, totalCents: total, campName: camp.name };
}

module.exports = { CAMPS, ADDONS, buildLineItems };
