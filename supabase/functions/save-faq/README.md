# Save-FAQ

Create or update FAQ entries with automatic embedding generation for AI search.

## API

**Endpoint:** `POST /functions/v1/save-faq`

**Request:**
```json
{
  "hotelId": "uuid",
  "faq": {
    "id": "uuid", // optional - for updates
    "title": "Check-in Times",
    "content": "Check-in starts at 3:00 PM, checkout at 11:00 AM"
  }
}
```

**Response:**
```json
{
  "faqId": "uuid",
  "title": "Check-in Times",
  "isNew": true,
  "saved": true,
  "embeddingUpdated": true
}
```

## What it does

1. **Creates/Updates** FAQ in `faq_info` table
2. **Generates embedding** using OpenAI for AI search
3. **Hotel scoped** - all operations filtered by `hotel_id`

## Deploy

```bash
supabase functions deploy save-faq
```

## Environment Variables

- `SUPABASE_URL` - Supabase project URL  
- `SERVICE_ROLE_KEY` - Supabase service role key
- `OPENAI_API_KEY` - OpenAI API key

Set with: `supabase secrets set KEY=value`