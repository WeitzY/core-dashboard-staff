import { supabase } from './supabaseClient';
import { logger } from '../../shared/utils/logger';

// Message format for conversation history (with timestamp for database storage)
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Minimal message format for GPT (token-efficient)
export interface GPTConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Fetches the full conversation history for a guest from the chat_messages table
 * @param guestId - The guest's unique identifier (auth_id)
 * @param hotelId - The hotel's unique identifier (for additional filtering)
 * @param limit - Maximum number of messages to fetch (default: 50)
 * @returns Promise<ConversationMessage[]> - Array of messages ordered by timestamp (ascending)
 */
export async function getConversationHistory(
  guestId: string, 
  hotelId?: string,
  limit: number = 50
): Promise<ConversationMessage[]> {
  try {
    logger.debug('CONVERSATION_HISTORY', 'Fetching conversation history', {
      guestId,
      hotelId,
      limit
    });

    // Build the query
    let query = supabase
      .from('chat_messages')
      .select('sender, message, created_at')
      .eq('auth_id', guestId)
      .order('created_at', { ascending: true })
      .limit(limit);

    // Add hotel filter if provided
    if (hotelId) {
      query = query.eq('hotel_id', hotelId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('CONVERSATION_HISTORY', 'Error fetching conversation history', {
        error: error.message,
        guestId,
        hotelId
      });
      throw error;
    }

    if (!data || data.length === 0) {
      logger.debug('CONVERSATION_HISTORY', 'No conversation history found', {
        guestId,
        hotelId
      });
      return [];
    }

    // Map database records to conversation message format
    const conversation: ConversationMessage[] = data.map(record => ({
      role: mapSenderToRole(record.sender),
      content: record.message,
      timestamp: record.created_at
    }));

    logger.debug('CONVERSATION_HISTORY', 'Successfully fetched conversation history', {
      guestId,
      hotelId,
      messageCount: conversation.length
    });

    return conversation;

  } catch (error) {
    logger.error('CONVERSATION_HISTORY', 'Failed to fetch conversation history', {
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId,
      hotelId
    });
    
    // Return empty array on error to prevent breaking the conversation flow
    return [];
  }
}

/**
 * Maps database sender field to conversation role
 * @param sender - The sender field from the database
 * @returns 'user' | 'assistant'
 */
function mapSenderToRole(sender: string): 'user' | 'assistant' {
  // Handle common variations in sender field
  switch (sender.toLowerCase()) {
    case 'user':
    case 'guest':
      return 'user';
    case 'assistant':
    case 'ai':
    case 'velin':
    case 'system':
      return 'assistant';
    default:
      // Default to user if unknown
      logger.warn('CONVERSATION_HISTORY', 'Unknown sender type, defaulting to user', {
        sender
      });
      return 'user';
  }
}

/**
 * Saves a new message to the conversation history
 * @param guestId - The guest's unique identifier
 * @param hotelId - The hotel's unique identifier
 * @param message - The message content
 * @param sender - Who sent the message ('user', 'assistant', etc.)
 * @returns Promise<void>
 */
export async function saveMessage(
  guestId: string,
  hotelId: string,
  message: string,
  sender: 'user' | 'assistant'
): Promise<void> {
  try {
    logger.debug('SAVE_MESSAGE', 'Saving message to conversation history', {
      guestId,
      hotelId,
      sender,
      messageLength: message.length
    });

    const { error } = await supabase
      .from('chat_messages')
      .insert({
        auth_id: guestId,
        hotel_id: hotelId,
        sender: sender,
        message: message,
        created_at: new Date().toISOString(),
        metadata: {}
      });

    if (error) {
      logger.error('SAVE_MESSAGE', 'Error saving message', {
        error: error.message,
        guestId,
        hotelId,
        sender
      });
      throw error;
    }

    logger.debug('SAVE_MESSAGE', 'Successfully saved message', {
      guestId,
      hotelId,
      sender
    });

  } catch (error) {
    logger.error('SAVE_MESSAGE', 'Failed to save message', {
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId,
      hotelId,
      sender
    });
    throw error;
  }
}

/**
 * Convenient function to save a message and immediately get updated conversation history
 * @param guestId - The guest's unique identifier
 * @param hotelId - The hotel's unique identifier  
 * @param message - The message content
 * @param sender - Who sent the message
 * @param limit - Maximum number of messages to return in history
 * @returns Promise<ConversationMessage[]> - Updated conversation history
 */
export async function saveMessageAndGetHistory(
  guestId: string,
  hotelId: string,
  message: string,
  sender: 'user' | 'assistant',
  limit: number = 50
): Promise<ConversationMessage[]> {
  // Save the new message first
  await saveMessage(guestId, hotelId, message, sender);
  
  // Get updated conversation history
  return await getConversationHistory(guestId, hotelId, limit);
}

/**
 * Fetches conversation history optimized for GPT (minimal tokens)
 * @param guestId - The guest's unique identifier (auth_id)
 * @param hotelId - The hotel's unique identifier (for additional filtering)
 * @param limit - Maximum number of messages to fetch (default: 20)
 * @returns Promise<GPTConversationMessage[]> - Array of messages with just role and content
 */
export async function getConversationHistoryForGPT(
  guestId: string, 
  hotelId?: string,
  limit: number = 20
): Promise<GPTConversationMessage[]> {
  try {
    logger.debug('CONVERSATION_HISTORY_GPT', 'Fetching conversation history for GPT', {
      guestId,
      hotelId,
      limit
    });

    // Build the query
    let query = supabase
      .from('chat_messages')
      .select('sender, message')
      .eq('auth_id', guestId)
      .order('created_at', { ascending: true })
      .limit(limit);

    // Add hotel filter if provided
    if (hotelId) {
      query = query.eq('hotel_id', hotelId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('CONVERSATION_HISTORY_GPT', 'Error fetching conversation history for GPT', {
        error: error.message,
        guestId,
        hotelId
      });
      throw error;
    }

    if (!data || data.length === 0) {
      logger.debug('CONVERSATION_HISTORY_GPT', 'No conversation history found', {
        guestId,
        hotelId
      });
      return [];
    }

    // Map to minimal GPT format
    const conversation: GPTConversationMessage[] = data.map(record => ({
      role: mapSenderToRole(record.sender),
      content: record.message
    }));

    logger.debug('CONVERSATION_HISTORY_GPT', 'Successfully fetched GPT conversation history', {
      guestId,
      hotelId,
      messageCount: conversation.length
    });

    return conversation;

  } catch (error) {
    logger.error('CONVERSATION_HISTORY_GPT', 'Failed to fetch GPT conversation history', {
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId,
      hotelId
    });
    
    // Return empty array on error to prevent breaking the conversation flow
    return [];
  }
} 