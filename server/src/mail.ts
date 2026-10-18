import nodemailer from "nodemailer";

type Transporter = ReturnType<typeof nodemailer.createTransport>;
import { config } from "./config.js";
import { tr, type Locale } from "./i18n.js";

/** Whether e-mails can be sent: a server and a sender are set (they can change in the administration). */
export const mailEnabled = () => Boolean(config.smtp.host && config.smtp.from);

let current: { key: string; transport: Transporter } | null = null;

/** The SMTP connection of the current settings, made again when they change; null without e-mail. */
function transporter(): Transporter | null {
  if (!mailEnabled()) return null;
  const { host, port, secure, user, pass } = config.smtp;
  const key = JSON.stringify([host, port, secure, user, pass]);
  if (current?.key !== key) {
    current?.transport.close();
    current = { key, transport: nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined }) };
  }
  return current.transport;
}

/** Checks the connection to the SMTP server (login included); throws its error. */
export async function verifyMail(): Promise<void> {
  const t = transporter();
  if (!t) throw new Error("E-mail is not set up");
  await t.verify();
}

/**
 * A plausible e-mail address (one @, a dotted domain, no spaces), at most 254 characters. The domain is matched label
 * by label, so the check stays linear whatever the input (no backtracking on "a@a.a.a.a…").
 */
export const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(s);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Sends an e-mail made of HTML (a report, a notification); the text version is derived from it. */
/** Removes tags until none is left (a single pass could leave one made of the pieces of others). */
function stripTags(s: string): string {
  let out = s;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^<>]*>/g, "");
  }
  return out.replace(/[<>]/g, "");
}

/** The plain-text version of an HTML e-mail: links spelled out, list items and paragraphs on their own lines. */
export function htmlToText(html: string): string {
  const lines = html
    .replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (_, url, label) => (label === url ? url : `${label} (${url})`))
    .replace(/<li>/g, "\n- ")
    .replace(/<\/(h2|h3|p|tr)>/g, "\n");
  return stripTags(lines)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendHtmlMail(lang: Locale, to: string, subject: string, html: string, headers: Record<string, string> = {}) {
  const transport = transporter();
  if (!transport) return false;
  const text = `${htmlToText(html)}\n\n— TasksPipes`;
  await transport.sendMail({ from: config.smtp.from, to, subject, html, text, headers: { "Content-Language": lang, ...headers } });
  return true;
}

/** Sends a short e-mail with one call-to-action link. Returns false when e-mail is not configured. */
export async function sendLinkMail(lang: Locale, to: string, subject: string, paragraphs: string[], action: { label: string; url: string }) {
  const transport = transporter();
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

/** The invitation an Outline colleague who never signed in gets: who asks, and which Outline server to sign in with. */
export function outlineInvite(lang: Locale, inviter: string, server: string | null) {
  return {
    subject: tr(lang, "{name} invites you to TasksPipes", { name: inviter }),
    paragraphs: [
      tr(lang, "{name} would like to share tasks with you on TasksPipes, the task manager that works with your Outline workspace.", { name: inviter }),
      tr(lang, "Sign in with your Outline account, on the server {server}.", { server: server || config.outlineUrl || "" }),
    ],
  };
}

/** Sends that invitation; false when e-mail is not configured. */
export async function sendOutlineInvite(lang: Locale, to: string, inviter: string, server: string | null) {
  const m = outlineInvite(lang, inviter, server);
  return sendLinkMail(lang, to, m.subject, m.paragraphs, { label: tr(lang, "Open TasksPipes"), url: config.appUrl });
}
