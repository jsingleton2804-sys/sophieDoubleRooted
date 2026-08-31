const GMAIL_USER = 'hello@doublerooted.com';
const MAIL_TO    = 'hello@doublerooted.com';

const ALLOWED_ORIGINS = [
  'https://doublerooted.com',
  'https://www.doublerooted.com',
  'https://jsingleton2804-sys.github.io',
];

const SUBJECT_LABELS = {
  'english-explorers':     'English Explorers',
  'konversationscoaching': 'Konversationscoaching',
  'keramik':               'Keramik bemalen bei Studio Moki',
  'sonstiges':             'Sonstiges',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Gmail's API wants the message base64url encoded, not plain base64.
function toBase64Url(str) {
  return toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRawEmail({ from, to, replyTo, subject, html }) {
  const subjectB64 = `=?UTF-8?B?${toBase64(subject)}?=`;
  const bodyB64    = toBase64(html).match(/.{1,76}/g).join('\r\n');
  return [
    `From: ${from}`, `To: ${to}`, `Reply-To: ${replyTo}`,
    `Subject: ${subjectB64}`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64', '', bodyB64,
  ].join('\r\n');
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── Gmail API ──────────────────────────────────────────────────────────────

// Exchange the long-lived refresh token for a short-lived access token.
async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh returned no access_token');
  return data.access_token;
}

async function sendViaGmail(env, { from, to, replyTo, subject, html }) {
  const accessToken = await getAccessToken(env);
  const raw = toBase64Url(buildRawEmail({ from, to, replyTo, subject, html }));

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
  }
}

// ── Request handler ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin  = request.headers.get('Origin') || '';
    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST')    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

    let formData;
    try { formData = await request.formData(); }
    catch { return new Response(JSON.stringify({ error: 'Ungültige Formulardaten.' }), { status: 400, headers }); }

    if (formData.get('_gotcha')) return new Response(JSON.stringify({ ok: true }), { headers });

    const firstName = formData.get('first_name') || '';
    const lastName  = formData.get('last_name')  || '';
    const email     = formData.get('email')       || '';
    const subject   = formData.get('subject')     || 'sonstiges';
    const message   = formData.get('message')     || '';

    if (!email || !message) {
      return new Response(JSON.stringify({ error: 'Bitte fülle alle Pflichtfelder aus.' }), { status: 400, headers });
    }

    const subjectLabel = SUBJECT_LABELS[subject] || 'Sonstiges';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#234A52;">
  <h2 style="color:#0E7187;margin-bottom:1.5rem;">Neue Kontaktanfrage – Double Rooted</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
    <tr><td style="padding:8px 0;color:#6B8086;width:120px;vertical-align:top;">Name</td>
        <td style="padding:8px 0;">${escapeHtml(firstName)} ${escapeHtml(lastName)}</td></tr>
    <tr><td style="padding:8px 0;color:#6B8086;vertical-align:top;">E-Mail</td>
        <td style="padding:8px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#0E7187;">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:8px 0;color:#6B8086;vertical-align:top;">Betreff</td>
        <td style="padding:8px 0;">${escapeHtml(subjectLabel)}</td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #e0e8ea;margin:0 0 1.5rem;" />
  <p style="line-height:1.8;white-space:pre-wrap;">${escapeHtml(message)}</p>
  <hr style="border:none;border-top:1px solid #e0e8ea;margin:1.5rem 0 1rem;" />
  <p style="font-size:0.8rem;color:#6B8086;">
    Gesendet über das Kontaktformular auf doublerooted.com.<br/>
    Antworte direkt auf diese E-Mail, um ${escapeHtml(firstName)} zu erreichen.
  </p>
</div>`;

    try {
      await sendViaGmail(env, {
        from:    `Double Rooted Kontakt <${GMAIL_USER}>`,
        to:      MAIL_TO,
        replyTo: email,
        subject: `Neue Anfrage: ${subjectLabel} – ${firstName} ${lastName}`,
        html,
      });
      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (err) {
      console.error('Gmail API error:', err.message);
      return new Response(JSON.stringify({ error: 'Fehler beim Senden. Bitte versuche es erneut.' }), { status: 502, headers });
    }
  },
};
