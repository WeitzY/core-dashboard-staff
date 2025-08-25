import { Annotation } from '@langchain/langgraph';
import { logger } from '../../shared/utils/logger';
import { runConversationalFlow } from '../chat/conversationFlow';
import { SubChat } from '../../services/subchat/subChatManager';
import { ClassifiedOutput } from '../../services/ai/classifyIntent';

export interface UpsellFlowState {
  message: string;
  sessionCode: string;
  hotelId: string;
  guestId?: string;
  roomNumber?: string;
  lastName?: string;
  language?: string;
  classifiedIntent?: ClassifiedOutput;
  
  // Subchat management
  subChatId?: string;
  currentSubChat?: SubChat;
  isNewSubChat?: boolean;
  
  // Results
  reply?: string;
  error?: string;
  
  // Upsell-specific
  staffNote?: {
    created: boolean;
    id?: string;
  };
}

export const UpsellFlowAnnotation = Annotation.Root({
  message: Annotation<string>,
  sessionCode: Annotation<string>,
  hotelId: Annotation<string>,
  guestId: Annotation<string>,
  roomNumber: Annotation<string>,
  lastName: Annotation<string>,
  language: Annotation<string>,
  classifiedIntent: Annotation<ClassifiedOutput>,
  subChatId: Annotation<string>,
  currentSubChat: Annotation<SubChat>,
  isNewSubChat: Annotation<boolean>,
  reply: Annotation<string>,
  error: Annotation<string>,
  staffNote: Annotation<{ created: boolean; id?: string }>,
});

/**
 * Handle upsell-specific flow logic
 */
export async function runUpsellFlow(state: UpsellFlowState): Promise<UpsellFlowState> {
  logger.debug('UPSELL_FLOW', 'Running upsell flow', {
    message: state.message,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    // Filter for upsell intents only
    const upsellIntents = state.classifiedIntent?.intents.filter(
      intent => intent.type === 'upsell'
    ) || [];

    if (upsellIntents.length === 0) {
      logger.warn('UPSELL_FLOW', 'No upsell intents found');
      return {
        ...state,
        error: 'No upsell intents found',
        reply: 'I apologize, but I could not identify any specific upsell opportunities in your message.'
      };
    }

    // Use conversational flow for upsell processing
    const hotelName = 'our hotel'; // TODO: Get hotel name from DB
    
    const result = await runConversationalFlow({
      message: state.message,
      hotelId: state.hotelId,
      guestId: state.guestId || '',
      sessionCode: state.sessionCode || '',
      roomNumber: state.roomNumber || '',
      lastName: state.lastName || '',
      language: state.language || 'en',
      hotelName,
      // Pass subchat context
      subChatId: state.subChatId,
      currentSubChat: state.currentSubChat,
      isNewSubChat: state.isNewSubChat,
      classifiedIntent: state.classifiedIntent ? {
        language: state.classifiedIntent.language,
        overall_sentiment: state.classifiedIntent.overall_sentiment,
        intents: upsellIntents
      } : undefined
    });

    if (result.error) {
      return {
        ...state,
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your upsell inquiry.'
      };
    }

    return {
      ...state,
      reply: result.reply,
      staffNote: result.staffNote
    };
  } catch (error) {
    logger.error('UPSELL_FLOW', 'Upsell flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message
    });

    return {
      ...state,
      error: 'Upsell flow failed',
      reply: 'I apologize, but I encountered an error processing your upsell inquiry. Please try again.'
    };
  }
}