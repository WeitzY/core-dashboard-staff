# Chat-Handler Edge Function

Enhanced API for intelligent guest messaging with vector search capabilities. Validates messages, searches hotel-specific data using embeddings, generates contextual responses, and determines if requests can be handled based on available hotel services.

## API

### Endpoint
```
POST /functions/v1/chat-handler
```

### Headers
- `Content-Type: application/json`

### Request Body

Required:
- `message` (string, 5–2000)
- `hotelId` (string, UUID)
- `lastName` (string)
- `roomNumber` (string)

Optional:
- `language` (string)
- `sessionCode` (string)
- `guestId` (string, UUID)

Example:
```json
{
  "message": "The air conditioning in my room is not working properly",
  "hotelId": "550e8400-e29b-41d4-a716-446655440000",
  "lastName": "Smith",
  "roomNumber": "204"
}
```

### Success (200)
```json
{
  "success": true,
  "guestResponse": "We're sending maintenance to room 204 right away to fix your air conditioning. Thank you for letting us know!",
  "staffSummary": "Guest in room 204 reports air conditioning malfunction requiring maintenance attention.",
  "department": "maintenance",
  "canHandle": true,
  "guestId": "<uuid>",
  "message": "Message processed and staff notified"
}
```

### When Request Cannot Be Handled (200)
```json
{
  "success": true,
  "guestResponse": "I apologize, but I'm unable to assist with that specific request. Please contact our front desk for further assistance.",
  "staffSummary": "Guest request could not be handled by available hotel services",
  "department": "front_desk", 
  "canHandle": false,
  "guestId": "<uuid>",
  "message": "Message processed - guest referred to front desk"
}
```

### Errors
- 400: validation issues
- 500: internal errors

## What it does
- **Input Validation**: Validates shape & length with security checks (SQL injection prevention, UUID validation)
- **Vector Search**: Searches hotel-specific items and FAQs using semantic embeddings (similarity threshold: 0.7)
- **Enhanced AI Processing**: Uses OpenAI function calling with hotel-specific context to determine if requests can be handled
- **Smart Responses**: AI responds based on available hotel data; politely declines unavailable services
- **Multi-language Support**: Responds in guest's language, provides staff summaries in English
- **Database Operations**: Creates guest records, saves chat messages, and conditionally generates staff notes
- **Data Isolation**: All operations scoped by `hotel_id` with RLS policies

## Key Features
- **OpenAI Function Calling**: Structured output with gpt-4o-mini (temperature: 0.2, max_tokens: 400)
- **Vector Similarity Search**: Matches guest requests to hotel services using embeddings
- **Capability Detection**: `canHandle` flag indicates if hotel can fulfill the request
- **Contextual Responses**: Uses hotel data to determine if requests can be handled
- **Hotel-Specific**: Only searches and confirms services available at the specific hotel

## Environment variables
- `SUPABASE_URL`: Supabase project URL
- `SERVICE_ROLE_KEY`: Supabase service role key (not SUPABASE_SERVICE_ROLE_KEY)
- `OPENAI_API_KEY`: OpenAI API key for embeddings and function calling

Set via Supabase secrets. Do not commit to git.

## Required Database Functions
Ensure these vector search functions are deployed (see migration file):
- `search_items_by_similarity(query_embedding, hotel_id, similarity_threshold, match_limit)`
- `search_faqs_by_similarity(query_embedding, hotel_id, similarity_threshold, match_limit)`

## Local dev
```powershell
supabase functions serve chat-handler
```

## Deploy
```powershell
# With JWT authentication (recommended for production)
supabase functions deploy chat-handler

# Without JWT verification (for webhooks/public endpoints)
supabase functions deploy chat-handler --no-verify-jwt
```

## Frontend example
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, anonKey)

const { data, error } = await supabase.functions.invoke('chat-handler', {
  body: {
    message: 'I need fresh towels',
    hotelId: 'hotel-uuid',
    lastName: 'Johnson',
    roomNumber: '305'
  }
})
```

## CORS Troubleshooting

If you encounter "Cross-origin request blocked" errors:

**✅ Already Fixed:**
- OPTIONS preflight requests handled
- Proper CORS headers on all responses
- 24-hour preflight cache for performance

**Frontend Requirements:**
```javascript
// Ensure your fetch includes these headers
fetch('https://your-project.supabase.co/functions/v1/chat-handler', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_JWT_TOKEN' // if using JWT
  },
  body: JSON.stringify({...})
})
```

**Development:**
- Use `http://localhost:3000` or `https://localhost:3000` consistently
- Don't mix HTTP/HTTPS protocols

**Production:**
- Always use HTTPS for your frontend domain
- Ensure proper Supabase project URL configuration

## Notes
- **Enhanced AI Logic**: Uses OpenAI function calling with structured output for guaranteed JSON responses
- **Vector Search Performance**: Searches 5 items + 3 FAQs with 0.7 similarity threshold for optimal relevance
- **Security**: JWT authentication by default, all operations hotel-scoped, no PII logging
- **Embedding Model**: Uses text-embedding-3-small for cost-effective vector search
- **Conditional Staff Notes**: Creates staff notes only when `canHandle` is true
- **Multi-language**: Guest responses in their language, staff summaries always in English
- **Future-Ready**: Advanced LangGraph system in `src/core/chat` available for complex workflows
