// Minimal fake Outline API for local testing. Tokens: alice-token, bob-token, carol-token (dave-token: a colleague
// listed in the workspace whom the tests never sign in).
import http from "node:http";

const users = {
  "alice-token": { id: "11111111-1111-4111-8111-111111111111", name: "Alice Martin", email: "alice@example.com", avatarUrl: null },
  "bob-token": { id: "22222222-2222-4222-8222-222222222222", name: "Bob Durand", email: "bob@example.com", avatarUrl: null },
  "carol-token": { id: "33333333-3333-4333-8333-333333333333", name: "Carol Petit", email: "carol@example.com", avatarUrl: null },
  "dave-token": { id: "44444444-4444-4444-8444-444444444444", name: "Dave Leroy", email: "dave@example.com", avatarUrl: null },
};
// API keys of people who never sign in nor show in the workspace: the tests revoke them (reports published to Outline).
const apiKeys = {
  "erin-token": { id: "55555555-5555-4555-8555-555555555555", name: "Erin Moreau", email: "erin@example.com", avatarUrl: null },
  "frank-token": { id: "66666666-6666-4666-8666-666666666666", name: "Frank Girard", email: "frank@example.com", avatarUrl: null },
  // Connected with OAuth only (code=gina-token).
  "gina-token": { id: "77777777-7777-4777-8777-777777777777", name: "Gina Roux", email: "gina@example.com", avatarUrl: null },
};
const docs = [
  { id: "doc-1", title: "Roadmap 2027", url: "/doc/roadmap-2027-abc123", updatedAt: new Date().toISOString(), collectionId: "col-1" },
  { id: "doc-2", title: "Guide d'onboarding", url: "/doc/guide-onboarding-def456", updatedAt: new Date().toISOString(), collectionId: "col-1" },
];

let failing = { times: 0, status: 503, created: false };

// OAuth: a code is the token of the person who signs in (code=alice-token), also their first access token. Each
// refresh token is used once: a refresh gives a new access token ("alice-token~3") and a new refresh token.
const refreshTokens = {};
const oauthAccess = {};
let grants = 0;
const issue = (person, access) => {
  const refresh = `refresh-${++grants}`;
  refreshTokens[refresh] = person;
  return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600 };
};

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    // Tests: an API key revoked from now on (POST /test/revoke {"token": "erin-token"}); with "oauth": true, the
    // OAuth connections of that person instead (their refresh and access tokens).
    if (req.url === "/test/revoke") {
      const { token, oauth } = JSON.parse(body || "{}");
      if (!oauth) delete apiKeys[token];
      else for (const map of [refreshTokens, oauthAccess]) for (const [k, v] of Object.entries(map)) if (v === token) delete map[k];
      return send(200, { ok: true });
    }
    // Tests: the next documents.create calls fail (POST /test/fail {"times": 1, "status": 503}); with "created": true,
    // the document is created all the same, as when Outline answers too late.
    if (req.url === "/test/fail") {
      failing = { times: 1, status: 503, created: false, ...JSON.parse(body || "{}") };
      return send(200, { ok: true });
    }
    if (req.url === "/oauth/token") {
      const params = new URLSearchParams(body);
      if (params.get("grant_type") === "refresh_token") {
        const person = refreshTokens[params.get("refresh_token")];
        if (!person) return send(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
        delete refreshTokens[params.get("refresh_token")];
        const access = `${person}~${grants + 1}`;
        oauthAccess[access] = person;
        return send(200, issue(person, access));
      }
      const code = params.get("code");
      return users[code] || apiKeys[code] ? send(200, issue(code, code)) : send(400, { error: "invalid_grant", error_description: "Invalid code" });
    }
    const bearer = (req.headers.authorization || "").replace("Bearer ", "");
    const person = oauthAccess[bearer] ?? bearer;
    const user = users[person] ?? apiKeys[person];
    if (!user) return send(401, { ok: false, error: "authentication_required", message: "Authentication required" });
    const input = body ? JSON.parse(body) : {};
    switch (req.url) {
      case "/api/auth.info": return send(200, { data: { user, team: { id: "team-1", name: "Demo" } } });
      case "/api/users.list": return send(200, { data: input.offset ? [] : Object.values(users) });
      case "/api/documents.list": return send(200, { data: input.parentDocumentId ? docs.filter((d) => d.parentDocumentId === input.parentDocumentId).reverse() : docs });
      case "/api/documents.search":
        return send(200, { data: docs.filter((d) => d.title.toLowerCase().includes(String(input.query).toLowerCase())).map((document) => ({ document })) });
      case "/api/documents.info": {
        const d = docs.find((x) => x.id === input.id || x.url.endsWith(input.id));
        return d ? send(200, { data: d }) : send(404, { ok: false, message: "Not found" });
      }
      case "/api/collections.list": return send(200, { data: [{ id: "col-1", name: "Général" }] });
      case "/api/documents.create": {
        const parent = input.parentDocumentId && docs.find((x) => x.id === input.parentDocumentId);
        if (input.parentDocumentId && !parent) return send(404, { ok: false, message: "Parent document not found" });
        const d = {
          id: `doc-${docs.length + 1}`, title: input.title, url: `/doc/new-${docs.length + 1}`, updatedAt: new Date().toISOString(),
          collectionId: input.collectionId ?? parent?.collectionId, parentDocumentId: input.parentDocumentId ?? null, text: input.text ?? "",
          createdBy: user.name,
        };
        if (failing.times > 0) {
          failing.times--;
          if (failing.created) docs.push(d);
          return send(failing.status, { ok: false, message: "Service unavailable" });
        }
        docs.push(d);
        return send(200, { data: d });
      }
      default: return send(404, { ok: false, message: `Unknown method ${req.url}` });
    }
  });
}).listen(Number(process.env.PORT || 4000), () => console.log(`Mock Outline on :${process.env.PORT || 4000}`));
