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

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------------------
// Look of the e-mails: the pages' (font, colours, white card on a blue-grey background, blue button), light or dark.

/** A person's theme: forced light or dark in their profile, or null to follow their mail app (like the pages). */
export type MailTheme = "light" | "dark" | null;

const FONT = `-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Roboto,Oxygen,sans-serif`;

/** Colours of the app's themes (web/src/app.css). */
const PALETTES = {
  light: { page: "#eef2f6", card: "#ffffff", fg: "#111319", muted: "#66778f", border: "#dae1e9", box: "#f4f7fa", link: "#0366d6" },
  dark: { page: "#111319", card: "#181c25", fg: "#e6e6e6", muted: "#8292a8", border: "#262a35", box: "#1f232e", link: "#137ffb" },
};
type Palette = (typeof PALETTES)["light"];

/** What each role colours: its text, background or border. */
const ROLES = {
  page: (c: Palette) => `background-color:${c.page}`,
  card: (c: Palette) => `background-color:${c.card};border-color:${c.border}`,
  box: (c: Palette) => `background-color:${c.box};border-color:${c.border}`,
  text: (c: Palette) => `color:${c.fg}`,
  muted: (c: Palette) => `color:${c.muted}`,
  link: (c: Palette) => `color:${c.link}`,
  border: (c: Palette) => `border-color:${c.border}`,
};
type Role = keyof typeof ROLES;

/** Dark colours for mail apps in dark mode (prefers-color-scheme), Outlook.com included ([data-ogsc]). */
const DARK_CSS = (() => {
  const rules = (prefix: string) =>
    (Object.keys(ROLES) as Role[])
      .map((r) => `${prefix}.tp-${r}{${ROLES[r](PALETTES.dark).replace(/;/g, " !important;")} !important}`)
      .join("");
  return `@media (prefers-color-scheme:dark){${rules("")}}${rules("[data-ogsc] ")}`;
})();

/** Styling of an e-mail's content in a theme: `attr("muted", "font-size:13px")` gives class and inline style. */
export function mailStyle(theme: MailTheme = null) {
  const c = theme === "dark" ? PALETTES.dark : PALETTES.light;
  // The role's colours last, so that a shorthand of `extra` (border:1px solid) does not reset them.
  const attr = (role: Role, extra = "") => `class="tp-${role}" style="${extra ? `${extra};` : ""}${ROLES[role](c)}"`;
  return {
    attr,
    link: (href: string, label: string, extra = "") => `<a href="${escape(href)}" ${attr("link", `text-decoration:none${extra ? `;${extra}` : ""}`)}>${label}</a>`,
    muted: (html: string, extra = "") => `<span ${attr("muted", extra)}>${html}</span>`,
    heading: (text: string) => `<h3 ${attr("text", "font-size:15px;font-weight:600;margin:20px 0 6px")}>${escape(text)}</h3>`,
    list: (items: string[]) => `<ul style="padding-left:18px;margin:0">${items.map((i) => `<li style="margin:2px 0">${i}</li>`).join("")}</ul>`,
    box: (html: string) => `<div ${attr("box", "border:1px solid;border-radius:10px;padding:12px 14px;margin:12px 0")}>${html}</div>`,
    button: (href: string, label: string) =>
      `<a href="${escape(href)}" style="display:inline-block;background-color:#0366d6;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escape(label)}</a>`,
  };
}

export interface MailLayout {
  title: string;
  /** Under the title, in grey. */
  intro?: string;
  /** Content, made with mailStyle(theme). */
  body: string;
  action?: { label: string; url: string };
  /** Small print at the bottom (HTML). */
  footer?: string;
  theme?: MailTheme;
}

/** A whole e-mail (or page) in the look of the app. */
export function mailLayout(lang: Locale, { title, intro, body, action, footer, theme = null }: MailLayout): string {
  const st = mailStyle(theme);
  const scheme = theme ?? "light dark";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="color-scheme" content="${scheme}"><meta name="supported-color-schemes" content="${scheme}"><title>${escape(title)}</title>`
    + `<style>:root{color-scheme:${scheme}}body{margin:0;padding:0}a{text-decoration:none}${theme ? "" : DARK_CSS}</style></head>`
    + `<body ${st.attr("page", `margin:0;padding:0;font-family:${FONT}`)}>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${st.attr("page")}><tr><td align="center" style="padding:28px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};font-size:15px;line-height:1.5">`
    + `<tr><td style="padding:0 4px 16px"><a href="${escape(config.appUrl)}/" ${st.attr("text", "text-decoration:none;font-weight:600;font-size:16px")}>`
    + `<img src="${escape(config.appUrl)}/icons/icon-192.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;border-radius:7px;margin-right:8px">TasksPipes</a></td></tr>`
    + `<tr><td ${st.attr("card", "border:1px solid;border-radius:12px;padding:28px")}><div ${st.attr("text")}>`
    + `<h1 ${st.attr("text", "font-size:20px;line-height:1.3;font-weight:600;margin:0 0 6px")}>${escape(title)}</h1>`
    + (intro ? `<p ${st.attr("muted", "margin:0 0 12px")}>${escape(intro)}</p>` : "")
    + body
    + (action ? `<p style="margin:24px 0 0">${st.button(action.url, action.label)}</p>` : "")
    + `</div></td></tr>`
    + (footer ? `<tr><td ${st.attr("muted", "padding:16px 4px 0;font-size:12px;line-height:1.5")}>${footer}</td></tr>` : "")
    + `</table></td></tr></table></body></html>`;
}

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
    .replace(/<head>[\s\S]*?<\/head>/g, "")
    .replace(/<a href="([^"]+)"[^>]*><img [^>]*>([^<]*)<\/a>/g, "")
    .replace(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (_, url, label) => (label === url ? url : `${label} (${url})`))
    .replace(/<li>/g, "\n- ")
    .replace(/<\/(h1|h2|h3|p|tr|div)>/g, "\n");
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
  const st = mailStyle();
  const html = mailLayout(lang, {
    title: subject,
    body: paragraphs.map((p) => `<p style="margin:0 0 12px">${escape(p)}</p>`).join(""),
    action,
    footer: `${escape(tr(lang, "Or copy this link:"))} ${st.link(action.url, escape(action.url), "word-break:break-all")}`,
  });
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
