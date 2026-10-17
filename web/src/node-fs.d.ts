// Unit tests run in Node: the part of node:fs they use, without adding @types/node to the web app.
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
