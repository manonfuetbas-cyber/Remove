const BASE = 'https://qilavmcjodqvjeenrjim.supabase.co';
const STEPS = [30, 15, 7];
const eur = c => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

function message(step, inv, late, signature) {
  const date = new Date(inv.due_date).toLocaleDateString('fr-FR');
  const fin = '\n\nCordialement,\n' + (signature || '');
  if (step === 7) {
    return {
      sujet: 'Rappel : facture en attente de règlement',
      texte: 'Bonjour ' + inv.client_name + ',\n\nSauf erreur de ma part, la facture de ' + eur(inv.amount_cents) + ', échue le ' + date + ', n\'a pas encore été réglée.\n\nPourriez-vous me confirmer la date de règlement prévue ?' + fin
    };
  }
  if (step === 15) {
    return {
      sujet: 'Deuxième rappel : facture impayée',
      texte: 'Bonjour ' + inv.client_name + ',\n\nJe reviens vers vous au sujet de ma facture de ' + eur(inv.amount_cents) + ', échue le ' + date + ' et toujours impayée (' + late + ' jours de retard).\n\nMerci de procéder au règlement sous 8 jours, ou de m\'indiquer ce qui bloque.' + fin
    };
  }
  return {
    sujet: 'Dernier rappel avant mise en demeure',
    texte: 'Bonjour ' + inv.client_name + ',\n\nMa facture de ' + eur(inv.amount_cents) + ', échue le ' + date + ', reste impayée après ' + late + ' jours de retard.\n\nSans règlement sous 8 jours, je serai contraint de vous adresser une mise en demeure.' + fin
  };
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'non autorisé' });
  }
  const K = process.env.SUPABASE_SECRET_KEY;
  const H = { apikey: K, 'Content-Type': 'application/json' };

  const r = await fetch(BASE + '/rest/v1/invoices?status=neq.paid&select=*', { headers: H });
  if (!r.ok) return res.status(500).json({ error: 'lecture impossible' });
  const invs = await r.json();

  let envoyes = 0, erreurs = 0;
  const now = Date.now();

  for (const inv of invs) {
    const echeance = new Date(inv.due_date).getTime();
    const late = Math.floor((now - echeance) / 864e5);
    const step = STEPS.find(s => late >= s);
    if (!step) continue;

    const prevue = new Date(echeance + step * 864e5).toISOString().slice(0, 10);
    const ins = await fetch(BASE + '/rest/v1/reminders', {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ invoice_id: inv.id, step_days: step, scheduled_for: prevue })
    });
    if (ins.status === 409) continue;
    if (!ins.ok) { erreurs++; continue; }
    const [rem] = await ins.json();

    let reply;
    try {
      const u = await fetch(BASE + '/auth/v1/admin/users/' + inv.user_id, { headers: H });
      if (u.ok) reply = (await u.json()).email;
    } catch (e) {}

    const from = process.env.EMAIL_FROM;
    const to = from ? inv.client_email : 'manonfuetbas@gmail.com';
    const m = message(step, inv, late, reply);

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from || 'onboarding@resend.dev',
        to: [to],
        reply_to: reply,
        subject: (from ? '' : '[TEST] ') + m.sujet,
        text: m.texte
      })
    });

    if (!mail.ok) {
      await fetch(BASE + '/rest/v1/reminders?id=eq.' + rem.id, { method: 'DELETE', headers: H });
      erreurs++;
      continue;
    }

    await fetch(BASE + '/rest/v1/reminders?id=eq.' + rem.id, {
      method: 'PATCH', headers: H, body: JSON.stringify({ sent_at: new Date().toISOString() })
    });
    if (inv.status === 'due') {
      await fetch(BASE + '/rest/v1/invoices?id=eq.' + inv.id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ status: 'reminded' })
      });
    }
    envoyes++;
  }

  res.status(200).json({ factures: invs.length, envoyes, erreurs });
};
