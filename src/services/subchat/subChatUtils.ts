import { logger } from '../../shared/utils/logger';
import type { SubChat } from './subChatManager';

/**
 * Generate a unique subchat ID
 */
export function generateSubChatId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `subchat_${timestamp}_${random}`;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `msg_${timestamp}_${random}`;
}

/**
 * Clean up old subchats that are no longer needed
 */
export function cleanupOldSubChats(
  subchats: Map<string, SubChat[]>,
  maxAgeHours: number = 24
): void {
  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  let totalCleaned = 0;
  
  for (const [sessionCode, sessionSubchats] of subchats.entries()) {
    const originalCount = sessionSubchats.length;
    
    // Filter out old subchats
    const activeSubchats = sessionSubchats.filter(subchat => {
      // Keep if recently updated
      if (subchat.updatedAt > cutoffTime) return true;
      
      // Keep if still active and unresolved
      if (subchat.isActive && subchat.status !== 'resolved' && subchat.status !== 'cancelled') {
        return true;
      }
      
      return false;
    });
    
    // Update the map
    if (activeSubchats.length === 0) {
      subchats.delete(sessionCode);
    } else {
      subchats.set(sessionCode, activeSubchats);
    }
    
    const cleanedCount = originalCount - activeSubchats.length;
    totalCleaned += cleanedCount;
    
    if (cleanedCount > 0) {
      logger.info('SUBCHAT_UTILS', 'Cleaned up old subchats', {
        sessionCode,
        cleanedCount,
        remainingCount: activeSubchats.length
      });
    }
  }
  
  logger.info('SUBCHAT_UTILS', 'Cleanup completed', {
    totalCleaned,
    remainingSessions: subchats.size
  });
}

/**
 * Find a subchat by ID across all sessions
 */
export function findSubChatById(
  subchats: Map<string, SubChat[]>,
  subchatId: string
): SubChat | null {
  for (const sessionSubchats of subchats.values()) {
    const found = sessionSubchats.find(subchat => subchat.id === subchatId);
    if (found) return found;
  }
  return null;
}

/**
 * Get statistics about subchats for monitoring
 */
export function getSubChatStats(subchats: Map<string, SubChat[]>): {
  totalSessions: number;
  totalSubchats: number;
  activeSubchats: number;
  subChatsByType: Record<string, number>;
  subChatsByStatus: Record<string, number>;
} {
  let totalSubchats = 0;
  let activeSubchats = 0;
  const subChatsByType: Record<string, number> = {};
  const subChatsByStatus: Record<string, number> = {};
  
  for (const sessionSubchats of subchats.values()) {
    for (const subchat of sessionSubchats) {
      totalSubchats++;
      
      if (subchat.isActive) {
        activeSubchats++;
      }
      
      // Count by type
      subChatsByType[subchat.type] = (subChatsByType[subchat.type] || 0) + 1;
      
      // Count by status
      subChatsByStatus[subchat.status] = (subChatsByStatus[subchat.status] || 0) + 1;
    }
  }
  
  return {
    totalSessions: subchats.size,
    totalSubchats,
    activeSubchats,
    subChatsByType,
    subChatsByStatus
  };
}

/**
 * Validate subchat data structure
 */
export function validateSubChat(subchat: SubChat): boolean {
  try {
    // Check required fields
    if (!subchat.id || !subchat.sessionCode || !subchat.type || !subchat.status) {
      return false;
    }
    
    // Check dates
    if (!(subchat.createdAt instanceof Date) || !(subchat.updatedAt instanceof Date)) {
      return false;
    }
    
    // Check context exists
    if (!subchat.context || typeof subchat.context !== 'object') {
      return false;
    }
    
    // Check messages array
    if (!Array.isArray(subchat.messages)) {
      return false;
    }
    
    // Validate each message
    for (const message of subchat.messages) {
      if (!message.id || !message.content || !message.role || !(message.timestamp instanceof Date)) {
        return false;
      }
      
      if (!['user', 'assistant'].includes(message.role)) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('SUBCHAT_UTILS', 'Error validating subchat', {
      subchatId: subchat?.id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
} 