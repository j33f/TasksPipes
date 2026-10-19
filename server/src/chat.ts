/**
 * Webhooks posting to a chat channel (Slack, Mattermost, Microsoft Teams, Discord) through its incoming webhook: the
 * delivery of a pipe's webhook (webhooks.ts) is written as a short message, in the webhook's language, with a link to
 * the task.
 */
import { localize, tr, type Locale } from "./i18n.js";

export const FORMATS = ["json", "slack", "mattermost", "teams", "discord"] as const;
export type Format = (typeof FORMATS)[number];

/** The parts of a delivery a message uses (see payload() in webhooks.ts). */
export interface Delivery {
  event: string;
  pipe: { name: string };
  task?: { key: string; title: string; column: string | null; owner: { name: string } | null; url: string };
  actor?: { name: string };
  comment?: string | null;
}

const EXCERPT = 300;
const excerpt = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT)}…` : s);

/** What happened, in a sentence: `task` is the task's name as the channel shows a link. */
export function sentence(lang: Locale, d: Delivery, task: string): string {
  const name = d.actor?.name ?? tr(lang, "Someone");
  switch (d.event) {
    case "task.created":
      return tr(lang, "{name} created {task} in {pipe}", { name, task, pipe: d.pipe.name });
    case "task.moved":
      return tr(lang, "{name} moved {task} to {column}", { name, task, column: d.task?.column ? localize(lang, d.task.column) : d.pipe.name });
    case "task.assigned":
      return tr(lang, "{name} made {owner} the owner of {task}", { name, task, owner: d.task?.owner?.name ?? tr(lang, "nobody") });
    case "task.commented":
      return tr(lang, "{name} commented on {task}", { name, task });
    case "task.done":
      return tr(lang, "{name} finished {task}", { name, task });
    default:
      return tr(lang, "Test message from TasksPipes, for the pipe {pipe}", { pipe: d.pipe.name });
  }
}

// Slack's text escapes &, < and >; Mattermost, Teams and Discord read Markdown, where brackets would break a link
// (and Discord hides text between || as a spoiler).
const slackText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const markdownText = (s: string) => s.replace(/([\\[\]*_`~])/g, "\\$1");
const discordText = (s: string) => markdownText(s).replace(/[\\|]/g, "\\$&");

/** The body posted to the channel, for a format other than "json". */
export function chatBody(format: Exclude<Format, "json">, lang: Locale, d: Delivery): object {
  const quote = d.event === "task.commented" && d.comment ? excerpt(d.comment) : null;
  if (format === "slack") {
    const task = d.task ? `<${d.task.url}|${slackText(`${d.task.key} ${d.task.title}`)}>` : "";
    const text = slackText(sentence(lang, d, "\u0000")).replace("\u0000", task);
    return {
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        ...(quote ? [{ type: "section", text: { type: "mrkdwn", text: `> ${slackText(quote).replace(/\n/g, "\n> ")}` } }] : []),
      ],
    };
  }
  if (format === "discord") {
    const task = d.task ? `[${discordText(`${d.task.key} ${d.task.title}`)}](${d.task.url})` : "";
    const text = discordText(sentence(lang, d, "\u0000")).replace("\u0000", task);
    // No @everyone, role or user ping from a task's title or a comment.
    return { content: quote ? `${text}\n> ${discordText(quote).replace(/\n/g, "\n> ")}` : text, allowed_mentions: { parse: [] } };
  }
  const task = d.task ? `[${markdownText(`${d.task.key} ${d.task.title}`)}](${d.task.url})` : "";
  const text = markdownText(sentence(lang, d, "\u0000")).replace("\u0000", task);
  if (format === "mattermost") {
    return { text: quote ? `${text}\n> ${markdownText(quote).replace(/\n/g, "\n> ")}` : text };
  }
  // Teams: an Adaptive Card, as Workflows incoming webhooks expect it.
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text, wrap: true },
          ...(quote ? [{ type: "TextBlock", text: markdownText(quote), wrap: true, isSubtle: true }] : []),
        ],
        ...(d.task ? { actions: [{ type: "Action.OpenUrl", title: tr(lang, "Open the task"), url: d.task.url }] } : {}),
      },
    }],
  };
}
