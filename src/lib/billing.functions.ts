import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { salesSummary, trialWindow, vipUntil, isGrantActive, validatePlanPrice } from "./billing";
import { admin, audit, getAccessFor, mpFetch, ownerId, APP_URL_FALLBACK } from "./billing.server";

export const getMyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await getAccessFor(context.userId);
    const until = a.isOwner ? null : vipUntil(a.grants);
    const db = await admin();
    const { data: plans } = await db.from("plans").select("id, name, price_cents, currency, period_days, active").order("sort");
    return {
      isOwner: a.isOwner,
      isAdmin: a.isAdmin,
      isVip: a.isOwner || until !== undefined,
      vipUntil: until ?? null,
      trialUsed: a.grants.some((g) => g.source === "trial"),
      checkoutReady: !!process.env["MERCADOPAGO_ACCESS_TOKEN"],
      plans: plans ?? [],
    };
  });

export const startTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await getAccessFor(context.userId);
    if (a.isOwner) return { ok: false, message: "Sua conta já tem VIP permanente." };
    if (a.grants.some((g) => g.source === "trial")) return { ok: false, message: "O teste grátis já foi usado nesta conta." };
    const db = await admin();
    const { error } = await db.from("vip_grants").insert({ user_id: context.userId, source: "trial", ...trialWindow(), reason: "Teste grátis de 7 dias" });
    if (error) return { ok: false, message: "O teste grátis já foi usado nesta conta." };
    return { ok: true, message: "Teste grátis ativado por 7 dias." };
  });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    if (ownerId() === context.userId) return { ok: false as const, message: "A conta do proprietário é isenta de cobrança." };
    const db = await admin();
    // Price comes only from the server-side plans table.
    const { data: plan } = await db.from("plans").select("*").eq("id", data.planId).maybeSingle();
    if (!plan || !plan.active || !plan.price_cents) return { ok: false as const, message: "Este plano ainda não está disponível para compra." };
    const ref = `vida-${crypto.randomUUID()}`;
    const { data: order, error } = await db
      .from("orders")
      .insert({ user_id: context.userId, plan_id: plan.id, external_reference: ref, amount_cents: plan.price_cents, currency: plan.currency, status: "created" })
      .select("id")
      .single();
    if (error || !order) return { ok: false as const, message: "Não foi possível registrar o pedido." };
    const origin = getRequest().headers.get("origin");
    const base = origin && /^https:\/\//.test(origin) ? origin : process.env["APP_URL"] || APP_URL_FALLBACK;
    const hookBase = process.env["APP_URL"] || APP_URL_FALLBACK;
    try {
      const pref = (await mpFetch("/checkout/preferences", {
        method: "POST",
        body: JSON.stringify({
          items: [{ id: plan.id, title: `Vida em Equilíbrio — ${plan.name}`, quantity: 1, unit_price: plan.price_cents / 100, currency_id: plan.currency }],
          external_reference: ref,
          metadata: { user_id: context.userId, plan_id: plan.id, order_id: order.id },
          back_urls: { success: `${base}/pagamento?r=sucesso`, pending: `${base}/pagamento?r=pendente`, failure: `${base}/pagamento?r=falha` },
          auto_return: "approved",
          notification_url: `${hookBase}/api/public/mercadopago/webhook`,
        }),
      })) as { id: string; init_point: string };
      await db.from("orders").update({ preference_id: pref.id, status: "pending", updated_at: new Date().toISOString() }).eq("id", order.id);
      return { ok: true as const, url: pref.init_point };
    } catch {
      await db.from("orders").update({ status: "error" }).eq("id", order.id);
      return { ok: false as const, message: "Não foi possível abrir o pagamento agora. Tente novamente." };
    }
  });

// ---------------- Admin ----------------
async function requireAdmin(userId: string) {
  const a = await getAccessFor(userId);
  if (!a.isAdmin) throw new Error("Acesso negado");
  return a;
}

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(100).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const db = await admin();
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    const [{ data: profiles }, { data: roles }, { data: grants }] = await Promise.all([
      db.from("profiles").select("id, display_name"),
      db.from("user_roles").select("user_id, role"),
      db.from("vip_grants").select("id, user_id, source, starts_at, ends_at, revoked_at, reason"),
    ]);
    const owner = ownerId();
    const q = data.q.trim().toLowerCase();
    return (list?.users ?? [])
      .map((u) => {
        const g = (grants ?? []).filter((x) => x.user_id === u.id);
        const until = vipUntil(g);
        return {
          id: u.id,
          email: u.email ?? "",
          name: profiles?.find((p) => p.id === u.id)?.display_name ?? "",
          isOwner: u.id === owner,
          isAdmin: u.id === owner || !!roles?.some((r) => r.user_id === u.id && r.role === "admin"),
          isVip: u.id === owner || until !== undefined,
          vipUntil: u.id === owner ? null : (until ?? null),
          activeGrants: g.filter((x) => isGrantActive(x)).map((x) => ({ id: x.id, source: x.source, ends_at: x.ends_at })),
        };
      })
      .filter((u) => !q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  });

export const adminGrantVip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), reason: z.string().trim().min(3).max(300), startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const me = await requireAdmin(context.userId);
    if (data.userId === ownerId()) throw new Error("A conta do proprietário não pode ser alterada.");
    if (data.userId === context.userId && !me.isOwner) throw new Error("Você não pode alterar o próprio VIP.");
    if (data.endsAt === null && !me.isOwner) throw new Error("Só o proprietário pode conceder VIP permanente.");
    if (data.endsAt && Date.parse(data.endsAt) <= Date.parse(data.startsAt)) throw new Error("A expiração deve ser depois do início.");
    const db = await admin();
    const { data: g, error } = await db
      .from("vip_grants")
      .insert({ user_id: data.userId, source: "manual", starts_at: data.startsAt, ends_at: data.endsAt, reason: data.reason, granted_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error("Falha ao conceder VIP");
    await audit(context.userId, "vip_granted", data.userId, { grant: g.id, reason: data.reason, startsAt: data.startsAt, endsAt: data.endsAt });
    return { ok: true };
  });

export const adminRevokeVip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const me = await requireAdmin(context.userId);
    if (data.userId === ownerId()) throw new Error("A conta do proprietário não pode ser alterada.");
    if (data.userId === context.userId && !me.isOwner) throw new Error("Você não pode alterar o próprio VIP.");
    const db = await admin();
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("vip_grants")
      .update({ revoked_at: now, revoked_by: context.userId, revoke_reason: data.reason })
      .eq("user_id", data.userId)
      .is("revoked_at", null)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .select("id");
    await audit(context.userId, "vip_revoked", data.userId, { reason: data.reason, grants: (rows ?? []).map((r) => r.id) });
    return { ok: true, count: rows?.length ?? 0 };
  });

export const ownerSetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (ownerId() !== context.userId) throw new Error("Só o proprietário pode alterar administradores.");
    if (data.userId === context.userId) throw new Error("A conta do proprietário não pode ser alterada.");
    const db = await admin();
    if (data.admin) await db.from("user_roles").upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
    else await db.from("user_roles").delete().eq("user_id", data.userId).eq("role", "admin");
    await audit(context.userId, data.admin ? "admin_added" : "admin_removed", data.userId, {});
    return { ok: true };
  });

export const adminHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const db = await admin();
    const { data } = await db.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(300);
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    const email = (id: string | null) => (id ? (list?.users.find((u) => u.id === id)?.email ?? id.slice(0, 8)) : "Sistema");
    return (data ?? []).map((r) => ({ id: r.id, action: r.action, at: r.created_at, actor: email(r.actor_id), target: email(r.target_user_id), details: JSON.stringify(r.details ?? {}) }));
  });

export const ownerSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional(), plan: z.string().max(40).optional(), status: z.string().max(20).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (ownerId() !== context.userId) throw new Error("Acesso negado");
    const db = await admin();
    let q = db.from("payments").select("provider_payment_id, status, amount_cents, fee_cents, net_cents, plan_id, approved_at, created_at, user_id").order("created_at", { ascending: false }).limit(1000);
    if (data.from) q = q.gte("created_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("created_at", `${data.to}T23:59:59Z`);
    if (data.plan) q = q.eq("plan_id", data.plan);
    if (data.status) q = q.eq("status", data.status);
    const [{ data: pays }, { data: grants }] = await Promise.all([q, db.from("vip_grants").select("user_id, source, starts_at, ends_at, revoked_at")]);
    const g = grants ?? [];
    const paid = g.filter((x) => x.source === "payment");
    const users = (pred: (x: (typeof g)[number]) => boolean) => new Set(g.filter(pred).map((x) => x.user_id)).size;
    const payingUsers = new Set(paid.map((x) => x.user_id));
    const renewed = [...payingUsers].filter((u) => paid.filter((x) => x.user_id === u).length > 1).length;
    return {
      summary: salesSummary(pays ?? []),
      subs: {
        active: users((x) => x.source === "payment" && isGrantActive(x)),
        cancelled: users((x) => x.source === "payment" && !!x.revoked_at),
        expired: users((x) => x.source === "payment" && !x.revoked_at && !!x.ends_at && Date.parse(x.ends_at) <= Date.now()),
      },
      payingCustomers: payingUsers.size,
      manualVip: users((x) => x.source === "manual" && isGrantActive(x)),
      renewed,
      transactions: (pays ?? []).slice(0, 200),
    };
  });

export const ownerListPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (ownerId() !== context.userId) throw new Error("Acesso negado");
    const db = await admin();
    const { data } = await db.from("plans").select("id, name, price_cents, currency, period_days, active").order("sort");
    return data ?? [];
  });

export const ownerUpdatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().max(40), price_cents: z.number().int().nullable(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (ownerId() !== context.userId) throw new Error("Acesso negado");
    const db = await admin();
    const { data: plan } = await db.from("plans").select("id, price_cents, period_days, active").eq("id", data.id).maybeSingle();
    if (!plan) throw new Error("Plano não encontrado.");
    if (!plan.period_days) throw new Error("O plano gratuito não tem preço.");
    const err = validatePlanPrice({ price_cents: data.price_cents, period_days: plan.period_days, active: data.active });
    if (err) throw new Error(err);
    const { error } = await db.from("plans").update({ price_cents: data.price_cents, active: data.active }).eq("id", data.id);
    if (error) throw new Error("Falha ao salvar o plano.");
    await audit(context.userId, "plan_updated", null, { plan: data.id, before: { price_cents: plan.price_cents, active: plan.active }, after: { price_cents: data.price_cents, active: data.active } });
    return { ok: true };
  });
