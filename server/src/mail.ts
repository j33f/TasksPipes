import nodemailer from "nodemailer";
import { config } from "./config.js";
import { tr, type Locale } from "./i18n.js";

export const mailEnabled = Boolean(config.smtp.host && config.smtp.from);

const transport = mailEnabled
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Sends an e-mail made of HTML (a report); the text version is derived from it. */
export async function sendHtmlMail(lang: Locale, to: string, subject: string, html: string) {
  if (!transport) return false;
  const text = html
    .replace(/<li>/g, "\n- ")
    .replace(/<\/(h2|h3|p|tr)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  await transport.sendMail({ from: config.smtp.from, to, subject, html, text: `${text}\n\n— TasksPipes`, headers: { "Content-Language": lang } });
  return true;
}

/** Sends a short e-mail with one call-to-action link. Returns false when e-mail is not configured. */
export async function sendLinkMail(lang: Locale, to: string, subject: string, paragraphs: string[], action: { label: string; url: string }) {
  if (!transport) return false;
  const text = `${paragraphs.join("\n\n")}\n\n${action.label}: ${action.url}\n\n— TasksPipes`;
  const html = `<div lang="${lang}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111319;max-width:520px">
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#0366d6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>
<p style="color:#66778F;font-size:13px">${escape(tr(lang, "Or copy this link:"))} ${escape(action.url)}</p>
<p style="color:#66778F;font-size:13px">— TasksPipes</p></div>`;
  await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
  return true;
}
