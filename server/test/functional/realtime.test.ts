import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, alice: Agent, bob: Agent, base: string;

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as { port: number };
  base = `ws://127.0.0.1:${addr.port}/api/events`;
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
});
afterAll(stopApp);

/** Opens a live connection and collects its messages. */
function connect(cookie: string, origin = "http://tasks.test") {
  const ws = new WebSocket(base, { headers: { cookie, origin } });
  const messages: any[] = [];
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  ws.on("message", (m) => messages.push(JSON.parse(String(m))));
  const next = (type: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type}`)), 5000);
      const check = () => {
        const m = messages.find((x) => x.type === type);
        if (m) {
          clearTimeout(timer);
          resolve(m);
        } else setTimeout(check, 20);
      };
      check();
    });
  return { ws, next, closed };
}

describe("live updates", () => {
  it("greet with the server version", async () => {
    const c = connect(bob.cookie);
    const hello = await c.next("hello");
    expect(hello.version).toMatch(/^\d+\.\d+\.\d+$/);
    c.ws.close();
  });

  it("tell the recipient of a task sent, and the sender of a refusal", async () => {
    const b = connect(bob.cookie);
    const a = connect(alice.cookie);
    await b.next("hello");
    await a.next("hello");
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    const id = (await alice.post("/api/tasks", { title: "Live one", spaceId: bobSpace })).body.id;
    expect((await b.next("task.sent")).task).toMatchObject({ id, title: "Live one" });
    await bob.post(`/api/tasks/${id}/refuse`, { reason: "busy" });
    expect(await a.next("task.refused")).toMatchObject({ reason: "busy", by: "Bob Durand" });
    a.ws.close();
    b.ws.close();
  });

  it("refuse other sites and signed-out pages", async () => {
    expect(await connect(bob.cookie, "https://evil.example").closed).toBe(4401);
    expect(await connect("").closed).toBe(4401);
  });
});
