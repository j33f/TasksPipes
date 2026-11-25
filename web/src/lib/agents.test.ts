import { describe, expect, it } from "vitest";
import { agentChoices, ownerBody, ownerValue } from "./agents";

const toto = { id: "u1", name: "Toto" };

describe("owner choices with AI agents", () => {
  it("reads and sends a person or their agent", () => {
    expect(ownerValue(null)).toBeNull();
    expect(ownerValue(toto)).toBe("u1");
    expect(ownerValue({ ...toto, agent: true })).toBe("agent:u1");
    expect(ownerBody("agent:u1")).toEqual({ assigneeId: "u1", assigneeAgent: true });
    expect(ownerBody("u1")).toEqual({ assigneeId: "u1", assigneeAgent: false });
    expect(ownerBody(null)).toEqual({ assigneeId: null, assigneeAgent: false });
  });

  it("offers one's own agent only, and shows someone else's when a task is handed to it", () => {
    expect(agentChoices(toto, false)).toEqual([]);
    expect(agentChoices(toto, true)).toEqual([{ id: "u1", name: "Toto" }]);
    expect(agentChoices(toto, true, { id: "u2", name: "Lea", agent: true })).toEqual([
      { id: "u1", name: "Toto" }, { id: "u2", name: "Lea", disabled: true },
    ]);
    expect(agentChoices(toto, false, { id: "u1", name: "Toto", agent: true })).toEqual([{ id: "u1", name: "Toto", disabled: true }]);
  });
});
