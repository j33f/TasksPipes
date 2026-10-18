import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { eventsOf, signature } from "./webhooks.js";

const entry = (over: Record<string, unknown>) => ({
  type: "status", comment: null, from_pipe_id: "p", to_pipe_id: "p", from_stage: "A", to_stage: "A",
  from_assignee_id: null, to_assignee_id: null, from_status: "backlog", to_status: "backlog", ...over,
});

describe("webhook events", () => {
  it("follow the history entries", () => {
    expect(eventsOf(entry({ type: "created", from_pipe_id: null, from_stage: null }))).toEqual(["task.created"]);
    expect(eventsOf(entry({ to_stage: "B", to_status: "ongoing" }))).toEqual(["task.moved"]);
    expect(eventsOf(entry({ to_pipe_id: "q" }))).toEqual(["task.moved"]);
    expect(eventsOf(entry({ to_assignee_id: "u" }))).toEqual(["task.assigned"]);
    expect(eventsOf(entry({ type: "comment", comment: "hi" }))).toEqual(["task.commented"]);
    expect(eventsOf(entry({ to_stage: "Done", to_status: "done" }))).toEqual(["task.moved", "task.done"]);
    // A refusal's reason is not a comment; an unchanged field is no event.
    expect(eventsOf(entry({ type: "refused", comment: "no" }))).toEqual([]);
    expect(eventsOf(entry({ type: "due" }))).toEqual([]);
  });

  it("are signed with HMAC-SHA256 of the timestamp and the body", () => {
    const expected = crypto.createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex");
    expect(signature("secret", 1700000000, '{"a":1}')).toBe(`sha256=${expected}`);
  });
});
