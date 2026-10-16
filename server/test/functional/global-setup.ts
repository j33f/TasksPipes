/** Starts the fake Outline and empties the test database before the functional tests. */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

let mock: ChildProcess | undefined;

export async function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgres://postgres:test@localhost:5432/taskspipes_test";
  const port = process.env.MOCK_OUTLINE_PORT || "4100";

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();

  mock = spawn(process.execPath, [fileURLToPath(new URL("../../../dev/mock-outline.mjs", import.meta.url))], {
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    mock!.stdout!.once("data", () => resolve());
    mock!.once("exit", (code) => reject(new Error(`mock Outline exited (${code})`)));
  });
}

export async function teardown() {
  mock?.kill();
}
