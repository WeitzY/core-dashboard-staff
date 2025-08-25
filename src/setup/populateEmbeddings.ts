import { supabase } from '../shared/tools/supabaseClient';
import { 
  generateAndStoreMultipleFAQEmbeddings, 
  type FAQInput 
} from '../db/supabase/generateAndStoreFAQEmbedding';
import { 
  generateAndStoreMultipleItemEmbeddings, 
  type ItemInput 
} from '../shared/legacy/generateAndStoreItemEmbedding';
import { logger } from '../shared/utils/logger';
import { z } from 'zod';

// Configuration schema for embedding population
const PopulateConfigSchema = z.object({
  hotelId: z.string().uuid(),
  batchSize: z.number().min(1).max(20).default(5),
  delayBetweenBatches: z.number().min(1000).default(2000),
  maxRetries: z.number().min(1).max(10).default(3),
  dryRun: z.boolean().default(false)
});

export type PopulateConfig = z.infer<typeof PopulateConfigSchema>;

/**
 * Comprehensive setup function to populate embeddings for all FAQs and items in a hotel
 * This is a one-time setup function for new hotels or when rebuilding embeddings
 */
export async function populateAllEmbeddings(config: PopulateConfig) {
  const validatedConfig = PopulateConfigSchema.parse(config);
  const startTime = Date.now();
  
  logger.info('SETUP_EMBEDDINGS', 'Starting comprehensive embedding population', {
    hotelId: validatedConfig.hotelId,
    batchSize: validatedConfig.batchSize,
    dryRun: validatedConfig.dryRun
  });

  try {
    // Step 1: Populate FAQ embeddings
    const faqResults = await populateFAQEmbeddings(validatedConfig);
    
    // Step 2: Populate item embeddings
    const itemResults = await populateItemEmbeddings(validatedConfig);
    
    const totalDuration = Date.now() - startTime;
    const summary = {
      hotelId: validatedConfig.hotelId,
      dryRun: validatedConfig.dryRun,
      faqs: {
        total: faqResults.total,
        successful: faqResults.successful,
        failed: faqResults.failed,
        tokens: faqResults.totalTokens
      },
      items: {
        total: itemResults.total,
        successful: itemResults.successful,
        failed: itemResults.failed,
        tokens: itemResults.totalTokens
      },
      totalDuration,
      totalTokens: faqResults.totalTokens + itemResults.totalTokens
    };

    logger.info('SETUP_EMBEDDINGS', 'Comprehensive embedding population completed', summary);
    
    return summary;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('SETUP_EMBEDDINGS', 'Failed to populate embeddings', {
      hotelId: validatedConfig.hotelId,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    throw error;
  }
}

/**
 * Populate embeddings for existing FAQs without embeddings
 * Enhanced version with better error handling and progress tracking
 */
export async function populateFAQEmbeddings(config: PopulateConfig) {
  const validatedConfig = PopulateConfigSchema.parse(config);
  const startTime = Date.now();
  
  logger.info('SETUP_FAQ_EMBEDDINGS', 'Starting FAQ embedding population', {
    hotelId: validatedConfig.hotelId,
    dryRun: validatedConfig.dryRun
  });
  
  try {
    // Get all active FAQs without embeddings for this hotel
    const { data: faqs, error } = await supabase
      .from('faq_info')
      .select('id, title, content, category, language, hotel_id')
      .eq('hotel_id', validatedConfig.hotelId)
      .eq('is_active', true)
      .is('embedding', null);

    if (error) {
      logger.error('SETUP_FAQ_EMBEDDINGS', 'Error fetching FAQs', { 
        hotelId: validatedConfig.hotelId, 
        error: error.message 
      });
      throw error;
    }

    if (!faqs || faqs.length === 0) {
      logger.info('SETUP_FAQ_EMBEDDINGS', 'No FAQs found without embeddings', {
        hotelId: validatedConfig.hotelId
      });
      return { 
        total: 0, 
        successful: 0, 
        failed: 0, 
        results: [], 
        totalTokens: 0, 
        duration: Date.now() - startTime 
      };
    }

    logger.info('SETUP_FAQ_EMBEDDINGS', 'Found FAQs to process', { 
      count: faqs.length,
      hotelId: validatedConfig.hotelId
    });

    if (validatedConfig.dryRun) {
      logger.info('SETUP_FAQ_EMBEDDINGS', 'Dry run - would process FAQs', {
        faqIds: faqs.map(f => f.id),
        hotelId: validatedConfig.hotelId
      });
      return { 
        total: faqs.length, 
        successful: 0, 
        failed: 0, 
        results: [], 
        totalTokens: 0, 
        duration: Date.now() - startTime 
      };
    }

    // Convert to FAQInput format with hotel ID
    const faqInputs: FAQInput[] = faqs.map(faq => ({
      id: faq.id,
      title: faq.title,
      content: faq.content,
      category: faq.category,
      language: faq.language || 'en',
      hotelId: faq.hotel_id
    }));

    // Use the enhanced batch embedding function
    const result = await generateAndStoreMultipleFAQEmbeddings(faqInputs, {
      batchSize: validatedConfig.batchSize,
      delayBetweenBatches: validatedConfig.delayBetweenBatches,
      maxRetries: validatedConfig.maxRetries,
      hotelId: validatedConfig.hotelId
    });
    
    logger.info('SETUP_FAQ_EMBEDDINGS', 'FAQ embedding population completed', {
      hotelId: validatedConfig.hotelId,
      ...result
    });
    
    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('SETUP_FAQ_EMBEDDINGS', 'Error in FAQ embedding population', {
      hotelId: validatedConfig.hotelId,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    throw error;
  }
}

/**
 * Populate embeddings for existing items without embeddings
 * Enhanced version with better error handling and progress tracking
 */
export async function populateItemEmbeddings(config: PopulateConfig) {
  const validatedConfig = PopulateConfigSchema.parse(config);
  const startTime = Date.now();
  
  logger.info('SETUP_ITEM_EMBEDDINGS', 'Starting item embedding population', {
    hotelId: validatedConfig.hotelId,
    dryRun: validatedConfig.dryRun
  });
  
  try {
    // Get all active items without embeddings for this hotel
    const { data: items, error } = await supabase
      .from('items')
      .select('id, item, description, tags, hotel_id')
      .eq('hotel_id', validatedConfig.hotelId)
      .eq('is_active', true)
      .is('embedding', null);

    if (error) {
      logger.error('SETUP_ITEM_EMBEDDINGS', 'Error fetching items', { 
        hotelId: validatedConfig.hotelId, 
        error: error.message 
      });
      throw error;
    }

    if (!items || items.length === 0) {
      logger.info('SETUP_ITEM_EMBEDDINGS', 'No items found without embeddings', {
        hotelId: validatedConfig.hotelId
      });
      return { 
        total: 0, 
        successful: 0, 
        failed: 0, 
        results: [], 
        totalTokens: 0, 
        duration: Date.now() - startTime 
      };
    }

    logger.info('SETUP_ITEM_EMBEDDINGS', 'Found items to process', { 
      count: items.length,
      hotelId: validatedConfig.hotelId
    });

    if (validatedConfig.dryRun) {
      logger.info('SETUP_ITEM_EMBEDDINGS', 'Dry run - would process items', {
        itemIds: items.map(i => i.id),
        hotelId: validatedConfig.hotelId
      });
      return { 
        total: items.length, 
        successful: 0, 
        failed: 0, 
        results: [], 
        totalTokens: 0, 
        duration: Date.now() - startTime 
      };
    }

    // Convert to ItemInput format with hotel ID
    const itemInputs: ItemInput[] = items.map(item => ({
      id: item.id,
      item: item.item,
      description: item.description,
      tags: item.tags,
      hotelId: item.hotel_id
    }));

    // Use the enhanced batch embedding function
    const result = await generateAndStoreMultipleItemEmbeddings(itemInputs, {
      batchSize: validatedConfig.batchSize,
      delayBetweenBatches: validatedConfig.delayBetweenBatches,
      maxRetries: validatedConfig.maxRetries,
      hotelId: validatedConfig.hotelId
    });
    
    logger.info('SETUP_ITEM_EMBEDDINGS', 'Item embedding population completed', {
      hotelId: validatedConfig.hotelId,
      ...result
    });
    
    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('SETUP_ITEM_EMBEDDINGS', 'Error in item embedding population', {
      hotelId: validatedConfig.hotelId,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    throw error;
  }
}

/**
 * Helper function to validate hotel exists before running setup
 */
export async function validateHotelExists(hotelId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('hotels')
      .select('id, name')
      .eq('id', hotelId)
      .single();

    if (error) {
      logger.error('SETUP_VALIDATION', 'Error validating hotel', { 
        hotelId, 
        error: error.message 
      });
      return false;
    }

    logger.info('SETUP_VALIDATION', 'Hotel validated', { 
      hotelId, 
      hotelName: data?.name 
    });
    
    return !!data;
  } catch (error) {
    logger.error('SETUP_VALIDATION', 'Failed to validate hotel', { 
      hotelId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return false;
  }
}

/**
 * CLI-friendly function for running setup from command line
 */
export async function runSetup(hotelId: string, options: Partial<PopulateConfig> = {}) {
  const config: PopulateConfig = {
    hotelId,
    batchSize: options.batchSize || 5,
    delayBetweenBatches: options.delayBetweenBatches || 2000,
    maxRetries: options.maxRetries || 3,
    dryRun: options.dryRun || false
  };

  logger.info('SETUP_CLI', 'Starting hotel setup', config);

  // Validate hotel exists
  const hotelExists = await validateHotelExists(hotelId);
  if (!hotelExists) {
    throw new Error(`Hotel with ID ${hotelId} not found`);
  }

  // Run the setup
  return await populateAllEmbeddings(config);
}