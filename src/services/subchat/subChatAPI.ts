import { subChatManager, SubChat } from "../services/subchat/subChatManager";
import { logger } from "../shared/utils/logger";

/**
 * API functions for subchat management - expose to frontend
 */

export interface SubChatSummary {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  lastMessage: string;
  messageCount: number;
  // Context-specific fields
  itemName?: string;
  complaintSummary?: string;
  faqQuery?: string;
}

/**
 * Get all active subchats for a session
 */
export async function getActiveSubChats(sessionCode: string): Promise<SubChatSummary[]> {
  logger.debug('SUBCHAT_API', 'Getting active subchats', { sessionCode });
  
  try {
    const subchats = subChatManager.getActiveSubChats(sessionCode);
    
    return subchats.map(subchat => ({
      id: subchat.id,
      type: subchat.type,
      status: subchat.status,
      createdAt: subchat.createdAt.toISOString(),
      lastMessage: subchat.messages[subchat.messages.length - 1]?.content || '',
      messageCount: subchat.messages.length,
      itemName: subchat.context.itemName,
      complaintSummary: subchat.context.complaintSummary,
      faqQuery: subchat.context.faqQuery
    }));
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error getting active subchats', { 
      sessionCode, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return [];
  }
}

/**
 * Get all subchats (active and resolved) for a session
 */
export async function getAllSubChats(sessionCode: string): Promise<SubChatSummary[]> {
  logger.debug('SUBCHAT_API', 'Getting all subchats', { sessionCode });
  
  try {
    const subchats = subChatManager.getSessionSubChats(sessionCode);
    
    return subchats.map(subchat => ({
      id: subchat.id,
      type: subchat.type,
      status: subchat.status,
      createdAt: subchat.createdAt.toISOString(),
      lastMessage: subchat.messages[subchat.messages.length - 1]?.content || '',
      messageCount: subchat.messages.length,
      itemName: subchat.context.itemName,
      complaintSummary: subchat.context.complaintSummary,
      faqQuery: subchat.context.faqQuery
    }));
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error getting all subchats', { 
      sessionCode, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return [];
  }
}

/**
 * Get detailed information about a specific subchat
 */
export async function getSubChatDetail(subChatId: string): Promise<SubChat | null> {
  logger.debug('SUBCHAT_API', 'Getting subchat detail', { subChatId });
  
  try {
    // Find the subchat across all sessions
    const allSessions = subChatManager.getSessionSubChats; // This won't work, need to modify the manager
    
    // For now, return null - this would require extending the manager
    logger.warn('SUBCHAT_API', 'getSubChatDetail not fully implemented yet');
    return null;
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error getting subchat detail', { 
      subChatId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return null;
  }
}

/**
 * Update subchat status (for confirmations, cancellations, etc.)
 */
export async function updateSubChatStatus(
  subChatId: string, 
  status: 'resolved' | 'cancelled' | 'awaiting_confirmation'
): Promise<boolean> {
  logger.debug('SUBCHAT_API', 'Updating subchat status', { subChatId, status });
  
  try {
    subChatManager.updateSubChatStatus(subChatId, status);
    logger.info('SUBCHAT_API', 'Subchat status updated', { subChatId, status });
    return true;
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error updating subchat status', { 
      subChatId, 
      status,
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return false;
  }
}

/**
 * Get subchat context for LLM (limited to current subchat)
 */
export async function getSubChatContext(subChatId: string): Promise<{
  messages: Array<{content: string, role: 'user' | 'assistant', timestamp: string}>;
  context: any;
  type: string;
  status: string;
} | null> {
  logger.debug('SUBCHAT_API', 'Getting subchat context', { subChatId });
  
  try {
    // This would need to be implemented by extending the manager
    // For now, return null
    logger.warn('SUBCHAT_API', 'getSubChatContext not fully implemented yet');
    return null;
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error getting subchat context', { 
      subChatId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return null;
  }
}

/**
 * Add a reference between subchats (for context switching)
 */
export async function addSubChatReference(
  fromSubChatId: string, 
  toSubChatId: string, 
  referenceText: string
): Promise<boolean> {
  logger.debug('SUBCHAT_API', 'Adding subchat reference', { 
    fromSubChatId, 
    toSubChatId, 
    referenceText 
  });
  
  try {
    // This would track references between subchats for better context switching
    // For now, just log the action
    logger.info('SUBCHAT_API', 'Subchat reference noted', { 
      fromSubChatId, 
      toSubChatId, 
      referenceText 
    });
    return true;
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error adding subchat reference', { 
      fromSubChatId, 
      toSubChatId,
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return false;
  }
}

/**
 * Cleanup old subchats (call periodically)
 */
export async function cleanupOldSubChats(): Promise<void> {
  logger.debug('SUBCHAT_API', 'Cleaning up old subchats');
  
  try {
    subChatManager.cleanupOldSubChats(24); // 24 hours
    logger.info('SUBCHAT_API', 'Old subchats cleaned up');
  } catch (error) {
    logger.error('SUBCHAT_API', 'Error cleaning up old subchats', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}