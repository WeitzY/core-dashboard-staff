# Core Serverless AI Concierge (Backend)

👉 **[🌐 Staff Dashboard Live](https://staff-dashboard-beryl.vercel.app/login)**

Demo account: `resume@test.com` / `Resume123` *(read-only — editing disabled)*

👉 **[💬 Guest Chat Live](https://chat-dashboard-tau-seven.vercel.app/)**

👉 **[📂 Staff Dashboard Repo](https://github.com/WeitzY/staff-dashboard)**
👉 **[📂 Guest Chat Repo](https://github.com/WeitzY/chat-dashboard)**
👉 **[📂 Core Functions Repo](https://github.com/WeitzY/core-dashboard-staff)**

[![Watch the demo](https://img.youtube.com/vi/xu75WGMdmxU/maxresdefault.jpg)](https://www.youtube.com/watch?v=xu75WGMdmxU)

---

## About

**Backend for Velin**, a production-style AI concierge system:
Guest sends a message → AI answers from hotel Items/FAQs → optional staff note created.
*(No long conversation history for simplicity in demo scope.)*

---

## What this showcases

* **Edge Functions (Deno)**: `chat-handler`, `save-items`, `save-faq`
* **Data isolation**: Every DB operation scoped by `hotel_id` with RLS
* **LLM usage**: OpenAI for English summaries + embeddings; **pgvector** for similarity search
* **Minimal surface area**: Few small, readable handlers with shared helpers in `_shared`

---

## Live entry points

* **`chat-handler` (POST)** → validate → vector search (items + FAQs) → AI reply → write messages → optional staff note
* **`save-items` (POST)** → upsert item + embedding
* **`save-faq` (POST)** → upsert FAQ + embedding

**Example (chat):**

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

---

## Tech

* Supabase (Postgres, Edge Functions, Realtime, Auth)
* Deno runtime for functions
* OpenAI (responses + embeddings)
* pgvector (similarity search)
* TypeScript + Zod validation

---

## Notes & scope

* Stateless per message; no long chat memory
* Basic logging; no PII
* CORS open for demo (restrict in production)

---

## Where to look

```
supabase/functions/*/index.ts   → Handlers
supabase/functions/chat-handler → Chat pipeline
supabase/functions/_shared/*    → Shared helpers
```

---

## Important note

`src/` and root `package.json` reflect an **advanced, paused LangGraph version** of the system (WIP).
They are **not used in the live demo**. For recruiters/reviewers, focus on `supabase/functions/*`.
