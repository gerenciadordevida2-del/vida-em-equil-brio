import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import type { ReactNode } from "react";
import { getMyAccess } from "./billing.functions";

export function useAccess() {
  const fn = useServerFn(getMyAccess);
  return useQuery({ queryKey: ["access"], queryFn: () => fn(), staleTime: 60_000 });
}

/** Shows children only for VIP; free users keep their data and see an upgrade card instead of the advanced feature. */
export function VipGate({ children, feature }: { children: ReactNode; feature: string }) {
  const { data, isLoading } = useAccess();
  if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>;
  if (data?.isVip) return <>{children}</>;
  return <UpgradeCard feature={feature} />;
}

export function UpgradeCard({ feature }: { feature: string }) {
  return (
    <div className="mx-auto my-6 max-w-md rounded-2xl border border-primary/30 bg-card p-6 text-center shadow-sm">
      <Crown className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 font-display text-lg font-semibold">{feature} é um recurso VIP</h2>
      <p className="mt-2 text-sm text-muted-foreground">Seus dados continuam guardados. Ative o VIP ou o teste grátis de 7 dias para usar este recurso.</p>
      <Link to="/planos" className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Ver planos
      </Link>
    </div>
  );
}
