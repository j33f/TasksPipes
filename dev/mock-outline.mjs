// Minimal fake Outline API for local testing. Tokens: alice-token, bob-token, carol-token.
import http from "node:http";

const users = {
  "alice-token": { id: "11111111-1111-4111-8111-111111111111", name: "Alice Martin", email: "alice@example.com", avatarUrl: null },
  "bob-token": { id: "22222222-2222-4222-8222-222222222222", name: "Bob Durand", email: "bob@example.com", avatarUrl: null },
  "carol-token": { id: "33333333-3333-4333-8333-333333333333", name: "Carol Petit", email: "carol@example.com", avatarUrl: null },
};
const docs = [
  { id: "doc-1", title: "Roadmap 2027", url: "/doc/roadmap-2027-abc123", updatedAt: new Date().toISOString(), collectionId: "col-1" },
  { id: "doc-2", title: "Guide d'onboarding", url: "/doc/guide-onboarding-def456", updatedAt: new Date().toISOString(), collectionId: "col-1" },
];

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const user = users[(req.headers.authorization || "").replace("Bearer ", "")];
    if (!user) return send(401, { ok: false, error: "authentication_required", message: "Authentication required" });
    const input = body ? JSON.parse(body) : {};
    switch (req.url) {
      case "/api/auth.info": return send(200, { data: { user, team: { id: "team-1", name: "Demo" } } });
      case "/api/users.list": return send(200, { data: input.offset ? [] : Object.values(users) });
      case "/api/documents.list": return send(200, { data: docs });
      case "/api/documents.search":
        return send(200, { data: docs.filter((d) => d.title.toLowerCase().includes(String(input.query).toLowerCase())).map((document) => ({ document })) });
      case "/api/documents.info": {
        const d = docs.find((x) => x.id === input.id || x.url.endsWith(input.id));
        return d ? send(200, { data: d }) : send(404, { ok: false, message: "Not found" });
      }
      case "/api/collections.list": return send(200, { data: [{ id: "col-1", name: "Général" }] });
      case "/api/documents.create": {
        const d = { id: `doc-${docs.length + 1}`, title: input.title, url: `/doc/new-${docs.length + 1}`, updatedAt: new Date().toISOString(), collectionId: input.collectionId };
        docs.push(d);
        return send(200, { data: d });
      }
      default: return send(404, { ok: false, message: `Unknown method ${req.url}` });
    }
  });
}).listen(Number(process.env.PORT || 4000), () => console.log(`Mock Outline on :${process.env.PORT || 4000}`));
