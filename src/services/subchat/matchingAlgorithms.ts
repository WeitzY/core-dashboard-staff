import { logger } from '../../shared/utils/logger';
import type { SubChat, SubChatType } from './subChatManager';
import type { ClassifiedOutput } from '../ai/classifyIntent';

/**
 * Calculate match score between a subchat and incoming message
 */
export function calculateMatchScore(
  subchat: SubChat,
  messageLower: string,
  messageKeywords: string[]
): number {
  let score = 0;
  
  // 1. Keyword overlap (40% weight)
  const subChatKeywords = subchat.context.relatedKeywords || [];
  const keywordOverlap = calculateKeywordOverlap(messageKeywords, subChatKeywords);
  score += keywordOverlap * 0.4;
  
  // 2. Context-based matching (35% weight)
  const contextScore = calculateContextScore(subchat, messageLower);
  score += contextScore * 0.35;
  
  // 3. Reference to previous items/issues (25% weight)
  const referenceScore = calculateReferenceScore(subchat, messageLower);
  score += referenceScore * 0.25;
  
  logger.debug('MATCHING_ALGORITHMS', 'Score breakdown', {
    subChatId: subchat.id,
    keywordOverlap,
    contextScore,
    referenceScore,
    totalScore: score
  });
  
  return Math.min(score, 1.0); // Cap at 1.0
}

/**
 * Calculate keyword overlap between two sets
 */
export function calculateKeywordOverlap(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) {
    return 0;
  }
  
  const set1 = new Set(keywords1.map(k => k.toLowerCase()));
  const set2 = new Set(keywords2.map(k => k.toLowerCase()));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Calculate context-based score
 */
export function calculateContextScore(subchat: SubChat, messageLower: string): number {
  let score = 0;
  
  // Check if message mentions specific items/services from context
  if (subchat.context.itemName) {
    const itemName = subchat.context.itemName.toLowerCase();
    if (messageLower.includes(itemName)) {
      score += 0.6;
    }
    
    // Check for partial matches or synonyms
    const itemWords = itemName.split(' ');
    const matchedWords = itemWords.filter(word => 
      word.length > 2 && messageLower.includes(word)
    );
    score += (matchedWords.length / itemWords.length) * 0.3;
  }
  
  // For complaints, check if similar complaint language
  if (subchat.type === 'complaint' && subchat.context.complaintSummary) {
    const complaintWords = ['issue', 'problem', 'complaint', 'wrong', 'broken', 'not working'];
    const hasComplaintLanguage = complaintWords.some(word => messageLower.includes(word));
    if (hasComplaintLanguage) {
      score += 0.4;
    }
  }
  
  // For FAQ, check if similar question pattern
  if (subchat.type === 'faq' && subchat.context.faqQuery) {
    const questionWords = ['what', 'when', 'where', 'how', 'why', 'can', 'is', 'are'];
    const hasQuestionPattern = questionWords.some(word => messageLower.includes(word));
    if (hasQuestionPattern) {
      score += 0.3;
    }
  }
  
  return Math.min(score, 1.0);
}

/**
 * Calculate reference score for explicit mentions
 */
export function calculateReferenceScore(subchat: SubChat, messageLower: string): number {
  let score = 0;
  
  // Check for explicit references
  const referencePatterns = [
    'my request',
    'my complaint',
    'the issue',
    'my order',
    'that request',
    'this problem',
    'my question',
    'earlier request',
    'previous request'
  ];
  
  for (const pattern of referencePatterns) {
    if (messageLower.includes(pattern)) {
      score += 0.7;
      break;
    }
  }
  
  // Check for mentions of timing that match subchat timing
  if (subchat.context.timingPreference) {
    const timing = subchat.context.timingPreference.toLowerCase();
    if (messageLower.includes(timing)) {
      score += 0.3;
    }
  }
  
  return Math.min(score, 1.0);
}

/**
 * Check if subchat type matches the intent
 */
export function typesMatch(
  subChatType: SubChatType,
  intent: ClassifiedOutput,
  specificIntentType?: string
): boolean {
  const targetType = specificIntentType || intent.intents?.[0]?.type;
  
  if (!targetType) return false;
  
  // Direct type matches
  if (subChatType === targetType) return true;
  
  // Flexible matching for related types
  const typeMap: Record<string, string[]> = {
    'request': ['request', 'request_item', 'request_service', 'room_service', 'housekeeping', 'maintenance'],
    'complaint': ['complaint', 'feedback_negative', 'issue'],
    'faq': ['faq', 'policy_question', 'information_request', 'question'],
    'general': ['general', 'greeting', 'small_talk', 'chitchat'],
    'upsell': ['upsell', 'upgrade_request', 'premium_service']
  };
  
  for (const [mainType, relatedTypes] of Object.entries(typeMap)) {
    if (mainType === subChatType && relatedTypes.includes(targetType)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract keywords from intent and message for matching
 */
export function extractKeywords(intent: ClassifiedOutput, message: string): string[] {
  const keywords: string[] = [];
  
  // Extract from message (simple approach)
  const messageWords = message.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !/^(the|and|but|for|are|was|were|been|have|has|had|do|does|did|will|would|could|should|may|might|can|a|an|to|of|in|on|at|by|with|from)$/.test(word));
  
  keywords.push(...messageWords);
  
  // Extract from intent details
  if (intent.intents) {
    for (const intentObj of intent.intents) {
      if (intentObj.details) {
        const details = intentObj.details as any;
        
        // Extract from FAQ keywords
        if (details.faq_keywords) {
          keywords.push(...details.faq_keywords);
        }
        
        // Extract from complaint keywords
        if (details.complaint_keywords) {
          keywords.push(...details.complaint_keywords);
        }
        
        // Extract from potential items
        if (details.potential_items_mentioned) {
          for (const item of details.potential_items_mentioned) {
            keywords.push(
              ...item.guest_phrasing_for_item.toLowerCase().split(/\s+/),
              ...item.guessed_item_name.toLowerCase().split(/\s+/)
            );
          }
        }
      }
    }
  }
  
  // Remove duplicates and short words
  return [...new Set(keywords)].filter(word => word.length > 2);
} 