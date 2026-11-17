import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, base: string;
let alice: Agent, bob: Agent, carol: Agent;
let ids: Record<string, string>, team: string;

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/events`;
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  ids = {};
  for (const [n, a] of [["alice", alice], ["bob", bob], ["carol", carol]] as const) ids[n] = (await a.get("/api/me")).body.user.id;
  const res = await alice.post("/api/spaces", { name: "Visibility team", members: [{ userId: ids.bob }, { userId: ids.carol }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  team = res.body.id;
});
afterAll(stopApp);

const create = async (who: Agent, body: Record<string, unknown>) => {
  const r = await who.post("/api/tasks", body);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
};
const pipeTaskIds = async (who: Agent, pipe: string) => ((await who.get(`/api/pipes/${pipe}`)).body.tasks as { id: string }[]).map((t) => t.id);

describe("in a team pipe, every member sees every task, whoever created it and whoever owns it", () => {
  for (const [label, kind, visibility, taskType] of [
    ["private pipe", undefined, undefined, undefined],
    ["open pipe", undefined, "open", undefined],
    ["pipe reserved to the team (PSH)", "psh", undefined, "accompagnement_psh"],
  ] as const) {
    it(label, async () => {
      const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: `Board ${label}`, kind, visibility })).body.id;
      const extra = taskType ? { taskType } : {};
      const due = "2030-03-10";
      const word = label.split(" ")[0] + "zq";
      const tasks = [
        // Bob creates, owned by Carol.
        await create(bob, { title: `${word} bob to carol`, pipeId: pipe, assigneeId: ids.carol, dueDate: due, ...extra }),
        // Alice creates, owned by Bob.
        await create(alice, { title: `${word} alice to bob`, pipeId: pipe, assigneeId: ids.bob, dueDate: due, ...extra }),
        // Carol creates, owned by nobody.
        await create(carol, { title: `${word} carol to none`, pipeId: pipe, dueDate: due, ...extra }),
      ];
      for (const [name, who] of [["alice", alice], ["bob", bob], ["carol", carol]] as const) {
        expect(await pipeTaskIds(who, pipe), `${name} in the pipe`).toEqual(expect.arrayContaining(tasks));
        for (const id of tasks) expect((await who.get(`/api/tasks/${id}`)).status, `${name} opens ${id}`).toBe(200);
        // Team calendar (scope=all) of the pipe.
        const cal = (await who.get(`/api/calendar?from=2030-03-01&to=2030-03-31&scope=all&pipe=${pipe}`)).body.tasks.map((t: { id: string }) => t.id);
        expect(cal, `${name} in the calendar`).toEqual(expect.arrayContaining(tasks));
        // Search.
        const found = JSON.stringify((await who.get(`/api/search?q=${word}`)).body);
        for (const id of tasks) expect(found, `${name} finds ${id}`).toContain(id);
      }
    });
  }
});

describe("live updates in a team pipe", () => {
  const connect = (cookie: string) => {
    const ws = new WebSocket(base, { headers: { cookie, origin: "http://tasks.test" } });
    const messages: any[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    return { ws, messages, open: new Promise((r) => ws.on("open", r)) };
  };

  for (const [label, act] of [
    ["a task created by another member", async (pipe: string) => { await create(bob, { title: "Live create", pipeId: pipe, assigneeId: ids.alice }); }],
    ["a task reassigned / moved by another member", async (_pipe: string, task: string) => { await bob.patch(`/api/tasks/${task}`, { stage: "ongoing", assigneeId: ids.bob }); }],
    ["a comment by another member", async (_pipe: string, task: string) => { await bob.post(`/api/tasks/${task}/comments`, { body: "hello" }); }],
  ] as const) {
    it(`notify the other members of ${label}`, async () => {
      const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: `Live ${label}` })).body.id;
      const task = await create(alice, { title: "Base", pipeId: pipe });
      const c = connect(carol.cookie);
      await c.open;
      await new Promise((r) => setTimeout(r, 200));
      const before = c.messages.length;
      await act(pipe, task);
      await new Promise((r) => setTimeout(r, 500));
      const after = c.messages.slice(before).map((m) => m.type);
      c.ws.close();
      expect(after, "events received by Carol").not.toEqual([]);
    });
  }
});
