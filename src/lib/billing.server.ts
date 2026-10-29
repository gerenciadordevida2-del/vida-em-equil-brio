// Server-only helpers for Mercado Pago and privileged billing writes.
import { decideAction, orderStatus, paidWindow, validatePayment, type MpPayment, type Order } from "./billing";

export const APP_URL_FALLBACK = "https://vida-venda-compass.lovable.app";

export const ownerId = () => process.env["OWNER_USER_ID"]?.trim() || null;

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getAccessFor(userId: string) {
  const db = await admin();
  const isOwner = ownerId() === userId;
  const [{ data: roles }, { data: grants }] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", userId),
    db.from("vip_grants").select("id, source, starts_at, ends_at, revoked_at").eq("user_id", userId),
  ]);
  return { isOwner, isAdmin: isOwner || (roles ?? []).some((r) => r.role === "admin"), grants: grants ?? [] };
}

export async function audit(actor: string | null, action: string, target: string | null, details: Record<string, unknown>) {
  const db = await admin();
  await db.from("admin_audit_log").insert({ actor_id: actor, action, target_user_id: target, details: details as never });
}

export async function mpFetch(path: string, init: RequestInit = {}) {
  const token = process.env["MERCADOPAGO_ACCESS_TOKEN"];
  if (!token) throw new Error("Pagamentos ainda não configurados.");
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    console.error("Mercado Pago", path, res.status, await res.text().catch(() => ""));
    throw new Error(`Mercado Pago respondeu ${res.status}`);
  }
  return res.json();
}

type MpFull = MpPayment & {
  date_approved?: string | null;
  fee_details?: { amount: number }[];
  transaction_details?: { net_received_amount?: number };
};

/** Fetches the payment from the official API and applies it idempotently. Returns a short result code. */
export async function processPayment(paymentId: string): Promise<string> {
  const db = await admin();
  const p = (await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`)) as MpFull;
  if (!p.external_reference) return "no_reference";
  const { data: order } = await db.from("orders").select("*").eq("external_reference", p.external_reference).maybeSingle();
  if (!order) return "order_not_found";
  const mismatch = validatePayment(p, order as Order);
  if (mismatch) {
    await audit(null, "payment_mismatch", order.user_id, { payment: String(p.id), mismatch });
    return mismatch;
  }

  const fee = p.fee_details?.length ? Math.round(p.fee_details.reduce((s, f) => s + f.amount, 0) * 100) : null;
  const netRaw = p.transaction_details?.net_received_amount;
  const net = typeof netRaw === "number" && netRaw > 0 ? Math.round(netRaw * 100) : null;
  const { data: existing } = await db.from("payments").select("id, status, history").eq("provider_payment_id", String(p.id)).maybeSingle();
  const history = Array.isArray(existing?.history) ? existing.history : [];
  if (!existing || existing.status !== p.status) history.push({ status: p.status, detail: p.status_detail ?? null, at: new Date().toISOString() });

  const { data: pay, error } = await db
    .from("payments")
    .upsert(
      {
        provider_payment_id: String(p.id),
        order_id: order.id,
        user_id: order.user_id,
        plan_id: order.plan_id,
        status: p.status,
        status_detail: p.status_detail ?? null,
        amount_cents: order.amount_cents,
        fee_cents: fee,
        net_cents: net,
        currency: p.currency_id,
        approved_at: p.date_approved ?? null,
        history: history as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_payment_id" },
    )
    .select("id")
    .single();
  if (error || !pay) throw new Error("Falha ao registrar pagamento");
  await db.from("orders").update({ status: orderStatus(p.status), updated_at: new Date().toISOString() }).eq("id", order.id);

  const { data: grant } = await db.from("vip_grants").select("id, revoked_at").eq("payment_id", pay.id).maybeSingle();
  const action = decideAction(p.status, grant);
  if (action === "grant") {
    const { data: plan } = await db.from("plans").select("period_days").eq("id", order.plan_id).single();
    const { data: grants } = await db.from("vip_grants").select("source, starts_at, ends_at, revoked_at").eq("user_id", order.user_id);
    const w = paidWindow(grants ?? [], plan?.period_days ?? 30);
    // payment_id is UNIQUE: a concurrent duplicate notification cannot create a second period.
    const { error: gErr } = await db.from("vip_grants").insert({ user_id: order.user_id, source: "payment", payment_id: pay.id, ...w, reason: `Pagamento ${p.id}` });
    if (gErr && gErr.code !== "23505") throw new Error("Falha ao liberar VIP");
    return gErr ? "duplicate" : "granted";
  }
  if (action === "revoke") {
    await db.from("vip_grants").update({ revoked_at: new Date().toISOString(), revoke_reason: `Pagamento ${p.status}` }).eq("id", grant!.id);
    await audit(null, "vip_revoked_by_payment", order.user_id, { payment: String(p.id), status: p.status });
    return "revoked";
  }
  return `recorded_${p.status}`;
}
