const ALLOWED_ORIGINS = [
  'https://doublerooted.com',
  'https://www.doublerooted.com',
  'https://jsingleton2804-sys.github.io',
];

const SUBJECT_LABELS = {
  'english-explorers':    'English Explorers',
  'konversationscoaching': 'Konversationscoaching',
  'keramik':              'Keramik bemalen bei Studio Moki',
  'sonstiges':            'Sonstiges',
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin  = request.headers.get('Origin') || '';
    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return new Response(JSON.stringify({ error: 'Ungültige Formulardaten.' }), { status: 400, headers });
    }

    // Honeypot — bots fill hidden fields, humans don't
    if (formData.get('_gotcha')) {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const firstName = formData.get('first_name') || '';
    const lastName  = formData.get('last_name')  || '';
    const email     = formData.get('email')       || '';
    const subject   = formData.get('subject')     || 'sonstiges';
    const message   = formData.get('message')     || '';

    if (!email || !message) {
      return new Response(
        JSON.stringify({ error: 'Bitte fülle alle Pflichtfelder aus.' }),
        { status: 400, headers }
      );
    }

    const subjectLabel = SUBJECT_LABELS[subject] || 'Sonstiges';

    const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#234A52;">
  <h2 style="color:#0E7187;margin-bottom:1.5rem;">Neue Kontaktanfrage – Double Rooted</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
    <tr>
      <td style="padding:8px 0;color:#6B8086;width:120px;vertical-align:top;">Name</td>
      <td style="padding:8px 0;">${escapeHtml(firstName)} ${escapeHtml(lastName)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6B8086;vertical-align:top;">E-Mail</td>
      <td style="padding:8px 0;">
        <a href="mailto:${escapeHtml(email)}" style="color:#0E7187;">${escapeHtml(email)}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6B8086;vertical-align:top;">Betreff</td>
      <td style="padding:8px 0;">${escapeHtml(subjectLabel)}</td>
    </tr>
  </table>
  <hr style="border:none;border-top:1px solid #e0e8ea;margin:0 0 1.5rem;" />
  <p style="line-height:1.8;white-space:pre-wrap;">${escapeHtml(message)}</p>
  <hr style="border:none;border-top:1px solid #e0e8ea;margin:1.5rem 0 1rem;" />
  <p style="font-size:0.8rem;color:#6B8086;">
    Gesendet über das Kontaktformular auf doublerooted.com.<br/>
    Antworten direkt auf diese E-Mail, um ${escapeHtml(firstName)} zu erreichen.
  </p>
</div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     'Double Rooted Kontakt <kontakt@doublerooted.com>',
        to:       ['hello@doublerooted.com'],
        reply_to: email,
        subject:  `Neue Anfrage: ${subjectLabel} – ${firstName} ${lastName}`,
        html:     emailHtml,
      }),
    });

    if (resendRes.ok) {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    const errText = await resendRes.text();
    console.error('Resend error:', errText);
    return new Response(
      JSON.stringify({ error: 'Fehler beim Senden. Bitte versuche es erneut.' }),
      { status: 502, headers }
    );
  },
};
