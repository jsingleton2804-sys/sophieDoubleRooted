var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { connect } from "cloudflare:sockets";
var GMAIL_USER = "hello@doublerooted.com";
var MAIL_TO = "hello@doublerooted.com";
var ALLOWED_ORIGINS = [
  "https://doublerooted.com",
  "https://www.doublerooted.com",
  "https://jsingleton2804-sys.github.io"
];
var SUBJECT_LABELS = {
  "english-explorers": "English Explorers",
  "konversationscoaching": "Konversationscoaching",
  "keramik": "Keramik bemalen bei Studio Moki",
  "sonstiges": "Sonstiges"
};
function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escapeHtml, "escapeHtml");
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(toBase64, "toBase64");
function buildRawEmail({ from, to, replyTo, subject, html }) {
  const subjectB64 = `=?UTF-8?B?${toBase64(subject)}?=`;
  const bodyB64 = toBase64(html).match(/.{1,76}/g).join("\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subjectB64}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    bodyB64
  ].join("\r\n");
}
__name(buildRawEmail, "buildRawEmail");
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
var SmtpClient = class {
  static {
    __name(this, "SmtpClient");
  }
  constructor() {
    this.socket = null;
    this.writer = null;
    this.reader = null;
    this.buf = "";
  }
  _bind(socket) {
    if (this.writer) try {
      this.writer.releaseLock();
    } catch {
    }
    if (this.reader) try {
      this.reader.releaseLock();
    } catch {
    }
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.reader = socket.readable.getReader();
  }
  async _readLine() {
    while (true) {
      const i = this.buf.indexOf("\n");
      if (i !== -1) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP: connection closed");
      this.buf += new TextDecoder().decode(value);
    }
  }
  async _readResponse() {
    const lines = [];
    while (true) {
      const line = await this._readLine();
      lines.push(line);
      if (line.length < 4 || line[3] !== "-") break;
    }
    return { code: parseInt(lines[lines.length - 1]), lines };
  }
  async _send(text) {
    await this.writer.write(new TextEncoder().encode(text + "\r\n"));
  }
  // Send optional command, read response, assert expected code
  async cmd(text, expect) {
    if (text) await this._send(text);
    const res = await this._readResponse();
    if (expect && res.code !== expect) {
      throw new Error(`SMTP: expected ${expect}, got ${res.code} \u2014 ${res.lines.join(" | ")}`);
    }
    return res;
  }
  async upgradeTls() {
    this.writer.releaseLock();
    this.reader.releaseLock();
    this._bind(this.socket.startTls());
  }
  close() {
    try {
      this.writer.releaseLock();
    } catch {
    }
    try {
      this.reader.releaseLock();
    } catch {
    }
    try {
      this.socket.close();
    } catch {
    }
  }
};
async function sendViaGmail(appPassword, { from, to, replyTo, subject, html }) {
  const client = new SmtpClient();
  client._bind(connect({ hostname: "smtp.gmail.com", port: 587, secureTransport: "starttls" }));
  try {
    await client.cmd(null, 220);
    await client.cmd("EHLO doublerooted.com", 250);
    await client.cmd("STARTTLS", 220);
    await client.upgradeTls();
    await client.cmd("EHLO doublerooted.com", 250);
    await client.cmd("AUTH LOGIN", 334);
    await client.cmd(btoa(GMAIL_USER), 334);
    await client.cmd(btoa(appPassword), 235);
    await client.cmd(`MAIL FROM:<${from}>`, 250);
    await client.cmd(`RCPT TO:<${to}>`, 250);
    await client.cmd("DATA", 354);
    const raw = buildRawEmail({ from: `Double Rooted Kontakt <${from}>`, to, replyTo, subject, html });
    await client.cmd(raw + "\r\n.", 250);
    await client._send("QUIT");
  } finally {
    client.close();
  }
}
__name(sendViaGmail, "sendViaGmail");
var worker_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return new Response(JSON.stringify({ error: "Ung\xFCltige Formulardaten." }), { status: 400, headers });
    }
    if (formData.get("_gotcha")) return new Response(JSON.stringify({ ok: true }), { headers });
    const firstName = formData.get("first_name") || "";
    const lastName = formData.get("last_name") || "";
    const email = formData.get("email") || "";
    const subject = formData.get("subject") || "sonstiges";
    const message = formData.get("message") || "";
    if (!email || !message) {
      return new Response(JSON.stringify({ error: "Bitte f\xFClle alle Pflichtfelder aus." }), { status: 400, headers });
    }
    const subjectLabel = SUBJECT_LABELS[subject] || "Sonstiges";
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#234A52;">
  <h2 style="color:#0E7187;margin-bottom:1.5rem;">Neue Kontaktanfrage \u2013 Double Rooted</h2>
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
    Gesendet \xFCber das Kontaktformular auf doublerooted.com.<br/>
    Antworte direkt auf diese E-Mail, um ${escapeHtml(firstName)} zu erreichen.
  </p>
</div>`;
    try {
      await sendViaGmail(env.GMAIL_APP_PASSWORD, {
        from: GMAIL_USER,
        to: MAIL_TO,
        replyTo: email,
        subject: `Neue Anfrage: ${subjectLabel} \u2013 ${firstName} ${lastName}`,
        html
      });
      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (err) {
      console.error("SMTP error:", err.message);
      return new Response(JSON.stringify({ error: "Fehler beim Senden. Bitte versuche es erneut." }), { status: 502, headers });
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
