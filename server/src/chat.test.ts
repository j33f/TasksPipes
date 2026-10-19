import { describe, expect, it } from "vitest";
import { chatBody, sentence, type Delivery } from "./chat.js";

const task = { key: "TP-12", title: "Fix <login> & [menu]", column: "Terminé", owner: { name: "Bob" }, url: "https://tasks.test/pipes/p?task=t" };
const d = (over: Partial<Delivery> = {}): Delivery => ({ event: "task.moved", pipe: { name: "Board" }, task, actor: { name: "Alice" }, ...over });

describe("chat messages", () => {
  it("say what happened, in the webhook's language", () => {
    expect(sentence("en", d({ event: "task.created" }), "X")).toBe("Alice created X in Board");
    expect(sentence("en", d(), "X")).toBe("Alice moved X to Done");
    expect(sentence("fr", d(), "X")).toBe("Alice a déplacé X vers Terminé");
    expect(sentence("en", d({ event: "task.assigned" }), "X")).toBe("Alice made Bob the owner of X");
    expect(sentence("fr", d({ event: "task.done" }), "X")).toBe("Alice a terminé X");
    expect(sentence("en", { event: "ping", pipe: { name: "Board" } }, "")).toBe("Test message from TasksPipes, for the pipe Board");
  });

  it("are Slack messages with a link, the text escaped", () => {
    const body = chatBody("slack", "en", d()) as { text: string; blocks: unknown[] };
    expect(body.text).toBe("Alice moved <https://tasks.test/pipes/p?task=t|TP-12 Fix &lt;login&gt; &amp; [menu]> to Done");
    expect(body.blocks).toHaveLength(1);
  });

  it("quote the start of a comment", () => {
    const long = "x".repeat(400);
    const slack = chatBody("slack", "en", d({ event: "task.commented", comment: long })) as { blocks: { text: { text: string } }[] };
    expect(slack.blocks[1].text.text).toBe(`> ${"x".repeat(300)}…`);
    const mm = chatBody("mattermost", "en", d({ event: "task.commented", comment: "Looks *good*" })) as { text: string };
    expect(mm.text).toBe("Alice commented on [TP-12 Fix <login> & \\[menu\\]](https://tasks.test/pipes/p?task=t)\n> Looks \\*good\\*");
  });

  it("are Discord messages with a link, pinging no one", () => {
    const body = chatBody("discord", "en", d({ event: "task.commented", comment: "@everyone ||look||" })) as { content: string; allowed_mentions: unknown };
    expect(body.content).toBe("Alice commented on [TP-12 Fix <login> & \\[menu\\]](https://tasks.test/pipes/p?task=t)\n> @everyone \\|\\|look\\|\\|");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("are Adaptive Cards for Teams, with a button to the task", () => {
    const body = chatBody("teams", "fr", d({ event: "task.done" })) as any;
    const card = body.attachments[0];
    expect(card.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.content.body[0].text).toBe("Alice a terminé [TP-12 Fix <login> & \\[menu\\]](https://tasks.test/pipes/p?task=t)");
    expect(card.content.actions[0]).toEqual({ type: "Action.OpenUrl", title: "Ouvrir la tâche", url: task.url });
  });
});
