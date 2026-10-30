// Pure billing rules (no I/O) — shared by server code and tests.

export const TRIAL_DAYS = 7;
/** Configurable free-plan limits; existing data above the limit is never hidden or deleted. */
export const FREE_LIMITS = { financeGoals: 3, healthGoals: 3 } as const;

const DAY = 86_400_000;

export type Grant = {
  id?: string;
  source: string;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
};

export function isGrantActive(g: Grant, now = Date.now()) {
  if (g.revoked_at) return false;
  if (Date.parse(g.starts_at) > now) return false;
  return g.ends_at === null || Date.parse(g.ends_at) > now;
}

/** VIP end date for the user (null = permanent, undefined = not VIP). */
export function vipUntil(grants: Grant[], now = Date.now()): string | null | undefined {
  const active = grants.filter((g) => isGrantActive(g, now));
  if (active.length === 0) return undefined;
  if (active.some((g) => g.ends_at === null)) return null;
  return active.map((g) => g.ends_at!).sort().at(-1);
}

/** A paid period starts when the user's current VIP ends (never shortens or overlaps). */
export function paidWindow(grants: Grant[], periodDays: number, now = Date.now()) {
  const nonRevoked = grants.filter((g) => !g.revoked_at && g.ends_at && Date.parse(g.ends_at) > now);
  const start = Math.max(now, ...nonRevoked.map((g) => Date.parse(g.ends_at!)));
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(start + periodDays * DAY).toISOString() };
}

export const trialWindow = (now = Date.now()) => ({
  starts_at: new Date(now).toISOString(),
  ends_at: new Date(now + TRIAL_DAYS * DAY).toISOString(),
});

export type Order = { id: string; user_id: string; plan_id: string; external_reference: string; amount_cents: number; currency: string };
export type MpPayment = {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount: number;
  currency_id: string;
  metadata?: Record<string, unknown> | null;
};

/** Checks that the provider payment really belongs to our order (reference, user, plan, amount, currency). */
export function validatePayment(p: MpPayment, o: Order): string | null {
  if (p.external_reference !== o.external_reference) return "reference_mismatch";
  if (p.currency_id !== o.currency) return "currency_mismatch";
  if (Math.round(p.transaction_amount * 100) !== o.amount_cents) return "amount_mismatch";
  const md = p.metadata ?? {};
  if (md["user_id"] && md["user_id"] !== o.user_id) return "user_mismatch";
  if (md["plan_id"] && md["plan_id"] !== o.plan_id) return "plan_mismatch";
  return null;
}

const REVERSED = new Set(["refunded", "charged_back", "cancelled"]);

/** What to do with the VIP benefit given the real payment status and whether a grant already exists. */
export function decideAction(status: string, grant: { revoked_at: string | null } | null): "grant" | "revoke" | "none" {
  if (status === "approved") return grant ? "none" : "grant";
  if (REVERSED.has(status) && grant && !grant.revoked_at) return "revoke";
  return "none";
}

/** Order status derived from payment status (kept separate from VIP status). */
export function orderStatus(paymentStatus: string) {
  if (paymentStatus === "approved") return "paid";
  if (REVERSED.has(paymentStatus)) return paymentStatus === "cancelled" ? "cancelled" : "refunded";
  if (paymentStatus === "rejected") return "rejected";
  return "pending";
}

// ---- Mercado Pago webhook signature (x-signature: "ts=...,v1=...") ----
export function parseSignature(header: string | null) {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(",")) {
    const [k, v] = part.split("=").map((s) => s?.trim());
    if (k && v) out[k] = v;
  }
  return out["ts"] && out["v1"] ? { ts: out["ts"], v1: out["v1"] } : null;
}

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySignature(opts: { header: string | null; requestId: string | null; dataId: string | null; secret: string }) {
  const sig = parseSignature(opts.header);
  if (!sig || !opts.secret) return false;
  let manifest = "";
  if (opts.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${sig.ts};`;
  const expected = await hmacHex(opts.secret, manifest);
  if (expected.length !== sig.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.v1.charCodeAt(i);
  return diff === 0;
}

// ---- Sales metrics: only approved payments count as received revenue ----
export type PaymentRow = { status: string; amount_cents: number; net_cents: number | null; plan_id: string | null; approved_at: string | null; created_at: string };

export function salesSummary(rows: PaymentRow[]) {
  const counts: Record<string, number> = { approved: 0, pending: 0, rejected: 0, refunded: 0 };
  let gross = 0;
  let net = 0;
  let netKnown = true;
  const byPlan: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const k = r.status === "in_process" || r.status === "authorized" ? "pending" : r.status === "charged_back" ? "refunded" : r.status === "cancelled" ? "rejected" : r.status;
    counts[k] = (counts[k] ?? 0) + 1;
    if (r.status !== "approved") continue;
    gross += r.amount_cents;
    if (r.net_cents == null) netKnown = false;
    else net += r.net_cents;
    byPlan[r.plan_id ?? "?"] = (byPlan[r.plan_id ?? "?"] ?? 0) + r.amount_cents;
    const day = (r.approved_at ?? r.created_at).slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + r.amount_cents;
  }
  return { counts, gross, net: netKnown ? net : null, byPlan, byDay };
}

/** Owner-entered plan price check before enabling checkout. Returns an error message or null. */
export function validatePlanPrice(p: { price_cents: number | null; period_days: number; active: boolean }): string | null {
  if (p.price_cents !== null && (!Number.isInteger(p.price_cents) || p.price_cents < 100 || p.price_cents > 1_000_000))
    return "O preço deve ficar entre R$ 1,00 e R$ 10.000,00.";
  if (!Number.isInteger(p.period_days) || p.period_days < 1 || p.period_days > 3660) return "Período inválido.";
  if (p.active && !p.price_cents) return "Defina um preço antes de habilitar a cobrança.";
  return null;
}
