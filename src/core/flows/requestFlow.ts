import { Annotation } from '@langchain/langgraph';
import { logger } from '../../shared/utils/logger';
import { runConversationalFlow } from '../chat/conversationFlow';
import { SubChat } from '../../services/subchat/subChatManager';
import { ClassifiedOutput } from '../../services/ai/classifyIntent';

export interface RequestFlowState {
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
  
  // Request-specific
  staffNote?: {
    created: boolean;
    id?: string;
  };
}

export const RequestFlowAnnotation = Annotation.Root({
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
 * Handle request-specific flow logic
 */
export async function runRequestFlow(state: RequestFlowState): Promise<RequestFlowState> {
  logger.debug('REQUEST_FLOW', 'Running request flow', {
    message: state.message,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    // Filter for request intents only
    const requestIntents = state.classifiedIntent?.intents.filter(
      intent => intent.type === 'request'
    ) || [];

    if (requestIntents.length === 0) {
      logger.warn('REQUEST_FLOW', 'No request intents found');
      return {
        ...state,
        error: 'No request intents found',
        reply: 'I apologize, but I could not identify any specific requests in your message.'
      };
    }

    // Use conversational flow for request processing
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
        intents: requestIntents
      } : undefined
    });

    if (result.error) {
      return {
        ...state,
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your request.'
      };
    }

    return {
      ...state,
      reply: result.reply,
      staffNote: result.staffNote
    };
  } catch (error) {
    logger.error('REQUEST_FLOW', 'Request flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message
    });

    return {
      ...state,
      error: 'Request flow failed',
      reply: 'I apologize, but I encountered an error processing your request. Please try again.'
    };
  }
}