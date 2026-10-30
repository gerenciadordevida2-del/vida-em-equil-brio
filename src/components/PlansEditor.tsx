import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/AppShell";
import { ownerListPlans, ownerUpdatePlan } from "@/lib/billing.functions";
import { validatePlanPrice } from "@/lib/billing";

type Plan = { id: string; name: string; price_cents: number | null; currency: string; period_days: number | null; active: boolean };

export function PlansEditor() {
  const list = useServerFn(ownerListPlans);
  const { data } = useQuery({ queryKey: ["owner-plans"], queryFn: () => list() });
  const paid = (data ?? []).filter((p) => p.period_days);
  return (
    <Card className="mb-4 space-y-3">
      <h2 className="font-semibold">Preços dos planos</h2>
      <p className="text-xs text-muted-foreground">A cobrança só é aberta para planos com preço válido e marcados como habilitados.</p>
      {paid.map((p) => <PlanRow key={p.id} plan={p} />)}
    </Card>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const save = useServerFn(ownerUpdatePlan);
  const [price, setPrice] = useState(plan.price_cents ? (plan.price_cents / 100).toFixed(2).replace(".", ",") : "");
  const [active, setActive] = useState(plan.active);
  const [busy, setBusy] = useState(false);
  const parsed = price.trim() === "" ? null : Math.round(Number(price.replace(/\./g, "").replace(",", ".")) * 100);
  const cents = parsed !== null && Number.isFinite(parsed) ? parsed : NaN;
  const error = Number.isNaN(cents) ? "Valor inválido." : validatePlanPrice({ price_cents: cents as number | null, period_days: plan.period_days ?? 0, active });
  async function submit() {
    if (error) return;
    const label = cents ? (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "sem preço";
    if (!confirm(`Salvar ${plan.name}: ${label}, cobrança ${active ? "HABILITADA" : "desabilitada"}?`)) return;
    setBusy(true);
    try {
      await save({ data: { id: plan.id, price_cents: cents as number | null, active } });
      toast.success("Plano atualizado.");
      qc.invalidateQueries({ queryKey: ["owner-plans"] });
      qc.invalidateQueries({ queryKey: ["access"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{plan.name} <span className="text-xs text-muted-foreground">({plan.period_days} dias)</span></p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Habilitado
        </label>
      </div>
      <div className="flex gap-2">
        <input inputMode="decimal" placeholder="Preço em R$ (ex.: 19,90)" value={price} onChange={(e) => setPrice(e.target.value)} className="h-10 flex-1 rounded-lg border bg-background px-2 text-sm" />
        <button disabled={!!error || busy} onClick={submit} className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Salvar</button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
