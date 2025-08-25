import { logger } from "../../shared/utils/logger";
import { ClassifiedOutput } from "../ai/classifyIntent";
import { 
  calculateMatchScore, 
  typesMatch, 
  extractKeywords 
} from './matchingAlgorithms';
import { 
  generateSubChatId, 
  generateMessageId, 
  findSubChatById, 
  cleanupOldSubChats, 
  getSubChatStats, 
  validateSubChat 
} from './subChatUtils';

export type SubChatType = 'request' | 'complaint' | 'faq' | 'general' | 'upsell';
export type SubChatStatus = 'open' | 'awaiting_confirmation' | 'resolved' | 'cancelled';

export interface SubChatContext {
  // Common fields
  intent: ClassifiedOutput;
  relatedKeywords: string[];
  
  // For requests
  itemName?: string;
  itemId?: string;
  quantity?: number | string;
  timingPreference?: string;
  
  // For complaints
  complaintSummary?: string;
  department?: string;
  
  // For FAQ
  faqQuery?: string;
  faqKeywords?: string[];
  
  // For general
  lastResponse?: string;
}

export interface SubChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export interface SubChat {
  id: string;
  sessionCode: string;
  type: SubChatType;
  status: SubChatStatus;
  context: SubChatContext;
  messages: SubChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  
  // For matching purposes
  lastUserMessage?: string;
  isActive: boolean;
}

/**
 * Manages multiple concurrent subchats per session
 * Each subchat represents a specific conversation thread (request, complaint, FAQ, etc.)
 */
class SubChatManager {
  private subchats: Map<string, SubChat[]> = new Map(); // sessionCode -> SubChat[]

  /**
   * Create a new subchat for a specific intent
   */
  createSubChat(
    sessionCode: string,
    type: SubChatType,
    intent: ClassifiedOutput,
    initialMessage: string
  ): SubChat {
    const subchat: SubChat = {
      id: generateSubChatId(),
      sessionCode,
      type,
      status: 'open',
      context: {
        intent,
        relatedKeywords: extractKeywords(intent, initialMessage),
        ...(type === 'request' && intent.intents[0]?.details && 'potential_items_mentioned' in intent.intents[0].details && {
          itemName: intent.intents[0].details.potential_items_mentioned[0]?.guessed_item_name,
          quantity: intent.intents[0].details.potential_items_mentioned[0]?.extracted_quantity,
          timingPreference: intent.intents[0].details.potential_items_mentioned[0]?.extracted_time_preference
        }),
        ...(type === 'complaint' && intent.intents[0]?.details && 'complaint_summary' in intent.intents[0].details && {
          complaintSummary: intent.intents[0].details.complaint_summary
        }),
        ...(type === 'faq' && intent.intents[0]?.details && 'faq_query_text' in intent.intents[0].details && {
          faqQuery: intent.intents[0].details.faq_query_text,
          faqKeywords: intent.intents[0].details.faq_keywords || []
        })
      },
      messages: [{
        id: generateMessageId(),
        content: initialMessage,
        role: 'user',
        timestamp: new Date()
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUserMessage: initialMessage.toLowerCase(),
      isActive: true
    };

    // Add to session
    const sessionSubchats = this.subchats.get(sessionCode) || [];
    sessionSubchats.push(subchat);
    this.subchats.set(sessionCode, sessionSubchats);

    logger.info('SUBCHAT_MANAGER', 'Created new subchat', {
      sessionCode,
      subchatId: subchat.id,
      type,
      totalSubchats: sessionSubchats.length
    });
    
    return subchat;
  }
  
  /**
   * Find an existing subchat that matches the current message
   */
  findMatchingSubChat(
    sessionCode: string,
    message: string,
    intent: ClassifiedOutput,
    specificIntentType?: string
  ): SubChat | null {
    const sessionSubchats = this.subchats.get(sessionCode);
    if (!sessionSubchats || sessionSubchats.length === 0) {
      return null;
    }
    
    const messageKeywords = extractKeywords(intent, message);
    const messageLower = message.toLowerCase();
    
    // Filter to active subchats of the same type
    const candidateSubchats = sessionSubchats.filter(subchat => 
      subchat.isActive && 
      subchat.status !== 'resolved' && 
      subchat.status !== 'cancelled' &&
      typesMatch(subchat.type, intent, specificIntentType)
    );
    
    if (candidateSubchats.length === 0) {
      return null;
    }
    
    // Score each candidate subchat
    let bestMatch: SubChat | null = null;
    let bestScore = 0;
    
    for (const subchat of candidateSubchats) {
      const score = calculateMatchScore(subchat, messageLower, messageKeywords);
      
      if (score > bestScore && score > 0.3) { // Minimum threshold
        bestScore = score;
        bestMatch = subchat;
      }
    }
    
    if (bestMatch) {
      logger.info('SUBCHAT_MANAGER', 'Found matching subchat', {
        sessionCode,
        subchatId: bestMatch.id,
        score: bestScore,
        type: bestMatch.type
      });
    }
    
    return bestMatch;
  }
  
  /**
   * Add a message to an existing subchat
   */
  addMessage(subchatId: string, content: string, role: 'user' | 'assistant'): void {
    const subchat = findSubChatById(this.subchats, subchatId);
    if (!subchat) {
      logger.error('SUBCHAT_MANAGER', 'Subchat not found for message', { subchatId });
      return;
    }
    
    const message: SubChatMessage = {
      id: generateMessageId(),
      content,
      role,
      timestamp: new Date()
    };
    
    subchat.messages.push(message);
    subchat.updatedAt = new Date();
    
    if (role === 'user') {
      subchat.lastUserMessage = content.toLowerCase();
    }
    
    logger.debug('SUBCHAT_MANAGER', 'Added message to subchat', {
      subchatId,
      role,
      messageCount: subchat.messages.length
    });
  }
  
  /**
   * Update subchat status
   */
  updateSubChatStatus(subchatId: string, status: SubChatStatus): void {
    const subchat = findSubChatById(this.subchats, subchatId);
    if (!subchat) {
      logger.error('SUBCHAT_MANAGER', 'Subchat not found for status update', { subchatId });
      return;
    }
    
    subchat.status = status;
    subchat.updatedAt = new Date();
    
    // Mark as inactive if resolved or cancelled
    if (status === 'resolved' || status === 'cancelled') {
      subchat.isActive = false;
    }
    
    logger.info('SUBCHAT_MANAGER', 'Updated subchat status', {
      subchatId,
      status,
      isActive: subchat.isActive
    });
  }
  
  /**
   * Update subchat context
   */
  updateSubChatContext(subchatId: string, contextUpdate: Partial<SubChatContext>): void {
    const subchat = findSubChatById(this.subchats, subchatId);
    if (!subchat) {
      logger.error('SUBCHAT_MANAGER', 'Subchat not found for context update', { subchatId });
      return;
    }
    
    subchat.context = { ...subchat.context, ...contextUpdate };
    subchat.updatedAt = new Date();
    
    logger.debug('SUBCHAT_MANAGER', 'Updated subchat context', {
      subchatId,
      contextKeys: Object.keys(contextUpdate)
    });
  }
  
  /**
   * Get all subchats for a session
   */
  getSessionSubChats(sessionCode: string): SubChat[] {
    return this.subchats.get(sessionCode) || [];
  }
  
  /**
   * Get active subchats for a session
   */
  getActiveSubChats(sessionCode: string): SubChat[] {
    const sessionSubchats = this.subchats.get(sessionCode) || [];
    return sessionSubchats.filter(subchat => subchat.isActive);
  }

  /**
   * Get statistics about all subchats
   */
  getStats(): ReturnType<typeof getSubChatStats> {
    return getSubChatStats(this.subchats);
  }

  /**
   * Clean up old subchats
   */
  cleanup(maxAgeHours: number = 24): void {
    cleanupOldSubChats(this.subchats, maxAgeHours);
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use cleanup() instead
   */
  cleanupOldSubChats(maxAgeHours: number = 24): void {
    this.cleanup(maxAgeHours);
  }

  /**
   * Process multiple intents from a classified message
   * Returns information about which subchats to use for each intent
   */
  processMultipleIntents(
    sessionCode: string,
    message: string,
    classifiedIntent: ClassifiedOutput
  ): Array<{
    intent: ClassifiedOutput['intents'][0];
    matchedSubChat: SubChat | null;
    needsNewSubChat: boolean;
  }> {
    const results: Array<{
      intent: ClassifiedOutput['intents'][0];
      matchedSubChat: SubChat | null;
      needsNewSubChat: boolean;
    }> = [];

    // Process each intent separately
    for (const intent of classifiedIntent.intents) {
      // Create a temporary classified output for this specific intent
      const intentSpecificOutput: ClassifiedOutput = {
        ...classifiedIntent,
        intents: [intent]
      };

      // Try to find a matching existing subchat for this intent type
      const matchedSubChat = this.findMatchingSubChat(
        sessionCode,
        message,
        intentSpecificOutput,
        intent.type
      );

      const needsNewSubChat = !matchedSubChat;

      results.push({
        intent,
        matchedSubChat,
        needsNewSubChat
      });

      logger.debug('SUBCHAT_MANAGER', 'Processed intent for matching', {
        intentType: intent.type,
        confidence: intent.confidence,
        hasMatchedSubChat: !!matchedSubChat,
        needsNewSubChat,
        matchedSubChatId: matchedSubChat?.id
      });
    }

    logger.info('SUBCHAT_MANAGER', 'Processed multiple intents', {
      sessionCode,
      totalIntents: classifiedIntent.intents.length,
      newSubChatsNeeded: results.filter(r => r.needsNewSubChat).length,
      existingMatches: results.filter(r => !r.needsNewSubChat).length
    });

    return results;
  }
}

// Export singleton instance
export const subChatManager = new SubChatManager();