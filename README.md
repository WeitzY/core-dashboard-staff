# Velin Core — Serverless AI Concierge (Backend)

Short, production‑style backend built for portfolio review. It powers a simple, stateless chat flow: a guest sends a message, the AI answers from hotel Items/FAQs, and optionally creates a staff note when the AI can help. No long conversation history.

## What matters for reviewers
- **Edge Functions (Deno)**: `supabase/functions/chat-handler`, `save-items`, `save-faq`.
- **Data isolation**: Every DB op is scoped by `hotel_id` with RLS.
- **LLM usage**: OpenAI for short English summaries + embeddings; pgvector for similarity search.
- **Minimal surface area**: A few small, readable handlers with shared helpers in `supabase/functions/_shared`.

## Live entry points
- `chat-handler` (POST): validate → vector search (items + faqs) → AI reply → write messages → optional staff note.
- `save-items` (POST): upsert item + embedding.
- `save-faq` (POST): upsert FAQ + embedding.

Example (chat):
```bash
curl -X POST "$SUPABASE_EDGE_URL/chat-handler" \
  -H "Content-Type: application/json" \
  -d '{
    "message":"Can I get two extra pillows?",
    "hotelId":"<uuid>",
    "lastName":"Levi",
    "roomNumber":"204"
  }'
```

## Run locally
Prereqs: Supabase CLI, OpenAI key.

```powershell
# Windows PowerShell
supabase start
$env:OPENAI_API_KEY="sk-..."
supabase functions serve --env-file supabase/.env
```

## Deploy
```powershell
supabase functions deploy chat-handler
supabase functions deploy save-items
supabase functions deploy save-faq
```

## Tech
- Supabase (Postgres, Edge Functions, Realtime, Auth)
- Deno runtime for functions
- OpenAI (responses + embeddings)
- pgvector for similarity search
- TypeScript + Zod validation

## Intentional simplifications
- Stateless per message; no long chat memory
- Basic logging; no PII; CORS is open for demo (restrict in prod)

## Where to look in code
- Handlers: `supabase/functions/*/index.ts`
- Chat pipeline: `supabase/functions/chat-handler/*`
- Shared helpers: `supabase/functions/_shared/*`
- Schema notes: `tables-definitions.md`

## Environment
- `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `OPENAI_API_KEY`

## Notes about src/ and root package.json
- `src/` and the root `package.json` reflect a more advanced, paused LangGraph version of the system (work‑in‑progress) and are not used by the live demo. For recruiters/reviewers, you can safely ignore `src/` and focus on the Supabase Edge Functions under `supabase/functions/*`.


