import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Page, Card } from "@/components/AppShell";
import { useAccess } from "@/lib/access";
import { ownerSales } from "@/lib/billing.functions";
import { PlansEditor } from "@/components/PlansEditor";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração — Gerenciador de Vida" },
      { name: "description", content: "Painel do proprietário com vendas e transações reais." },
      { property: "og:title", content: "Administração — Gerenciador de Vida" },
      { property: "og:description", content: "Vendas, receita e transações do proprietário." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS: Record<string, string> = {
  approved: "Aprovado", pending: "Pendente", in_process: "Em análise", authorized: "Autorizado",
  rejected: "Recusado", cancelled: "Cancelado", refunded: "Reembolsado", charged_back: "Estornado",
};

function AdminPage() {
  const { data: access, isLoading } = useAccess();
  if (isLoading) return <Page title="Administração"><p className="text-sm text-muted-foreground">Carregando…</p></Page>;
  if (!access?.isOwner)
    return (
      <Page title="Administração">
        <Card className="text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 font-semibold">Acesso restrito ao proprietário</p>
          <Link to="/" className="mt-3 inline-block text-sm text-primary underline">Voltar ao início</Link>
        </Card>
      </Page>
    );
  return <Sales plans={access.plans} />;
}

function Sales({ plans }: { plans: { id: string; name: string }[] }) {
  const [f, setF] = useState({ from: "", to: "", plan: "", status: "" });
  const fn = useServerFn(ownerSales);
  const { data, isLoading, error } = useQuery({
    queryKey: ["owner-sales", f],
    queryFn: () => fn({ data: { from: f.from || undefined, to: f.to || undefined, plan: f.plan || undefined, status: f.status || undefined } }),
  });
  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? id ?? "—";
  const input = "h-10 rounded-lg border bg-background px-2 text-sm";
  const days = data ? Object.entries(data.summary.byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-30) : [];
  const maxDay = Math.max(1, ...days.map(([, v]) => v));

  return (
    <Page title="Administração" subtitle="Vendas reais confirmadas pelo Mercado Pago">
      <PlansEditor />
      <Card className="mb-4 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">De<input type="date" className={`${input} w-full`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Até<input type="date" className={`${input} w-full`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <select className={input} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
          <option value="">Todos os planos</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando vendas…</p>}
      {error && <p className="text-sm text-destructive">Não foi possível carregar as vendas.</p>}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Stat label="Receita bruta recebida" value={brl(data.summary.gross)} />
            <Stat label="Receita líquida" value={data.summary.net == null ? "Não calculada" : brl(data.summary.net)} hint={data.summary.net == null ? "Tarifa não informada pelo Mercado Pago" : undefined} />
            <Stat label="Aprovados" value={String(data.summary.counts["approved"] ?? 0)} />
            <Stat label="Pendentes (fora da receita)" value={String(data.summary.counts["pending"] ?? 0)} />
            <Stat label="Recusados/cancelados" value={String(data.summary.counts["rejected"] ?? 0)} />
            <Stat label="Reembolsos/estornos" value={String(data.summary.counts["refunded"] ?? 0)} />
            <Stat label="Assinaturas ativas" value={String(data.subs.active)} />
            <Stat label="Vencidas / canceladas" value={`${data.subs.expired} / ${data.subs.cancelled}`} />
            <Stat label="Clientes pagantes" value={String(data.payingCustomers)} />
            <Stat label="VIP manual (sem venda)" value={String(data.manualVip)} />
            <Stat label="Renovaram" value={String(data.renewed)} />
          </div>

          <Card className="mb-4">
            <h2 className="mb-2 font-semibold">Receita por plano</h2>
            {Object.keys(data.summary.byPlan).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma venda aprovada.</p> :
              Object.entries(data.summary.byPlan).map(([p, v]) => (
                <div key={p} className="flex justify-between text-sm"><span>{planName(p)}</span><span className="font-semibold">{brl(v)}</span></div>
              ))}
          </Card>

          <Card className="mb-4">
            <h2 className="mb-2 font-semibold">Receita por dia</h2>
            {days.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados no período.</p> : (
              <div className="flex h-32 items-end gap-1">
                {days.map(([d, v]) => (
                  <div key={d} title={`${d}: ${brl(v)}`} className="flex-1 rounded-t bg-primary" style={{ height: `${(v / maxDay) * 100}%` }} />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Transações</h2>
            {data.transactions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma transação.</p> : (
              <ul className="divide-y text-sm">
                {data.transactions.map((t) => (
                  <li key={t.provider_payment_id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{planName(t.plan_id)}</p>
                      <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("pt-BR")} · #{t.provider_payment_id}</p>
                    </div>
                    <div className="text-right">
                      <p className={t.status === "approved" ? "font-semibold" : "text-muted-foreground line-through"}>{brl(t.amount_cents)}</p>
                      <p className="text-xs text-muted-foreground">{STATUS[t.status] ?? t.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}
