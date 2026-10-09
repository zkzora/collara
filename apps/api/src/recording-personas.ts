// DevNet recording personas: demo persona sessions on the real DevNet ledger, for a LOCAL screen recording only.
// DevNet viewers normally come from the real OIDC account (app.ts); this opt-in exists so one operator can switch
// between synthetic roles while recording. It is off by default and fails closed twice:
//   1. at start (recordingPersonaIssues): DEVNET only, HOST is a loopback literal, not production, not the embedded
//      (Vercel) API, no trusted proxy; the PUBLIC_ORIGIN is checked too but is never the only guard.
//   2. per request (isLoopbackRequest): the socket peer, the Host header and every forwarded/origin header must be
//      loopback, so a tunnel or reverse proxy in front of 127.0.0.1 gets the same 404 as a disabled feature.
import type { FastifyRequest } from "fastify";

export interface RecordingPersonaInput {
  readonly DEVNET_RECORDING_PERSONAS?: boolean | undefined;
  readonly COLLARA_MODE: string;
  readonly NODE_ENV: string;
  readonly HOST: string;
  readonly PUBLIC_ORIGIN: string;
  readonly TRUST_PROXY?: string | undefined;
  readonly API_MODE?: string | undefined;
  readonly VERCEL?: string | undefined;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_BIND = new Set(["127.0.0.1", "::1"]);

/** Hostname of a Host/Origin-style value (port, scheme and IPv6 brackets removed), lower-cased; null when unparsable. */
export function hostnameOf(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  // A bare IPv6 literal (`::1`) is not a valid URL authority until bracketed.
  const bareIpv6 = !text.includes("://") && !text.startsWith("[") && text.split(":").length > 2;
  try {
    const url = new URL(text.includes("://") ? text : bareIpv6 ? `http://[${text}]` : `http://${text}`);
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isLoopbackHostname(value: string): boolean {
  const name = hostnameOf(value);
  return name !== null && LOOPBACK_HOSTNAMES.has(name);
}

export function isLoopbackAddress(value: string | undefined): boolean {
  return value !== undefined && LOOPBACK_ADDRESSES.has(value.toLowerCase());
}

/** Start-time refusals for DEVNET_RECORDING_PERSONAS=true; empty when the flag is off or every condition holds. */
export function recordingPersonaIssues(config: RecordingPersonaInput): { path: string; message: string }[] {
  if (!config.DEVNET_RECORDING_PERSONAS) return [];
  const issue = (message: string) => ({ path: "DEVNET_RECORDING_PERSONAS", message });
  const issues: { path: string; message: string }[] = [];
  if (config.COLLARA_MODE !== "DEVNET") issues.push(issue("DEVNET_RECORDING_PERSONAS only applies to COLLARA_MODE=DEVNET"));
  if (config.NODE_ENV === "production") issues.push(issue("DEVNET_RECORDING_PERSONAS is refused when NODE_ENV=production (local recording only)"));
  if (!LOOPBACK_BIND.has(config.HOST)) issues.push(issue(`DEVNET_RECORDING_PERSONAS needs HOST=127.0.0.1 (or ::1); HOST is "${config.HOST}"`));
  if (!isLoopbackHostname(config.PUBLIC_ORIGIN)) issues.push(issue("DEVNET_RECORDING_PERSONAS needs a loopback PUBLIC_ORIGIN (http://localhost:3000)"));
  if (config.TRUST_PROXY) issues.push(issue("DEVNET_RECORDING_PERSONAS is refused behind a trusted proxy (TRUST_PROXY is set)"));
  if (config.API_MODE === "embedded") issues.push(issue("DEVNET_RECORDING_PERSONAS is refused with API_MODE=embedded (public hosting)"));
  if (config.VERCEL) issues.push(issue("DEVNET_RECORDING_PERSONAS is refused on Vercel (public hosting)"));
  return issues;
}

const FORWARDING_HEADERS = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip", "forwarded"] as const;

function headerValues(request: Pick<FastifyRequest, "headers">, name: string): string[] {
  const value = request.headers[name];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

/**
 * True only for a request that reached the server from this machine, addressed to a loopback name, without any
 * forwarding header naming a non-loopback client or host. Uses the raw socket, never request.ip (TRUST_PROXY aware).
 */
export function isLoopbackRequest(request: Pick<FastifyRequest, "headers" | "raw">): boolean {
  if (!isLoopbackAddress(request.raw.socket.remoteAddress)) return false;
  const host = request.headers.host;
  if (typeof host !== "string" || !isLoopbackHostname(host)) return false;
  for (const value of headerValues(request, "x-forwarded-host")) if (!isLoopbackHostname(value)) return false;
  for (const value of headerValues(request, "origin")) if (!isLoopbackHostname(value)) return false;
  for (const name of FORWARDING_HEADERS) {
    for (const value of headerValues(request, name)) {
      // `forwarded: for=1.2.3.4;host=x`: check every for=/host= element.
      const parts = name === "forwarded" ? value.split(";").map((p) => p.trim().replace(/^(for|host|by)=/i, "").replace(/^"|"$/g, "")) : [value];
      for (const part of parts) {
        if (!part || /^proto=/i.test(part)) continue;
        const bare = part.replace(/^\[|\]$/g, "");
        if (!(isLoopbackAddress(bare) || isLoopbackHostname(bare))) return false;
      }
    }
  }
  return true;
}
