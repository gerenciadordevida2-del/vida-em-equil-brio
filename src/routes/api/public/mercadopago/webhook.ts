import { createFileRoute } from "@tanstack/react-router";
import { verifySignature } from "@/lib/billing";

export const Route = createFileRoute("/api/public/mercadopago/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } };
        const dataId = url.searchParams.get("data.id") ?? (body.data?.id != null ? String(body.data.id) : null);
        const topic = url.searchParams.get("type") ?? body.type ?? body.topic ?? null;
        const requestId = request.headers.get("x-request-id");
        const valid = await verifySignature({
          header: request.headers.get("x-signature"),
          requestId,
          dataId,
          secret: process.env["MERCADOPAGO_WEBHOOK_SECRET"] ?? "",
        });
        const { admin, processPayment } = await import("@/lib/billing.server");
        const db = await admin();
        const log = (result: string) =>
          db.from("payment_events").insert({ request_id: requestId, topic, resource_id: dataId, signature_valid: valid, result });
        if (!valid) {
          await log("invalid_signature");
          return new Response("invalid signature", { status: 401 });
        }
        if (topic !== "payment" || !dataId || !/^\d{1,30}$/.test(dataId)) {
          await log("ignored");
          return new Response("ignored");
        }
        try {
          const result = await processPayment(dataId);
          await log(result);
          return new Response("ok");
        } catch (e) {
          await log(`error: ${(e as Error).message}`.slice(0, 200));
          return new Response("retry", { status: 500 }); // Mercado Pago retries later
        }
      },
    },
  },
});
