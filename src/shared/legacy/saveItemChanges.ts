import { supabase } from '../tools/supabaseClient';
import { generateAndStoreMultipleItemEmbeddings, ItemInput } from './generateAndStoreItemEmbedding';
import { logger } from '../utils/logger';

export interface SaveItemChangesResult {
  totalItems: number;
  newItems: number;
  updatedItems: number;
  embeddingErrors: number;
  results: Array<{
    itemId: string;
    itemName: string;
    isNew: boolean;
    saved: boolean;
    embeddingUpdated: boolean;
    error?: string;
  }>;
}

// Unified item input - ID is optional (new items don't have ID)
export interface ItemChangeInput {
  id?: string; // If provided = update existing, if not = create new
  item: string;
  description?: string;
  category: string;
  tags?: string[];
  is_paid?: boolean;
  price?: number;
  currency?: string;
  is_upsell?: boolean;
  requires_quantity?: boolean;
  requires_time?: boolean;
  requires_special_requests?: boolean;
  max_quantity?: number;
  hotel_id: string;
}

/**
 * UNIFIED SAVE CHANGES FUNCTION
 * Handles both creating new items and updating existing ones
 * - New items (no ID): Creates in English
 * - Existing items (has ID): Updates + regenerates embeddings  
 * - Perfect for one "Save Changes" button in frontend
 */
export async function saveItemChanges(
  hotelId: string,
  itemChanges: ItemChangeInput[]
): Promise<SaveItemChangesResult> {
  logger.info('ITEM_CHANGES', `Processing ${itemChanges.length} item changes`, { hotelId });
  
  const results: SaveItemChangesResult['results'] = [];
  let newItems = 0;
  let updatedItems = 0;
  let embeddingErrors = 0;

  try {
    const allCreatedOrUpdatedItems: ItemInput[] = [];

    // Process each item change
    for (const itemChange of itemChanges) {
      const isNewItem = !itemChange.id;

      try {
        if (isNewItem) {
          // === CREATE NEW ITEM ===
          logger.debug('ITEM_CREATE', `Creating new item: ${itemChange.item}`);

          const { data: newItem, error: insertError } = await supabase
            .from('items')
            .insert({
              item: itemChange.item,
              description: itemChange.description,
              category: itemChange.category,
              tags: itemChange.tags,
              is_paid: itemChange.is_paid || false,
              price: itemChange.price,
              currency: itemChange.currency,
              is_upsell: itemChange.is_upsell || false,
              requires_quantity: itemChange.requires_quantity || false,
              requires_time: itemChange.requires_time || false,
              requires_special_requests: itemChange.requires_special_requests || false,
              max_quantity: itemChange.max_quantity || 1,
              hotel_id: hotelId,
              is_active: true
            })
            .select()
            .single();

          if (insertError || !newItem) {
            throw new Error(`Failed to create item: ${insertError?.message}`);
          }

          // Add to embedding queue
          allCreatedOrUpdatedItems.push({
            id: newItem.id,
            item: newItem.item,
            description: newItem.description,
            tags: newItem.tags,
            hotelId: hotelId
          });

          newItems++;

          results.push({
            itemId: newItem.id,
            itemName: itemChange.item,
            isNew: true,
            saved: true,
            embeddingUpdated: false, // Will be updated in batch
            error: undefined
          });

        } else {
          // === UPDATE EXISTING ITEM ===
          logger.debug('ITEM_UPDATE', `Updating existing item: ${itemChange.id}`);

          const { data: updatedItem, error: updateError } = await supabase
            .from('items')
            .update({
              item: itemChange.item,
              description: itemChange.description,
              category: itemChange.category,
              tags: itemChange.tags,
              is_paid: itemChange.is_paid,
              price: itemChange.price,
              currency: itemChange.currency,
              is_upsell: itemChange.is_upsell,
              requires_quantity: itemChange.requires_quantity,
              requires_time: itemChange.requires_time,
              requires_special_requests: itemChange.requires_special_requests,
              max_quantity: itemChange.max_quantity
            })
            .eq('id', itemChange.id)
            .select()
            .single();

          if (updateError || !updatedItem) {
            throw new Error(`Failed to update item: ${updateError?.message}`);
          }

          // Add to embedding queue
          allCreatedOrUpdatedItems.push({
            id: updatedItem.id,
            item: updatedItem.item,
            description: updatedItem.description,
            tags: updatedItem.tags,
            hotelId: hotelId
          });

          updatedItems++;

          results.push({
            itemId: itemChange.id!,
            itemName: itemChange.item,
            isNew: false,
            saved: true,
            embeddingUpdated: false, // Will be updated in batch
            error: undefined
          });
        }

      } catch (error) {
        logger.error('ITEM_PROCESSING', `Error processing item: ${itemChange.item}`, { error });
        results.push({
          itemId: itemChange.id || 'unknown',
          itemName: itemChange.item,
          isNew: isNewItem,
          saved: false,
          embeddingUpdated: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Generate all embeddings in batch
    if (allCreatedOrUpdatedItems.length > 0) {
      logger.info('ITEM_EMBEDDINGS', `Generating embeddings for ${allCreatedOrUpdatedItems.length} items`);
      
      const embeddingResult = await generateAndStoreMultipleItemEmbeddings(allCreatedOrUpdatedItems, {
        batchSize: 5,
        hotelId: hotelId
      });
      
      // Update results with embedding status
      results.forEach(result => {
        const embeddingRes = embeddingResult.results.find((r: any) => r.itemId === result.itemId);
        result.embeddingUpdated = embeddingRes?.success || false;
        
        if (!result.embeddingUpdated) {
          embeddingErrors++;
          result.error = result.error || 'Failed to generate embedding';
        }
      });
    }

    logger.info('ITEM_COMPLETION', `Item processing completed: ${newItems} new, ${updatedItems} updated, ${embeddingErrors} embedding errors`);

    return {
      totalItems: itemChanges.length,
      newItems,
      updatedItems,
      embeddingErrors,
      results
    };

  } catch (error) {
    logger.error('ITEM_CHANGES', 'Error in saveItemChanges', { error, hotelId });
    
    return {
      totalItems: itemChanges.length,
      newItems,
      updatedItems,
      embeddingErrors: itemChanges.length,
      results: itemChanges.map(item => ({
        itemId: item.id || 'unknown',
        itemName: item.item,
        isNew: !item.id,
        saved: false,
        embeddingUpdated: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    };
  }
}

/**
 * Lighter version for when you just need to update embeddings
 * (if item data is already saved to database)
 */
export async function updateEmbeddingsOnly(
  hotelId: string, 
  itemIds: string[]
): Promise<SaveItemChangesResult> {
  // Get the items from database first
  const { data: items, error } = await supabase
    .from('items')
    .select('id, item, description, tags, category, language')
    .eq('hotel_id', hotelId)
    .in('id', itemIds);

  if (error || !items) {
    throw new Error(`Failed to fetch items: ${error?.message}`);
  }

  // Convert to ItemChangeInput format (all existing items)
  const itemChanges: ItemChangeInput[] = items.map(item => ({
    id: item.id,
    item: item.item,
    description: item.description,
    category: item.category,
    tags: item.tags,
    language: item.language,
    hotel_id: hotelId
  }));

  return await saveItemChanges(hotelId, itemChanges);
}

/**
 * Get items that need embedding updates
 * (items that exist but have null embeddings)
 */
export async function getItemsNeedingEmbeddings(hotelId: string): Promise<string[]> {
  const { data: items, error } = await supabase
    .from('items')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('is_active', true)
    .is('embedding', null);

  if (error) {
    console.error('Error fetching items needing embeddings:', error);
    return [];
  }

  return items?.map(item => item.id) || [];
} 