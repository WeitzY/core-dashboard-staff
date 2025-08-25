import { supabase } from '../tools/supabaseClient';
import { getEmbedding } from '../../services/ai/getEmbedding';
import { logger } from '../utils/logger';
import { z } from 'zod';

// Enhanced type for item input with validation
const ItemInputSchema = z.object({
  id: z.string().uuid(),
  item: z.string().min(1, 'Item name is required'),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hotelId: z.string().uuid()
});

export type ItemInput = z.infer<typeof ItemInputSchema>;

// Result type for embedding operations
export interface ItemEmbeddingResult {
  success: boolean;
  itemId: string;
  tokenCount?: number;
  error?: string;
}

/**
 * Generate and store embedding for a hotel item with enhanced error handling and validation
 * 
 * @param itemData - Item object with id, item, description, tags, hotelId
 * @returns Result object with success status and details
 */
export async function generateAndStoreItemEmbedding(itemData: ItemInput): Promise<ItemEmbeddingResult> {
  const startTime = Date.now();
  
  try {
    // 1. Validate input data
    const validatedData = ItemInputSchema.parse(itemData);
    
    logger.debug('ITEM_EMBEDDING', 'Starting embedding generation', {
      itemId: validatedData.id,
      itemName: validatedData.item,
      hotelId: validatedData.hotelId,
      hasDescription: !!validatedData.description,
      tagCount: validatedData.tags?.length || 0
    });
    
    // 2. Combine fields into searchable text
    const textForEmbedding = generateItemSearchText(validatedData);
    
    if (!textForEmbedding.trim()) {
      throw new Error('No content available for embedding generation');
    }
    
    // 3. Get embedding from OpenAI
    logger.debug('ITEM_EMBEDDING', 'Generating OpenAI embedding', {
      itemId: validatedData.id,
      textLength: textForEmbedding.length
    });
    
    const embedding = await getEmbedding(textForEmbedding);
    
    if (!embedding || embedding.length === 0) {
      throw new Error('Failed to generate valid embedding from OpenAI');
    }
    
    // 4. Calculate token count for cost tracking
    const tokenCount = estimateTokenCount(textForEmbedding);
    
    // 5. Update item in Supabase with the embedding (hotel-scoped with RLS)
    const { data: updatedItem, error } = await supabase
      .from('items')
      .update({ 
        embedding,
        updated_at: new Date().toISOString()
      })
      .eq('id', validatedData.id)
      .eq('hotel_id', validatedData.hotelId) // Ensure hotel-scoped operation
      .select()
      .single();

    if (error) {
      logger.error('ITEM_EMBEDDING', 'Failed to update item with embedding', {
        itemId: validatedData.id,
        hotelId: validatedData.hotelId,
        error: error.message
      });
      throw new Error(`Failed to store embedding: ${error.message}`);
    }

    if (!updatedItem) {
      throw new Error(`Item ${validatedData.id} not found or not updated`);
    }

    const duration = Date.now() - startTime;
    
    logger.info('ITEM_EMBEDDING', 'Successfully generated and stored item embedding', {
      itemId: validatedData.id,
      hotelId: validatedData.hotelId,
      itemName: validatedData.item,
      tokenCount,
      duration,
      embeddingSize: embedding.length
    });
    
    return {
      success: true,
      itemId: validatedData.id,
      tokenCount
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('ITEM_EMBEDDING', 'Error generating item embedding', {
      itemId: itemData.id,
      hotelId: itemData.hotelId,
      error: errorMessage,
      duration
    });
    
    return {
      success: false,
      itemId: itemData.id,
      error: errorMessage
    };
  }
}

/**
 * Generate searchable text from item fields
 * Format: "item description tag1 tag2 tag3"
 */
function generateItemSearchText(itemData: ItemInput): string {
  const parts = [
    itemData.item || '',
    itemData.description || '',
    Array.isArray(itemData.tags) ? itemData.tags.join(' ') : ''
  ];
  
  return parts
    .filter(part => part.trim()) // Remove empty parts
    .join(' ')
    .trim();
}

/**
 * Estimate token count for cost tracking
 * More accurate approximation based on OpenAI's tokenization
 */
function estimateTokenCount(text: string): number {
  // More accurate estimation: average 0.75 tokens per word, 4.5 chars per token
  const words = text.split(/\s+/).filter(word => word.length > 0);
  return Math.ceil(words.length * 0.75);
}

/**
 * Enhanced batch version - generate embeddings for multiple items
 * Features: rate limiting, progress tracking, error recovery, hotel-scoped processing
 */
export async function generateAndStoreMultipleItemEmbeddings(
  items: ItemInput[], 
  options: {
    batchSize?: number;
    delayBetweenBatches?: number;
    maxRetries?: number;
    hotelId: string;
  }
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: ItemEmbeddingResult[];
  totalTokens: number;
  duration: number;
}> {
  const { 
    batchSize = 5, // Reduced for better rate limiting
    delayBetweenBatches = 2000, // 2 second delay
    maxRetries = 3,
    hotelId 
  } = options;
  
  const startTime = Date.now();
  
  logger.info('ITEM_BATCH_EMBEDDING', 'Starting batch item embedding generation', {
    totalItems: items.length,
    batchSize,
    hotelId,
    delayBetweenBatches
  });
  
  // Validate all items have the same hotel ID
  const invalidItems = items.filter(item => item.hotelId !== hotelId);
  if (invalidItems.length > 0) {
    throw new Error(`Found items with mismatched hotel IDs: ${invalidItems.map(i => i.id).join(', ')}`);
  }
  
  const results: ItemEmbeddingResult[] = [];
  let totalTokens = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNumber = Math.ceil((i + 1) / batchSize);
    const totalBatches = Math.ceil(items.length / batchSize);
    
    logger.debug('ITEM_BATCH_EMBEDDING', 'Processing batch', {
      batchNumber,
      totalBatches,
      batchSize: batch.length,
      hotelId
    });
    
    // Process batch with retries
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await generateAndStoreItemEmbedding(item);
            if (result.success && result.tokenCount) {
              totalTokens += result.tokenCount;
            }
            return result;
          } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
              logger.warn('ITEM_BATCH_EMBEDDING', 'Retrying item embedding generation', {
                itemId: item.id,
                attempt,
                maxRetries,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
              
              // Exponential backoff
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
          }
        }
        
        return {
          success: false,
          itemId: item.id,
          error: lastError instanceof Error ? lastError.message : 'Unknown error after retries'
        };
      })
    );

    results.push(...batchResults);
    
    const batchSuccessful = batchResults.filter(r => r.success).length;
    const batchFailed = batchResults.filter(r => !r.success).length;
    
    logger.info('ITEM_BATCH_EMBEDDING', 'Completed batch', {
      batchNumber,
      totalBatches,
      successful: batchSuccessful,
      failed: batchFailed,
      totalProcessed: i + batch.length,
      totalItems: items.length
    });
    
    // Rate limiting - delay between batches (except last batch)
    if (i + batchSize < items.length) {
      logger.debug('ITEM_BATCH_EMBEDDING', 'Waiting between batches', { delayMs: delayBetweenBatches });
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const duration = Date.now() - startTime;
  
  logger.info('ITEM_BATCH_EMBEDDING', 'Batch item embedding completed', {
    total: items.length,
    successful,
    failed,
    totalTokens,
    duration,
    hotelId,
    averageTokensPerItem: successful > 0 ? Math.round(totalTokens / successful) : 0
  });
  
  return {
    total: items.length,
    successful,
    failed,
    results,
    totalTokens,
    duration
  };
} 