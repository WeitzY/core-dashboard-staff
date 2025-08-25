# Hotel Setup Scripts

This directory contains one-time setup scripts for hotel onboarding and system initialization.

## Scripts

### Embedding Population (`populateEmbeddings.ts`)

Scripts to generate and store vector embeddings for FAQ and item searches.

#### Usage

```typescript
import { runSetup } from '../setup';

// Basic setup for a hotel
await runSetup('hotel-uuid-here');

// Advanced setup with custom options
await runSetup('hotel-uuid-here', {
  batchSize: 3,           // Smaller batches for rate limiting
  delayBetweenBatches: 3000, // 3 second delay between batches
  maxRetries: 5,          // More retries for reliability
  dryRun: true           // Test run without making changes
});
```

#### Individual Functions

```typescript
import { 
  populateAllEmbeddings,
  populateFAQEmbeddings,
  populateItemEmbeddings,
  validateHotelExists
} from '../setup';

// Validate hotel exists before setup
const exists = await validateHotelExists('hotel-uuid');

// Populate only FAQs
const faqResults = await populateFAQEmbeddings({
  hotelId: 'hotel-uuid',
  batchSize: 5
});

// Populate only items
const itemResults = await populateItemEmbeddings({
  hotelId: 'hotel-uuid',
  batchSize: 5
});

// Populate everything
const results = await populateAllEmbeddings({
  hotelId: 'hotel-uuid',
  batchSize: 5,
  dryRun: false
});
```

#### Configuration Options

- `hotelId` (required): UUID of the hotel to set up
- `batchSize` (default: 5): Number of items to process in parallel
- `delayBetweenBatches` (default: 2000ms): Delay between batches for rate limiting
- `maxRetries` (default: 3): Number of retry attempts for failed embeddings
- `dryRun` (default: false): Run without making actual changes

#### When to Use

- **New hotel onboarding**: Run once when a hotel is first added to the system
- **Embedding rebuild**: When embeddings need to be regenerated (model changes, data corruption, etc.)
- **Missing embeddings**: When some FAQs or items don't have embeddings

#### Prerequisites

1. Hotel must exist in the `hotels` table
2. FAQs must exist in the `faq_info` table with `is_active = true`
3. Items must exist in the `items` table with `is_active = true`
4. OpenAI API key must be configured
5. Supabase must have the vector search RPC functions set up

#### Cost Considerations

- Embedding generation uses OpenAI API tokens
- Approximate cost: $0.0001 per 1K tokens (text-embedding-3-small)
- Average FAQ: 50-200 tokens
- Average item: 10-50 tokens
- 100 FAQs + 200 items ≈ $0.02-0.05

#### Monitoring

All operations are logged with structured data:

```typescript
// Check logs for progress
logger.info('SETUP_EMBEDDINGS', 'Operation completed', {
  hotelId: 'hotel-uuid',
  faqs: { total: 50, successful: 48, failed: 2 },
  items: { total: 120, successful: 120, failed: 0 },
  totalTokens: 15420,
  duration: 45000
});
```

## Future Scripts

This directory will expand to include:

- `setupPayments.ts` - Stripe payment configuration
- `hotelInitialization.ts` - Complete hotel database setup
- `defaultData.ts` - Populate default items, FAQs, and configurations
- `migration.ts` - Data migration utilities

## Best Practices

1. **Always validate** hotel exists before running setup
2. **Use dry run** first to estimate scope and cost
3. **Monitor logs** for progress and errors
4. **Start with small batch sizes** for new hotels (reduce rate limiting issues)
5. **Run during off-peak hours** to minimize impact on live system
6. **Keep backups** before running major setup operations