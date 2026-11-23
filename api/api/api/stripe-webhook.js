const crypto = require('crypto');
const BASE = 'https://qilavmcjodqvjeenrjim.supabase.co';

function lireCorps(req) {
  return new Promise((ok, ko) => {
    const morceaux = [];
    req.on('data', c => morceaux.push(c));
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}

function signatureValide(brut, entete, secret) {
  if (!entete || !secret) return false;
  const parts = entete.split(',').map(p => p.split('='));
  const t = (parts.find(p => p[0] === 't') || [])[1];
  const signatures = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const attendue = crypto.createHmac('sha256', secret).update(t + '.' + brut.toString('utf8')).digest('hex');
  return signatures.some(s => {
    const a = Buffer.from(s), b = Buffer.from(attendue);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function enregistrer(ligne) {
  const r = await fetch(BASE + '/rest/v1/subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(ligne)
  });
  return r.ok;
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const brut = await lireCorps(req);
  if (!signatureValide(brut, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'signature invalide' });
  }

  const evenement = JSON.parse(brut.toString('utf8'));
  const o = evenement.data.object;
  let ok = true;

  if (evenement.type === 'checkout.session.completed') {
    const paye = o.payment_status === 'paid' || o.payment_status === 'no_payment_required';
    if (paye && o.client_reference_id) {
      ok = await enregistrer({
        user_id: o.client_reference_id,
        stripe_customer_id: o.customer,
        status: 'active'
      });
    }
  }

  if (evenement.type === 'customer.subscription.updated' || evenement.type === 'customer.subscription.deleted') {
    const userId = o.metadata && o.metadata.user_id;
    if (userId) {
      const fin = o.current_period_end || (o.items && o.items.data && o.items.data[0] && o.items.data[0].current_period_end);
      ok = await enregistrer({
        user_id: userId,
        stripe_customer_id: o.customer,
        status: evenement.type === 'customer.subscription.deleted' ? 'canceled' : o.status,
        current_period_end: fin ? new Date(fin * 1000).toISOString() : null
      });
    }
  }

  res.status(ok ? 200 : 500).json({ recu: ok });
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
