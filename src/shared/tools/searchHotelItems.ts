import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../utils/logger";
import { supabase } from "./supabaseClient";
import { getEmbedding } from "../../services/ai/getEmbedding";

// Type for item details matching your database schema
export interface ItemDetails {
  id: string;           // Database ID for staff note creation
  item: string;         // Display name for conversation
  description: string;
  category: string;
  department: string;   // Added department field for routing
  price: number;
  currency: string;
  is_paid: boolean;
  requires_quantity: boolean;
  requires_time: boolean;
  max_quantity: number;
  is_upsell: boolean;
}

// Enhanced output type - supports single match, multiple options, or not found
export interface FindItemOutput {
  singleMatch?: ItemDetails;       // Clear winner (>90% confidence)
  multipleOptions?: ItemDetails[]; // Multiple good matches (80-90% confidence)  
  itemNotFound?: boolean;          // No good matches (<80%)
  searchQuery?: string;            // What the guest actually said (for logging)
}

// Configuration for confidence thresholds
const CONFIDENCE_THRESHOLDS = {
  SINGLE_MATCH: 0.90,     // Above this = clear winner
  MULTIPLE_OPTIONS: 0.80, // Above this = show as option
  MIN_VIABLE: 0.70        // Below this = not found
};

// Main function to find hotel items using vector search
async function findHotelItem({ 
  hotelId, 
  guessedItemName
}: { 
  hotelId: string; 
  guessedItemName: string;
}): Promise<FindItemOutput> {
  try {
    // First, try exact text matching for perfect matches (fast path)
    const { data: exactMatches, error: exactError } = await supabase
      .from('items')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('is_active', true)
      .ilike('item', `%${guessedItemName}%`);

    if (exactError) {
      logger.error('FIND_ITEM', 'Error finding exact item matches', { error: exactError });
      throw exactError;
    }

    // If we have exact matches, return as single match
    if (exactMatches && exactMatches.length > 0) {
      const bestMatch = findBestExactMatch(exactMatches, guessedItemName);
      return {
        singleMatch: mapDatabaseItemToDetails(bestMatch),
        searchQuery: guessedItemName
      };
    }

    // No exact matches, use vector search for semantic matching
    return await vectorSearchItems(hotelId, guessedItemName);

  } catch (error) {
    logger.error('FIND_ITEM', 'Error in findHotelItem', { error });
    throw error;
  }
}

// Vector-based semantic search with smart confidence handling
async function vectorSearchItems(hotelId: string, guessedItemName: string): Promise<FindItemOutput> {
  try {
    // Get embedding for the guest's request
    const queryEmbedding = await getEmbedding(guessedItemName);
    
    // Semantic search using pgvector
    const { data: vectorMatches, error: vectorError } = await supabase.rpc(
      'search_items_by_similarity',
      {
        hotel_id: hotelId,
        query_embedding: queryEmbedding,
        similarity_threshold: CONFIDENCE_THRESHOLDS.MIN_VIABLE,
        match_limit: 5
      }
    );

    if (vectorError) {
      logger.error('VECTOR_SEARCH', 'Error in vector search', { error: vectorError });
      // Fallback to basic search if vector search fails
      return await fallbackTextSearch(hotelId, guessedItemName);
    }

    if (!vectorMatches || vectorMatches.length === 0) {
      return { 
        itemNotFound: true,
        searchQuery: guessedItemName 
      };
    }

    // Analyze confidence levels
    const highConfidence = vectorMatches.filter((m: any) => m.similarity >= CONFIDENCE_THRESHOLDS.SINGLE_MATCH);
    const mediumConfidence = vectorMatches.filter((m: any) => 
      m.similarity >= CONFIDENCE_THRESHOLDS.MULTIPLE_OPTIONS && 
      m.similarity < CONFIDENCE_THRESHOLDS.SINGLE_MATCH
    );

    // Single clear winner
    if (highConfidence.length === 1) {
      return {
        singleMatch: mapDatabaseItemToDetails(highConfidence[0]),
        searchQuery: guessedItemName
      };
    }

    // Multiple high confidence matches - treat as disambiguation
    if (highConfidence.length > 1) {
      return {
        multipleOptions: highConfidence.slice(0, 3).map(mapDatabaseItemToDetails),
        searchQuery: guessedItemName
      };
    }

    // Multiple medium confidence matches - show options
    if (mediumConfidence.length > 1) {
      return {
        multipleOptions: mediumConfidence.slice(0, 3).map(mapDatabaseItemToDetails),
        searchQuery: guessedItemName
      };
    }

    // Single medium confidence - return as single match but with lower confidence
    if (mediumConfidence.length === 1) {
      return {
        singleMatch: mapDatabaseItemToDetails(mediumConfidence[0]),
        searchQuery: guessedItemName
      };
    }

    // No good matches
    return { 
      itemNotFound: true,
      searchQuery: guessedItemName 
    };

  } catch (error) {
    logger.error('VECTOR_SEARCH', 'Error in vector search', { error });
    // Fallback to text search if vector search completely fails
    return await fallbackTextSearch(hotelId, guessedItemName);
  }
}

// Fallback to basic text search if vector search fails
async function fallbackTextSearch(hotelId: string, guessedItemName: string): Promise<FindItemOutput> {
  const { data: items, error } = await supabase
    .from('items')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('is_active', true);

  if (error || !items || items.length === 0) {
    return { 
      itemNotFound: true,
      searchQuery: guessedItemName 
    };
  }

  // Simple text matching as last resort
  const matches = items.filter(item => {
    const itemText = `${item.item} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
    return itemText.includes(guessedItemName.toLowerCase());
  });

  if (matches.length === 1) {
    return {
      singleMatch: mapDatabaseItemToDetails(matches[0]),
      searchQuery: guessedItemName
    };
  }

  if (matches.length > 1) {
    return {
      multipleOptions: matches.slice(0, 3).map(mapDatabaseItemToDetails),
      searchQuery: guessedItemName
    };
  }

  return { 
    itemNotFound: true,
    searchQuery: guessedItemName 
  };
}

// Find best match from exact text matches
function findBestExactMatch(matches: any[], guessedItemName: string): any {
  // Prefer exact word matches over partial matches
  const exactWordMatch = matches.find(item => 
    item.item.toLowerCase() === guessedItemName.toLowerCase()
  );
  
  if (exactWordMatch) return exactWordMatch;
  
  // Otherwise return first match
  return matches[0];
}

// Helper function to map database item to our interface
function mapDatabaseItemToDetails(item: any): ItemDetails {
  return {
    id: item.id,
    item: item.item,
    description: item.description || '',
    category: item.category || '',
    department: item.department || 'front_desk',
    price: item.price || 0,
    currency: item.currency || 'USD',
    is_paid: item.is_paid || false,
    requires_quantity: item.requires_quantity || false,
    requires_time: item.requires_time || false,
    max_quantity: item.max_quantity || 1,
    is_upsell: item.is_upsell || false,
  };
}

const searchHotelItemsSchema = z.object({
  itemName: z.string().describe("The name or description of the hotel item/service the guest is looking for"),
  hotelId: z.string().describe("The hotel ID to search within"),
});

export const searchHotelItemsTool = tool(
  async ({ itemName, hotelId }) => {
    logger.debug('TOOL_SEARCH_ITEMS', 'Searching for hotel items', { itemName, hotelId });
    
    try {
      const result = await findHotelItem({ 
        hotelId, 
        guessedItemName: itemName 
      });
      
      if (result.singleMatch) {
        return {
          type: 'single_match',
          item: result.singleMatch,
          message: `Found item: ${result.singleMatch.item} - ${result.singleMatch.description}. Price: ${result.singleMatch.price} ${result.singleMatch.currency}${result.singleMatch.is_paid ? ' (paid service)' : ' (complimentary)'}`
        };
      }
      
      if (result.multipleOptions) {
        return {
          type: 'multiple_options',
          items: result.multipleOptions,
          message: `Found multiple options for "${itemName}": ${result.multipleOptions.map(item => item.item).join(', ')}. Which one would you like more information about?`
        };
      }
      
      return {
        type: 'not_found',
        message: `I couldn't find "${itemName}" in our hotel services. Could you try describing it differently, or would you like me to help you with something else?`
      };
      
    } catch (error) {
      logger.error('TOOL_SEARCH_ITEMS', 'Error searching items', { error, itemName, hotelId });
      return {
        type: 'error',
        message: 'I encountered an error while searching for that item. Please try again.'
      };
    }
  },
  {
    name: "searchHotelItems",
    description: "Search for hotel items and services in the hotel's inventory. Use this when a guest asks about amenities, services, room service, or any hotel offerings.",
    schema: searchHotelItemsSchema,
  }
);