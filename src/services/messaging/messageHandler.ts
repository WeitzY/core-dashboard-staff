import { logger } from '../../shared/utils/logger.js';
import { classifyIntent } from '../ai/classifyIntent.js';
import { subChatManager } from '../subchat/subChatManager.js';
import { handleOnboarding, OnboardingState, validateGuestInfo } from '../onboarding/onboardingHandler.js';
import { runNoteFlow } from '../../core/chat/noteFlow.js';
import { runNonNoteFlow } from '../../core/chat/nonNoteFlow.js';
import type { ClassifiedOutput } from '../ai/classifyIntent.js';
import type { SubChat, SubChatType } from '../subchat/subChatManager.js';

export interface MessageInput {
  message: string;
  hotelId: string;
  sessionCode?: string;
  guestId?: string;
  roomNumber?: string;
  lastName?: string;
  language?: string;
}

export interface MessageResult {
  reply: string;
  error?: string;
  guestId?: string;
  roomNumber?: string;
  lastName?: string;
  language?: string;
  isOnboarding?: boolean;
  subChatId?: string;
  staffNote?: { created: boolean; id?: string };
}

/**
 * Maps intent types to subchat types
 */
function mapIntentToSubChatType(intentType: string): SubChatType {
  switch (intentType.toLowerCase()) {
    case 'request':
    case 'request_item':
    case 'request_service':
    case 'room_service':
    case 'housekeeping':
    case 'maintenance':
    case 'transportation':
      return 'request';
    case 'complaint':
    case 'feedback_negative':
      return 'complaint';
    case 'upsell':
    case 'upgrade_request':
      return 'upsell';
    case 'faq':
    case 'policy_question':
    case 'information_request':
      return 'faq';
    case 'general':
    case 'greeting':
    case 'small_talk':
    default:
      return 'general';
  }
}

/**
 * Determines if subchat should create staff notes
 */
function shouldCreateStaffNote(subChatType: SubChatType): boolean {
  return ['request', 'complaint', 'upsell'].includes(subChatType);
}

/**
 * Core message processing function
 */
export async function processMessage(input: MessageInput): Promise<MessageResult> {
  logger.debug('MESSAGE_HANDLER', 'Processing message', {
    hotelId: input.hotelId,
    hasGuestId: !!input.guestId,
    messageLength: input.message.length
  });

  try {
    // Step 1: Handle onboarding if guest info is incomplete
    const onboardingState: OnboardingState = {
      message: input.message,
      hotelId: input.hotelId,
      guestId: input.guestId,
      roomNumber: input.roomNumber,
      lastName: input.lastName,
      language: input.language
    };

    if (!validateGuestInfo(onboardingState)) {
      logger.debug('MESSAGE_HANDLER', 'Guest info incomplete, handling onboarding');
      const onboardingResult = await handleOnboarding(onboardingState);
      
      if (onboardingResult.error) {
        return {
          reply: onboardingResult.reply || 'Welcome! Could you please provide your room number and last name?',
          error: onboardingResult.error,
          isOnboarding: true
        };
      }
      
      if (!onboardingResult.isComplete) {
        return {
          reply: onboardingResult.reply || 'Please provide your room number and last name.',
          isOnboarding: true,
          guestId: onboardingResult.guestId,
          roomNumber: onboardingResult.roomNumber,
          lastName: onboardingResult.lastName,
          language: onboardingResult.language
        };
      }

      // Update input with extracted guest info
      input.guestId = onboardingResult.guestId;
      input.roomNumber = onboardingResult.roomNumber;
      input.lastName = onboardingResult.lastName;
      input.language = onboardingResult.language;
    }

    // Step 2: Classify intent
    logger.debug('MESSAGE_HANDLER', 'Classifying intent');
    const classifiedIntent = await classifyIntent(input.message, input.language || 'en');
    
    if (!classifiedIntent) {
      logger.warn('MESSAGE_HANDLER', 'Intent classification failed');
      return {
        reply: 'I apologize, but I had trouble understanding your request. Could you please rephrase it?',
        error: 'Intent classification failed'
      };
    }

    // Step 3: Find or create appropriate subchat
    logger.debug('MESSAGE_HANDLER', 'Managing subchat', {
      intents: classifiedIntent.intents?.map(i => i.type) || []
    });

    const primaryIntent = classifiedIntent.intents?.[0];
    if (!primaryIntent) {
      return {
        reply: 'I apologize, but I had trouble understanding your request. Could you please try again?',
        error: 'No primary intent found'
      };
    }

    const subChatType = mapIntentToSubChatType(primaryIntent.type);
    
    // Find existing subchat or create new one
    const sessionCode = input.sessionCode || `${input.guestId}_${input.hotelId}`;
    const existingSubChat = subChatManager.findMatchingSubChat(
      sessionCode,
      input.message,
      classifiedIntent,
      primaryIntent.type
    );
    
    let currentSubChat: SubChat;
    let isNewSubChat: boolean;
    
    if (existingSubChat) {
      currentSubChat = existingSubChat;
      isNewSubChat = false;
    } else {
      currentSubChat = subChatManager.createSubChat(
        sessionCode,
        subChatType,
        classifiedIntent,
        input.message
      );
      isNewSubChat = true;
    }
    
    const subChatId = currentSubChat.id;

    if (!currentSubChat) {
      logger.error('MESSAGE_HANDLER', 'Failed to get subchat after creation', { subChatId });
      return {
        reply: 'I apologize, but I encountered an error processing your request. Please try again.',
        error: 'Subchat creation failed'
      };
    }

    // Add user message to subchat
    subChatManager.addMessage(subChatId, input.message, 'user');

    // Step 4: Route to appropriate flow based on subchat type
    const flowInput = {
      message: input.message,
      sessionCode: input.sessionCode || '',
      hotelId: input.hotelId,
      guestId: input.guestId || '',
      roomNumber: input.roomNumber || '',
      lastName: input.lastName || '',
      language: input.language || 'en',
      classifiedIntent,
      subChatId,
      currentSubChat,
      isNewSubChat
    };

    let flowResult: any;
    let hasStaffNote = false;
    
    if (shouldCreateStaffNote(subChatType)) {
      // Route to note flow for requests, complaints, upsells
      logger.debug('MESSAGE_HANDLER', 'Routing to note flow', { subChatType });
      flowResult = await runNoteFlow(flowInput);
      hasStaffNote = !!(flowResult as any).staffNote?.created;
    } else {
      // Route to non-note flow for FAQ, general queries
      logger.debug('MESSAGE_HANDLER', 'Routing to non-note flow', { subChatType });
      flowResult = await runNonNoteFlow(flowInput);
    }

    if (flowResult.error) {
      return {
        reply: flowResult.reply || 'I apologize, but I encountered an error processing your request.',
        error: flowResult.error,
        subChatId
      };
    }

    // Step 5: Update subchat with assistant response
    if (flowResult.reply) {
      subChatManager.addMessage(subChatId, flowResult.reply, 'assistant');
      
      // Update subchat status based on flow result
      if (hasStaffNote) {
        subChatManager.updateSubChatStatus(subChatId, 'awaiting_confirmation');
      } else if (subChatType === 'faq' || subChatType === 'general') {
        subChatManager.updateSubChatStatus(subChatId, 'resolved');
      }
    }

    logger.debug('MESSAGE_HANDLER', 'Message processed successfully', {
      subChatId,
      subChatType,
      hasStaffNote: !!flowResult.staffNote?.created
    });

    return {
      reply: flowResult.reply,
      guestId: input.guestId,
      roomNumber: input.roomNumber,
      lastName: input.lastName,
      language: input.language,
      subChatId,
      staffNote: flowResult.staffNote
    };

  } catch (error) {
    logger.error('MESSAGE_HANDLER', 'Error processing message', {
      error: error instanceof Error ? error.message : 'Unknown error',
      hotelId: input.hotelId
    });

    return {
      reply: 'I apologize, but I encountered an error processing your request. Please try again.',
      error: 'Message processing failed'
    };
  }
} 