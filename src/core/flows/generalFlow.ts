import { Annotation } from '@langchain/langgraph';
import { logger } from '../../shared/utils/logger';
import { runConversationalFlow } from '../chat/conversationFlow';
import { SubChat } from '../../services/subchat/subChatManager';
import { ClassifiedOutput } from '../../services/ai/classifyIntent';

export interface GeneralFlowState {
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

export const GeneralFlowAnnotation = Annotation.Root({
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
 * Handle general chat flow logic
 */
export async function runGeneralFlow(state: GeneralFlowState): Promise<GeneralFlowState> {
  logger.debug('GENERAL_FLOW', 'Running general flow', {
    message: state.message,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    // Filter for general intents only
    const generalIntents = state.classifiedIntent?.intents.filter(
      intent => intent.type === 'general'
    ) || [];

    if (generalIntents.length === 0) {
      logger.warn('GENERAL_FLOW', 'No general intents found');
      return {
        ...state,
        error: 'No general intents found',
        reply: 'I apologize, but I could not understand your message.'
      };
    }

    // Use conversational flow for general chat processing
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
        intents: generalIntents
      } : undefined
    });

    if (result.error) {
      return {
        ...state,
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your message.'
      };
    }

    return {
      ...state,
      reply: result.reply
    };
  } catch (error) {
    logger.error('GENERAL_FLOW', 'General flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message
    });

    return {
      ...state,
      error: 'General flow failed',
      reply: 'I apologize, but I encountered an error processing your message. Please try again.'
    };
  }
}