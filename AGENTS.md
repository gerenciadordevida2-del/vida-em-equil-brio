<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- App data is one versioned JSON blob per user in Supabase `app_data` (RLS own-row, saved via `save_app_data` RPC with optimistic revision) synced by src/lib/cloud-sync.ts into src/lib/store.ts; legacy localStorage data is uploaded once on first login and left untouched — keeps backups/restore format identical and isolates users.
- Auth is Supabase Google OAuth; all app pages live under src/routes/_authenticated (ssr:false), /auth is the only public page; /api/chat requires a bearer token so the AI key can't be used anonymously.
- Customers, products, stock moves and WhatsApp reminder logs live in `business` of the same blob; rules in src/lib/commerce.ts (product stock changes only through sale save/delete/cancel/return or product edits, each appending a StockMove; cancelled/returned sales keep history but leave all totals).
- AI assistant: server route /api/chat (src/lib/ai.server.ts) streams external Groq Chat Completions using the installed createOpenAI adapter's explicit .chat method, reading its API key from a project secret inside handleChat; tools have no server execute and the browser confirms each action before applying it via src/lib/ai-actions.ts — keeps the existing UI stream protocol, credentials server-only, data on-device, and every change user-approved.
- Home-only derived metrics and immutable habit toggling live in src/lib/home-metrics.ts; persist through the existing update function to keep backup data compatible.
- The /metas route reuses the finance goal view and storage; keep workouts available and settings accessible from the Home header to avoid duplicate modules.
- Validate backups atomically before replacing local data; currentAmount is the canonical accumulated goal balance, with no inferred contribution history or schema migration.
- Debt payments use the pure src/lib/debt-payment.ts operation inside update to validate against the same current state that receives the expense, preventing stale-balance inconsistencies.
- Server routes use createFileRoute with server.handlers (the installed TanStack Start has no @tanstack/react-start/api / createAPIFileRoute); the old API breaks the build.
- Business (Negócio) data lives in the optional `business` field of the same v1 store; pure calculations in src/lib/business.ts use integer cents and record cash only via dated payments — keeps old backups valid, personal finances separate, and avoids double counting.
- Legacy daily cone stock (sales without a product) stores only the day's initial quantity in `business.stock`; sold/remaining are derived from that day's sales (`soldOn`/`stockStatus`), never stored counters — edits and deletes of sales automatically correct the stock.
