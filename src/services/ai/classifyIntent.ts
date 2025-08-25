import { logger } from '../../shared/utils/logger';
import OpenAI from 'openai';
import { GPTConversationMessage, getConversationHistoryForGPT } from '../messaging/getConversationHistory';

// --- Constants and Types ---
const INTENT_TYPES = ["request", "faq", "complaint", "general", "upsell"] as const;
export type IntentType = typeof INTENT_TYPES[number];

const SENTIMENT_TYPES = ["positive", "neutral", "negative"] as const;
export type SentimentType = typeof SENTIMENT_TYPES[number];

interface PotentialItemMentioned {
  guest_phrasing_for_item: string; // What the guest actually said that implies an item
  guessed_item_name: string;       // AI's attempt to normalize the item name
  extracted_quantity?: number | string; // Use string to capture phrases like "a few"
  extracted_time_preference?: string; // e.g., "ASAP", "7 PM", "tomorrow morning"
}

interface RequestDetails {
  potential_items_mentioned: PotentialItemMentioned[];
}

interface FaqDetails {
  faq_query_text: string;
  faq_keywords: string[];
}

interface ComplaintDetails {
  complaint_summary: string;
  complaint_keywords: string[];
}

interface IntentObject {
  type: IntentType;
  confidence: number;
  details?: RequestDetails | FaqDetails | ComplaintDetails | Record<string, never>; // Empty for general
}

export interface ClassifiedOutput {
  language: string; // Provided as input
  overall_sentiment: SentimentType;
  intents: IntentObject[];
}

// --- Main Function ---

/**
 * Classifies the intent, sentiment, and extracts details from a guest message,
 * optionally fetching conversation history for better context.
 * @param message The current guest message to classify.
 * @param language The pre-determined language of the message.
 * @param guestId Optional guest ID to fetch conversation history for context.
 * @param hotelId Optional hotel ID for filtering conversation history.
 * @returns Promise<ClassifiedOutput> Structured classification output.
 */
export async function classifyIntent(
  message: string, 
  language: string,
  guestId?: string, // Changed from conversation_history to guestId
  hotelId?: string  // Added hotelId parameter
): Promise<ClassifiedOutput> {
  const fallbackOutput: ClassifiedOutput = {
    language,
    overall_sentiment: 'neutral',
    intents: [{ type: 'general', confidence: 1.0, details: {} }],
  };

  try {
    const openai = new OpenAI();

    // Fetch conversation history if guestId is provided
    let conversation_history: GPTConversationMessage[] = [];
    if (guestId) {
      conversation_history = await getConversationHistoryForGPT(guestId, hotelId, 15); // Limit to 15 messages for token efficiency
    }

    // System prompt updated to explicitly handle missing info and reinforce general fallback
    const systemPrompt = `You are an advanced AI assistant for a hotel concierge. Your primary task is to meticulously analyze the guest's message (provided in ${language}) and extract all relevant information into a structured JSON output. 
Consider the provided conversation history, if any, to better understand context for follow-up questions or statements from the user.

IMPORTANT INSTRUCTIONS:
1. DO NOT invent details. If information like quantity or time preference for an item is not explicitly stated or strongly implied by the context, OMIT the corresponding optional fields (e.g., 'extracted_quantity', 'extracted_time_preference') in your JSON output for that item.
2. If no specific intent from the list ("request", "faq", "complaint", "upsell") is clearly identifiable, you MUST classify the intent as "general".

Identify all distinct intents: "request", "faq", "complaint", "upsell", or "general". Most messages will have 1-2 intents. Determine the overall sentiment: "positive", "neutral", or "negative".

For "request" intents, identify each item/service mentioned. For each, provide:
- "guest_phrasing_for_item": The exact text snippet from the guest.
- "guessed_item_name": Your best guess of the normalized item name (use context from history if it clarifies a previous item).
- "extracted_quantity" (OPTIONAL): Any specified quantity. Omit if not present.
- "extracted_time_preference" (OPTIONAL): Any time preference. Omit if not present.

For "upsell" intents, identify each item/service mentioned. For each, provide:
- "guest_phrasing_for_item": The exact text snippet from the guest.
- "guessed_item_name": Your best guess of the normalized item name (use context from history if it clarifies a previous item).
- "extracted_quantity" (OPTIONAL): Any specified quantity. Omit if not present.
- "extracted_time_preference" (OPTIONAL): Any time preference. Omit if not present.

For "faq" intents, provide:
- "faq_query_text": The core question.
- "faq_keywords": Relevant keywords for search.

For "complaint" intents, provide:
- "complaint_summary": A brief summary.
- "complaint_keywords": Relevant keywords.

Include a confidence score (0.0-1.0) for each intent.`;

    // Construct messages for API, including history if provided
    const messagesForAPI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt }
    ];

    if (conversation_history && conversation_history.length > 0) {
        // Add conversation history to messages
        messagesForAPI.push(...conversation_history);
    }
    messagesForAPI.push({ role: 'user', content: message }); // Current user message

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-nano', 
      messages: messagesForAPI, // Use the constructed messages array
      response_format: {
        type: "json_schema",
        json_schema: {
            name: "classify_guest_message_details",
            description: "Structured classification of a hotel guest's message, including intents, sentiment, and extracted details for each intent, considering conversation history.",
            schema: {
                type: "object",
                properties: {
                    overall_sentiment: { 
                        type: "string", 
                        enum: SENTIMENT_TYPES 
                    },
                    intents: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { 
                                    type: "string", 
                                    enum: INTENT_TYPES
                                },
                                confidence: { 
                                    type: "number", 
                                    minimum: 0,
                                    maximum: 1
                                },
                                details: {
                                    type: "object",
                                    description: "Details specific to the intent type.",
                                    properties: {
                                        potential_items_mentioned: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    guest_phrasing_for_item: { type: "string" },
                                                    guessed_item_name: { type: "string" },
                                                    extracted_quantity: { type: ["number", "string"] },
                                                    extracted_time_preference: { type: "string" }
                                                },
                                                required: ["guest_phrasing_for_item", "guessed_item_name"]
                                            }
                                        },
                                        faq_query_text: { type: "string" },
                                        faq_keywords: { type: "array", items: { type: "string" } },
                                        complaint_summary: { type: "string" },
                                        complaint_keywords: { type: "array", items: { type: "string" } }
                                    }
                                }
                            },
                            required: ["type", "confidence"]
                        },
                        minItems: 1
                    }
                },
                required: ["overall_sentiment", "intents"]
            }
        }
      },
      temperature: 0.1,
      max_tokens: 800, // Slightly increased max_tokens in case history adds to output complexity
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      logger.warn('INTENT_CLASSIFY_DETAIL', 'Empty response from model', { message });
      return fallbackOutput;
    }

    try {
      const parsed = JSON.parse(content) as ClassifiedOutput;
      if (!parsed.overall_sentiment || !parsed.intents || !Array.isArray(parsed.intents) || parsed.intents.length === 0) {
        logger.warn('INTENT_CLASSIFY_DETAIL', 'Invalid base structure from model', { content });
        return fallbackOutput;
      }
      for (const intent of parsed.intents) {
        if (!INTENT_TYPES.includes(intent.type) || typeof intent.confidence !== 'number') {
          logger.warn('INTENT_CLASSIFY_DETAIL', 'Invalid intent object in response', { intent });
          return fallbackOutput;
        }
      }
      parsed.language = language; // Ensure language is part of the final output
      logger.debug('INTENT_CLASSIFY_DETAIL', 'Successfully classified message with details', {
        message: process.env.NODE_ENV !== 'production' ? message : undefined,
        history_length: conversation_history?.length || 0,
        classification: parsed,
      });
      return parsed;
    } catch (jsonError) {
      logger.error('INTENT_CLASSIFY_DETAIL', 'Failed to parse JSON response from model', {
        content,
        error: jsonError instanceof Error ? jsonError.message : 'Unknown JSON error',
      });
      return fallbackOutput;
    }
  } catch (error) {
    logger.error('INTENT_CLASSIFY_DETAIL', 'Detailed intent classification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: process.env.NODE_ENV !== 'production' ? message : undefined,
    });
    return fallbackOutput;
  }
}
