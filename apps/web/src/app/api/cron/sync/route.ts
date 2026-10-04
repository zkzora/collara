import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Daily safety-net pass of the on-request sync (vercel.json crons; Hobby allows at most one run per day, timed
 * within the hour). Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the route is disabled.
 * Not a persistent worker: between requests and this daily run nothing advances.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest): Promise<Response> {
  const noStore = { "cache-control": "private, no-store" };
  const secret = process.env.CRON_SECRET;
  if (process.env.API_MODE !== "embedded" || process.env.WORKER_MODE !== "on-request" || !secret || secret.length < 16) {
    return Response.json({ error: "not_available" }, { status: 404, headers: noStore });
  }
  if (!authorized(request.headers.get("authorization"), secret)) return Response.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  const { embeddedApi } = await import("@/server/embedded-api");
  const { sync } = await embeddedApi().catch(() => ({ sync: null }));
  if (!sync) return Response.json({ error: "sync_unavailable" }, { status: 503, headers: noStore });
  const result = await sync.sync({ force: true });
  // Counts only: no party ids, payloads or error text in the response.
  return Response.json(
    { status: result.status, partial: result.partial, exportsProcessed: result.exportsProcessed, durationMs: result.durationMs },
    { status: result.status === "FAILED" ? 500 : 200, headers: noStore },
  );
}
