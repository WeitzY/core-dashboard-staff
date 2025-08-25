# Save-Items

Create or update hotel service items with automatic embedding generation for AI search.

## API

**Endpoint:** `POST /functions/v1/save-items`

**Request:**
```json
{
  "hotelId": "uuid",
  "item": {
    "id": "uuid", // optional - for updates
    "item": "Extra Towels",
    "description": "Fresh bathroom towels delivered to room", // optional
    "department": "housekeeping"
  }
}
```

**Response:**
```json
{
  "itemId": "uuid",
  "itemName": "Extra Towels",
  "isNew": true,
  "saved": true,
  "embeddingUpdated": true
}
```

## What it does

1. **Creates/Updates** item in `items` table
2. **Generates embedding** using OpenAI for AI search
3. **Hotel scoped** - all operations filtered by `hotel_id`

## Common Departments

- `housekeeping` - Cleaning, towels, amenities
- `room_service` - Food, beverages, in-room dining
- `maintenance` - Repairs, technical issues
- `transport` - Shuttle, parking, transfers
- `front_desk` - Check-in help, information
- `concierge` - Tours, reservations, recommendations

## Deploy

```bash
supabase functions deploy save-items
```

## Environment Variables

- `SUPABASE_URL` - Supabase project URL  
- `SERVICE_ROLE_KEY` - Supabase service role key
- `OPENAI_API_KEY` - OpenAI API key

Set with: `supabase secrets set KEY=value`