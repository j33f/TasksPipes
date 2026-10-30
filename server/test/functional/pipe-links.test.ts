import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, team: string, pipe: string;
const links = async () => (await alice.get(`/api/pipes/${pipe}`)).body.links as { id: string; source: string; url: string; title: string; outlineDocId: string | null }[];

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  team = (await alice.post("/api/spaces", { name: "Pipe documents", members: [] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Website redesign", description: "The new site", kind: "dev" })).body.id;
});
afterAll(stopApp);

describe("The documents linked to a pipe", () => {
  it("are none at first", async () => {
    expect(await links()).toEqual([]);
  });

  it("are pages anywhere, their source found from the address", async () => {
    const figma = await alice.post(`/api/pipes/${pipe}/links`, { url: "https://www.figma.com/design/abc/Site", title: "Mock-ups" });
    expect(figma.status).toBe(200);
    expect(figma.body).toMatchObject({ source: "figma", title: "Mock-ups", outlineDocId: null });
    // Without a title, the address names it.
    const repo = await alice.post(`/api/pipes/${pipe}/links`, { url: "https://github.com/acme/site" });
    expect(repo.body).toMatchObject({ source: "github", title: "github.com/acme/site" });
    await alice.post(`/api/pipes/${pipe}/links`, { url: "https://docs.google.com/document/d/1x/edit", title: "Brief" });
    expect((await links()).map((l) => l.source)).toEqual(["figma", "github", "google_docs"]);
  });

  it("are Outline documents, picked in the search or created from the pipe", async () => {
    const picked = await alice.post(`/api/pipes/${pipe}/links`, {
      url: "http://localhost:4100/doc/roadmap-2027-abc123", title: "Roadmap 2027", outlineDocId: "doc-1",
    });
    expect(picked.body).toMatchObject({ source: "outline", outlineDocId: "doc-1" });

    expect((await alice.post(`/api/pipes/${pipe}/outline-document`, {})).status).toBe(400);
    const created = await alice.post(`/api/pipes/${pipe}/outline-document`, { collectionId: "col-1" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ source: "outline", title: "Website redesign", outlineDocId: expect.stringMatching(/^doc-/) });
    expect((await links()).at(-1)).toEqual(created.body);
  });

  it("must be web addresses", async () => {
    for (const url of ["javascript:alert(1)", "ftp://example.com/x", "not a url", ""]) {
      expect((await alice.post(`/api/pipes/${pipe}/links`, { url })).status).toBe(400);
    }
    expect((await alice.post(`/api/pipes/${pipe}/links`, { url: "javascript:alert(1)" })).body.error)
      .toBe("Invalid address: it must start with https:// or http://");
  });

  it("are removed by the pipe's members", async () => {
    const [first] = await links();
    expect((await alice.del(`/api/pipes/${pipe}/links/${first.id}`)).status).toBe(200);
    expect((await links()).some((l) => l.id === first.id)).toBe(false);
    expect((await alice.del(`/api/pipes/${pipe}/links/${first.id}`)).status).toBe(404);
  });

  it("are out of reach of people outside the team", async () => {
    const [link] = await links();
    expect((await bob.post(`/api/pipes/${pipe}/links`, { url: "https://example.com" })).status).toBe(404);
    expect((await bob.del(`/api/pipes/${pipe}/links/${link.id}`)).status).toBe(404);
    expect((await bob.post(`/api/pipes/${pipe}/outline-document`, { collectionId: "col-1" })).status).toBe(404);
  });

  it("go with their pipe", async () => {
    const other = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Short-lived" })).body.id;
    await alice.post(`/api/pipes/${other}/links`, { url: "https://example.com/x" });
    expect((await alice.del(`/api/pipes/${other}`)).status).toBe(200);
  });
});
