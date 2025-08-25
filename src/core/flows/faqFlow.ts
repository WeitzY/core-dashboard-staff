import { Annotation } from '@langchain/langgraph';
import { logger } from '../../shared/utils/logger';
import { runConversationalFlow } from '../chat/conversationFlow';
import { SubChat } from '../../services/subchat/subChatManager';
import { ClassifiedOutput } from '../../services/ai/classifyIntent';

export interface FaqFlowState {
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
}

export const FaqFlowAnnotation = Annotation.Root({
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
});

/**
 * Handle FAQ-specific flow logic
 */
export async function runFaqFlow(state: FaqFlowState): Promise<FaqFlowState> {
  logger.debug('FAQ_FLOW', 'Running FAQ flow', {
    message: state.message,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    // Filter for FAQ intents only
    const faqIntents = state.classifiedIntent?.intents.filter(
      intent => intent.type === 'faq'
    ) || [];

    if (faqIntents.length === 0) {
      logger.warn('FAQ_FLOW', 'No FAQ intents found');
      return {
        ...state,
        error: 'No FAQ intents found',
        reply: 'I apologize, but I could not identify any specific questions in your message.'
      };
    }

    // Use conversational flow for FAQ processing
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
        intents: faqIntents
      } : undefined
    });

    if (result.error) {
      return {
        ...state,
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error answering your question.'
      };
    }

    return {
      ...state,
      reply: result.reply
    };
  } catch (error) {
    logger.error('FAQ_FLOW', 'FAQ flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message
    });

    return {
      ...state,
      error: 'FAQ flow failed',
      reply: 'I apologize, but I encountered an error answering your question. Please try again.'
    };
  }
}