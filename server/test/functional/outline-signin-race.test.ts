/**
 * Accounts from Outline made at the same time by two transactions: the import of a workspace after a sign-in
 * (auth.ts syncWorkspaceUsers, in the background) and someone of it signing in meanwhile. Neither may fail.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, stopApp } from "./helpers.js";
import { upsertOutlineUser } from "../../src/auth.js";
import { query, tx } from "../../src/db.js";
import { config } from "../../src/config.js";

beforeAll(startApp);
afterAll(stopApp);

describe("accounts from Outline made by two transactions at once", () => {
  it("are made once, whoever comes first", async () => {
    for (let round = 0; round < 10; round++) {
      const people = Array.from({ length: 20 }, (_, i) => ({ id: crypto.randomUUID(), name: `Racer ${round}-${i}` }));
      // The workspace import makes them one after the other in one transaction, while each of them signs in.
      const results = await Promise.allSettled([
        tx(async (client) => {
          for (const u of people) await upsertOutlineUser(client, u);
        }),
        ...people.map((u) => tx((client) => upsertOutlineUser(client, u, { login: true }))),
      ]);
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM users WHERE outline_url = $1 AND outline_id = ANY($2::text[])`,
        [config.outlineUrl, people.map((u) => u.id)]
      );
      expect(rows[0].n).toBe(people.length);
    }
  });
});
