const BASE = 'https://qilavmcjodqvjeenrjim.supabase.co';
const PUBLISHABLE = 'sb_publishable_Rdf6W_QAHG9aFC50jG1Ygg_Fa_KTGp8';
const SITE = 'https://remove-sandy.vercel.app';
const PRIX = {
  mensuel: 'price_1Uf2lmPxTgsDQ0jzuBGk3iRK',
  annuel: 'price_1Uf2p7PxTgsDQ0jzM5f1sIIe'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'méthode non autorisée' });

  const jeton = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jeton) return res.status(401).json({ error: 'connexion requise' });

  const u = await fetch(BASE + '/auth/v1/user', {
    headers: { apikey: PUBLISHABLE, Authorization: 'Bearer ' + jeton }
  });
  if (!u.ok) return res.status(401).json({ error: 'connexion invalide' });
  const user = await u.json();

  const formule = req.body && req.body.formule;
  const prix = PRIX[formule];
  if (!prix) return res.status(400).json({ error: 'formule inconnue' });

  const corps = new URLSearchParams();
  corps.set('mode', 'subscription');
  corps.set('ui_mode', 'embedded');
  corps.set('line_items[0][price]', prix);
  corps.set('line_items[0][quantity]', '1');
  corps.set('client_reference_id', user.id);
  corps.set('customer_email', user.email);
  corps.set('metadata[user_id]', user.id);
  corps.set('subscription_data[metadata][user_id]', user.id);
  corps.set('return_url', SITE + '/merci.html?session_id={CHECKOUT_SESSION_ID}');

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-04-30.basil'
    },
    body: corps.toString()
  });
  const s = await r.json();
  if (!r.ok) return res.status(500).json({ error: 'paiement indisponible' });

  res.status(200).json({ clientSecret: s.client_secret });
};
