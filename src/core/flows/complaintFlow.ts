import { Annotation } from '@langchain/langgraph';
import { logger } from '../../shared/utils/logger';
import { runConversationalFlow } from '../chat/conversationFlow';
import { SubChat } from '../../services/subchat/subChatManager';
import { ClassifiedOutput } from '../../services/ai/classifyIntent';

export interface ComplaintFlowState {
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
  
  // Complaint-specific
  staffNote?: {
    created: boolean;
    id?: string;
  };
}

export const ComplaintFlowAnnotation = Annotation.Root({
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
 * Handle complaint-specific flow logic
 */
export async function runComplaintFlow(state: ComplaintFlowState): Promise<ComplaintFlowState> {
  logger.debug('COMPLAINT_FLOW', 'Running complaint flow', {
    message: state.message,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    // Filter for complaint intents only
    const complaintIntents = state.classifiedIntent?.intents.filter(
      intent => intent.type === 'complaint'
    ) || [];

    if (complaintIntents.length === 0) {
      logger.warn('COMPLAINT_FLOW', 'No complaint intents found');
      return {
        ...state,
        error: 'No complaint intents found',
        reply: 'I apologize, but I could not identify any specific complaints in your message.'
      };
    }

    // Use conversational flow for complaint processing
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
        intents: complaintIntents
      } : undefined
    });

    if (result.error) {
      return {
        ...state,
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your complaint.'
      };
    }

    return {
      ...state,
      reply: result.reply,
      staffNote: result.staffNote
    };
  } catch (error) {
    logger.error('COMPLAINT_FLOW', 'Complaint flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message
    });

    return {
      ...state,
      error: 'Complaint flow failed',
      reply: 'I apologize, but I encountered an error processing your complaint. Please try again.'
    };
  }
}