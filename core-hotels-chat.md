# Core hotels chat context

This repository is optimized for a simple, stateless chat backend running as Supabase Edge Functions. Use this file as system context for tooling.

## Ground truth
- The only live paths are in `supabase/functions/*`.
- Chat is stateless. Each request is independent: guest message → vector search (items + FAQs) → AI reply → optional staff note when actionable.
- All DB reads/writes are scoped by `hotel_id` under RLS.

## Runtime & env
- Deno (Supabase Edge Functions)
- Postgres + pgvector
- OpenAI for short English answers and embeddings
- Required env: `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `OPENAI_API_KEY`

## Key entry points
- `supabase/functions/chat-handler/index.ts`: HTTP handler
- `supabase/functions/chat-handler/chatProcessor.ts`: orchestrates validation → AI → DB writes
- `supabase/functions/chat-handler/aiResponse.ts`: similarity search + response shaping
- `supabase/functions/chat-handler/databaseOps.ts`: hotel‑scoped DB ops
- `supabase/functions/save-items/*`, `supabase/functions/save-faq/*`: upserts + embeddings
- Shared: `supabase/functions/_shared/*` (supabase client, cors, validation)

## Rules for new work
1. Use only the Edge Functions path for any new API surface.
2. Always pass and filter by `hotel_id` on every query/update. Never bypass RLS.
3. Use `_shared/supabaseClient.ts` (service role) from functions; do not inline clients.
4. Validate all request bodies with Zod (`_shared/validation.ts`).
5. Keep responses short, English. No conversation memory.
6. Logging must avoid PII; use structured messages if needed.

## Out‑of‑scope (kept for reference)
- `src/core/*`, `src/services/*`, `src/shared/*`: legacy LangGraph and utilities retained for future expansion. Do not wire them into live flows without explicit instruction.

## Testing & local
- Use Supabase CLI for local testing (`supabase functions serve`).
- Vector search RPCs: `search_items_by_similarity`, `search_faqs_by_similarity` accept `(query_embedding, hotel_id, similarity_threshold, match_limit)`.
