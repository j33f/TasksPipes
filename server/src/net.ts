/**
 * Requests to servers people choose (their Outline server, their webhooks' URLs): internal addresses are refused
 * when the connection opens, so a name checked as public cannot point inside afterwards (DNS rebinding).
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Private, loopback, link-local… addresses: never reached on behalf of someone. */
const PRIVATE = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  PRIVATE.addSubnet(a, p, "ipv4");
}
for (const [a, p] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(a, p, "ipv6");

export function isPrivateIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIp(mapped[1]);
  return PRIVATE.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export type LookupFunction = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/** A DNS lookup refusing internal addresses (error code EPRIVATE), unless they are allowed. */
export function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      if (!allowPrivate && addresses.some((a) => isPrivateIp(a.address))) {
        return callback(Object.assign(new Error("internal address"), { code: "EPRIVATE" }), []);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const MAX_RESPONSE = 20 * 1024 * 1024;

/** POSTs a body through `lookup`, without following redirects; the answer is capped. */
export function postJson(
  url: string, headers: Record<string, string>, body: string | Buffer, lookup: LookupFunction, { timeoutMs = 15_000, maxResponse = MAX_RESPONSE } = {}
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: "POST", headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) }, lookup, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxResponse) req.destroy(new Error("response too large"));
          else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 502, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
