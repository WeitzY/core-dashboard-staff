import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../utils/logger";
import { supabase } from "./supabaseClient";
import { getEmbedding } from "../../services/ai/getEmbedding";

// Type for FAQ search results
export interface FAQSearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  similarity: number;
  language: string;
}

// Output type for FAQ search
export interface FAQSearchOutput {
  results: FAQSearchResult[];
  totalFound: number;
  searchQuery: string;
}

/**
 * Search FAQs using semantic vector similarity
 */
async function searchFAQs({
  hotelId,
  query,
  language = 'en',
  limit = 3,
  similarityThreshold = 0.7
}: {
  hotelId: string;
  query: string;
  language?: string;
  limit?: number;
  similarityThreshold?: number;
}): Promise<FAQSearchOutput> {
  try {
    logger.debug('SEARCH_FAQS', 'Searching FAQs', { query, hotelId, language });

    // Step 1: Get embedding for the search query
    const queryEmbedding = await getEmbedding(query);

    // Step 2: Search using pgvector similarity
    const { data: results, error } = await supabase.rpc(
      'search_faqs_by_similarity',
      {
        hotel_id: hotelId,
        query_embedding: queryEmbedding,
        search_language: language,
        match_limit: limit,
        similarity_threshold: similarityThreshold
      }
    );

    if (error) {
      logger.error('SEARCH_FAQS', 'Error in FAQ vector search', { error });
      throw error;
    }

    if (!results || results.length === 0) {
      logger.debug('SEARCH_FAQS', 'No FAQ matches found');
      return {
        results: [],
        totalFound: 0,
        searchQuery: query
      };
    }

    logger.debug('SEARCH_FAQS', 'Found FAQ matches', { count: results.length });

    // Step 3: Format results
    const formattedResults: FAQSearchResult[] = results.map((result: any) => ({
      id: result.id,
      title: result.title || 'Untitled',
      content: result.content,
      category: result.category || 'general',
      similarity: result.similarity,
      language: result.language
    }));

    return {
      results: formattedResults,
      totalFound: results.length,
      searchQuery: query
    };

  } catch (error) {
    logger.error('SEARCH_FAQS', 'Error in searchFAQs', { error });
    throw error;
  }
}

/**
 * Get the best FAQ match for a query
 * Returns the single most relevant FAQ or null if none found
 */
export async function getBestFAQMatch({
  hotelId,
  query,
  language = 'en',
  minSimilarity = 0.75
}: {
  hotelId: string;
  query: string;
  language?: string;
  minSimilarity?: number;
}): Promise<FAQSearchResult | null> {
  
  const searchResult = await searchFAQs({
    hotelId,
    query,
    language,
    limit: 1,
    similarityThreshold: minSimilarity
  });

  return searchResult.results.length > 0 ? searchResult.results[0] || null : null;
}

const searchFAQSchema = z.object({
  query: z.string().describe("The guest's question or topic to search for in the FAQ database"),
  hotelId: z.string().describe("The hotel ID to search within"),
  language: z.string().optional().describe("The language to search in (default: 'en')"),
});

export const searchFAQTool = tool(
  async ({ query, hotelId, language = 'en' }) => {
    logger.debug('TOOL_SEARCH_FAQ', 'Searching FAQ', { query, hotelId, language });
    
    try {
      const result = await searchFAQs({
        hotelId,
        query,
        language,
        limit: 3,
        similarityThreshold: 0.7
      });
      
      if (result.results.length === 0) {
        return {
          type: 'not_found',
          message: `I couldn't find specific information about "${query}" in our FAQ. Let me help you in another way or you can contact the front desk for more details.`
        };
      }
      
      // Return the best match
      const bestMatch = result.results[0];
      
      if (bestMatch) {
        return {
          type: 'found',
          faq: bestMatch,
          message: `Here's what I found about "${query}": ${bestMatch.content}`,
          additionalMatches: result.results.slice(1)
        };
      } else {
        return {
          type: 'not_found',
          message: `I couldn't find specific information about "${query}" in our FAQ. Let me help you in another way or you can contact the front desk for more details.`
        };
      }
      
    } catch (error) {
      logger.error('TOOL_SEARCH_FAQ', 'Error searching FAQ', { error, query, hotelId });
      return {
        type: 'error',
        message: 'I encountered an error while searching for that information. Please try asking differently or contact the front desk.'
      };
    }
  },
  {
    name: "searchFAQ",
    description: "Search the hotel's FAQ database for answers to common guest questions. Use this when a guest asks about policies, procedures, or general hotel information.",
    schema: searchFAQSchema,
  }
);