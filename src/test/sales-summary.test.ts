import { describe, it, expect } from "vitest";
import { salesSummary } from "@/lib/billing";
const r = (status: string, amount_cents: number, net_cents: number | null = amount_cents - 100) => ({ status, amount_cents, net_cents, plan_id: "m", approved_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" });
describe("salesSummary", () => {
  it("does not count pending payments as revenue", () => {
    const s = salesSummary([r("approved", 1990), r("pending", 5000), r("in_process", 5000)]);
    expect(s.gross).toBe(1990);
    expect(s.counts["pending"]).toBe(2);
  });
  it("net is not calculated when a fee is missing", () => {
    expect(salesSummary([r("approved", 1990, null)]).net).toBeNull();
  });
});
