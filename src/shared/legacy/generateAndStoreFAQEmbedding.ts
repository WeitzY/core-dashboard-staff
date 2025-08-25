import { supabase } from '../tools/supabaseClient';
import { getEmbedding } from '../../services/ai/getEmbedding';
import { logger } from '../utils/logger';
import { z } from 'zod';

// Enhanced type for FAQ input with validation
const FAQInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
  category: z.string().optional(),
  language: z.string().default('en'),
  hotelId: z.string().uuid()
});

export type FAQInput = z.infer<typeof FAQInputSchema>;

// Result type for embedding operations
export interface EmbeddingResult {
  success: boolean;
  faqId: string;
  tokenCount?: number;
  error?: string;
}

/**
 * Generate and store embedding for a hotel FAQ with enhanced error handling and validation
 * 
 * @param faqData - FAQ object with id, title, content, category, language, hotelId
 * @returns Updated FAQ with embedding, or throws on failure
 */
export async function generateAndStoreFAQEmbedding(faqData: FAQInput): Promise<EmbeddingResult> {
  const startTime = Date.now();
  
  try {
    // 1. Validate input data
    const validatedData = FAQInputSchema.parse(faqData);
    
    logger.debug('FAQ_EMBEDDING', 'Starting embedding generation', {
      faqId: validatedData.id,
      title: validatedData.title,
      hotelId: validatedData.hotelId,
      language: validatedData.language
    });
    
    // 2. Combine title and content into searchable text
    const textForEmbedding = generateFAQSearchText(validatedData);
    
    if (!textForEmbedding.trim()) {
      throw new Error('No content available for embedding generation');
    }
    
    // 3. Get embedding from OpenAI with retry logic
    logger.debug('FAQ_EMBEDDING', 'Generating OpenAI embedding', {
      faqId: validatedData.id,
      textLength: textForEmbedding.length
    });
    
    const embedding = await getEmbedding(textForEmbedding);
    
    if (!embedding || embedding.length === 0) {
      throw new Error('Failed to generate valid embedding from OpenAI');
    }
    
    // 4. Calculate token count for cost tracking
    const tokenCount = estimateTokenCount(textForEmbedding);
    
    // 5. Update FAQ in Supabase with the embedding (hotel-scoped with RLS)
    const { data: updatedFAQ, error } = await supabase
      .from('faq_info')
      .update({ 
        embedding,
        token_count: tokenCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', validatedData.id)
      .eq('hotel_id', validatedData.hotelId) // Ensure hotel-scoped operation
      .select()
      .single();

    if (error) {
      logger.error('FAQ_EMBEDDING', 'Failed to update FAQ with embedding', {
        faqId: validatedData.id,
        hotelId: validatedData.hotelId,
        error: error.message
      });
      throw new Error(`Failed to store embedding: ${error.message}`);
    }

    if (!updatedFAQ) {
      throw new Error(`FAQ ${validatedData.id} not found or not updated`);
    }

    const duration = Date.now() - startTime;
    
    logger.info('FAQ_EMBEDDING', 'Successfully generated and stored FAQ embedding', {
      faqId: validatedData.id,
      hotelId: validatedData.hotelId,
      title: validatedData.title,
      tokenCount,
      duration,
      embeddingSize: embedding.length
    });
    
    return {
      success: true,
      faqId: validatedData.id,
      tokenCount
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('FAQ_EMBEDDING', 'Error generating FAQ embedding', {
      faqId: faqData.id,
      hotelId: faqData.hotelId,
      error: errorMessage,
      duration
    });
    
    return {
      success: false,
      faqId: faqData.id,
      error: errorMessage
    };
  }
}

/**
 * Generate searchable text from FAQ fields
 * Format: "title content" (natural language optimized)
 */
function generateFAQSearchText(faqData: FAQInput): string {
  const parts = [
    faqData.title || '',
    faqData.content || ''
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
 * Enhanced batch version - generate embeddings for multiple FAQs
 * Features: rate limiting, progress tracking, error recovery, hotel-scoped processing
 */
export async function generateAndStoreMultipleFAQEmbeddings(
  faqs: FAQInput[], 
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
  results: EmbeddingResult[];
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
  
  logger.info('FAQ_BATCH_EMBEDDING', 'Starting batch FAQ embedding generation', {
    totalFAQs: faqs.length,
    batchSize,
    hotelId,
    delayBetweenBatches
  });
  
  // Validate all FAQs have the same hotel ID
  const invalidFAQs = faqs.filter(faq => faq.hotelId !== hotelId);
  if (invalidFAQs.length > 0) {
    throw new Error(`Found FAQs with mismatched hotel IDs: ${invalidFAQs.map(f => f.id).join(', ')}`);
  }
  
  const results: EmbeddingResult[] = [];
  let totalTokens = 0;

  for (let i = 0; i < faqs.length; i += batchSize) {
    const batch = faqs.slice(i, i + batchSize);
    const batchNumber = Math.ceil((i + 1) / batchSize);
    const totalBatches = Math.ceil(faqs.length / batchSize);
    
    logger.debug('FAQ_BATCH_EMBEDDING', 'Processing batch', {
      batchNumber,
      totalBatches,
      batchSize: batch.length,
      hotelId
    });
    
    // Process batch with retries
    const batchResults = await Promise.all(
      batch.map(async (faq) => {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await generateAndStoreFAQEmbedding(faq);
            if (result.success && result.tokenCount) {
              totalTokens += result.tokenCount;
            }
            return result;
          } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
              logger.warn('FAQ_BATCH_EMBEDDING', 'Retrying FAQ embedding generation', {
                faqId: faq.id,
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
          faqId: faq.id,
          error: lastError instanceof Error ? lastError.message : 'Unknown error after retries'
        };
      })
    );

    results.push(...batchResults);
    
    const batchSuccessful = batchResults.filter(r => r.success).length;
    const batchFailed = batchResults.filter(r => !r.success).length;
    
    logger.info('FAQ_BATCH_EMBEDDING', 'Completed batch', {
      batchNumber,
      totalBatches,
      successful: batchSuccessful,
      failed: batchFailed,
      totalProcessed: i + batch.length,
      totalFAQs: faqs.length
    });
    
    // Rate limiting - delay between batches (except last batch)
    if (i + batchSize < faqs.length) {
      logger.debug('FAQ_BATCH_EMBEDDING', 'Waiting between batches', { delayMs: delayBetweenBatches });
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const duration = Date.now() - startTime;
  
  logger.info('FAQ_BATCH_EMBEDDING', 'Batch FAQ embedding completed', {
    total: faqs.length,
    successful,
    failed,
    totalTokens,
    duration,
    hotelId,
    averageTokensPerFAQ: successful > 0 ? Math.round(totalTokens / successful) : 0
  });
  
  return {
    total: faqs.length,
    successful,
    failed,
    results,
    totalTokens,
    duration
  };
} 