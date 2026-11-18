/**
 * Several instances of the app on one database (REALTIME_SHARED, on by default): a page connected to one instance
 * hears what happens on another, and who has a page open is known to all. The second instance runs in its own
 * process: in this one, both would share the same connections and prove nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { closeUserConnections, isOnline } from "../../src/realtime.js";
import { migrate, pool } from "../../src/db.js";

let other: ChildProcess, otherBase: string, alice: Agent, bob: Agent, bobId: string;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  bobId = (await bob.get("/api/me")).body.user.id;
  other = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./second-instance.ts", import.meta.url))], {
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<string>((resolve, reject) => {
    other.stdout!.once("data", (d) => resolve(String(d).trim()));
    other.once("exit", (code) => reject(new Error(`second instance exited (${code})`)));
  });
  otherBase = `ws://127.0.0.1:${port}/api/events`;
});

afterAll(async () => {
  if (other && other.exitCode === null) {
    const exited = new Promise((r) => other.once("exit", r));
    other.kill("SIGTERM");
    await exited;
  }
  await stopApp();
});

/** A page connected to the second instance, collecting its messages. */
function connectToOther(cookie: string) {
  const ws = new WebSocket(otherBase, { headers: { cookie, origin: "http://tasks.test" } });
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

/** Waits until `fn` holds (presence is recorded without waiting for it). */
async function eventually(fn: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("never happened");
}

describe("several instances on one database", () => {
  it("take turns to bring the schema up to date", async () => {
    // Both instances ran it at start; once more, concurrently, still works.
    const log = { info() {}, warn() {} } as never;
    await Promise.all([migrate(log), migrate(log)]);
  });

  it("deliver an event made on one instance to a page open on another", async () => {
    const b = connectToOther(bob.cookie);
    await b.next("hello");
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    // Made through this instance, where Bob has no page open.
    const id = (await alice.post("/api/tasks", { title: "Across instances", spaceId: bobSpace })).body.id;
    expect((await b.next("task.sent")).task).toMatchObject({ id, title: "Across instances" });
    b.ws.close();
    await b.closed;
  });

  it("know who has a page open on another instance, and when it is closed", async () => {
    // The page of the test before is gone, once the other instance has said so (it does not wait for it).
    await eventually(async () => !(await isOnline(bobId)));
    const b = connectToOther(bob.cookie);
    await b.next("hello");
    await eventually(() => isOnline(bobId));
    b.ws.close();
    await b.closed;
    await eventually(async () => !(await isOnline(bobId)));
  });

  it("ignore what else is sent on their channel, without stopping", async () => {
    for (const junk of ["null", "not json", "42", '{"kind":"user","userId":{},"message":[]}', '{"kind":"space","spaceId":1}'])
      await pool.query(`SELECT pg_notify('taskspipes_live', $1)`, [junk]);
    // The other instance still serves its pages, and still hears this one.
    const b = connectToOther(bob.cookie);
    await b.next("hello");
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    await alice.post("/api/tasks", { title: "After the junk", spaceId: bobSpace });
    expect((await b.next("task.sent")).task.title).toBe("After the junk");
    b.ws.close();
    await b.closed;
    expect(other.exitCode).toBeNull();
  });

  it("close the pages of someone whose access ended, on every instance", async () => {
    const b = connectToOther(bob.cookie);
    await b.next("hello");
    closeUserConnections(bobId);
    expect(await b.closed).toBe(4401);
  });
});
