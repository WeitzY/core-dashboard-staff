import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { logger } from "../../shared/utils/logger";
import { supabase } from "../../shared/tools/supabaseClient";
import { runConversationalFlow } from "./conversationFlow";
import { classifyIntent, ClassifiedOutput } from "../../services/ai/classifyIntent";
import { runNoteFlow } from "./noteFlow";
import { runNonNoteFlow } from "./nonNoteFlow";
import { subChatManager, SubChat, SubChatType } from "../../services/subchat/subChatManager";

// Helper function to get hotel name
async function getHotelName(hotelId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('hotels')
      .select('name')
      .eq('id', hotelId)
      .single();
    
    if (error) {
      logger.warn('CHAT_FLOW', 'Failed to fetch hotel name', { hotelId, error });
      return 'our hotel';
    }
    
    return data?.name || 'our hotel';
  } catch (error) {
    logger.error('CHAT_FLOW', 'Error fetching hotel name', { hotelId, error });
    return 'our hotel';
  }
}

export interface ChatFlowState {
  // Core message and session data
  message: string;
  sessionCode?: string;
  hotelId: string;
  guestId?: string;
  
  // Guest info (passed from UI after onboarding)
  roomNumber?: string;
  lastName?: string;
  language?: string;
  
  // Intent classification
  classifiedIntent?: ClassifiedOutput;
  isOnboarding?: boolean;
  
  // Subchat management
  currentSubChat?: SubChat;
  subChatId?: string;
  isNewSubChat?: boolean;
  
  // Flow control
  currentNode?: string;
  nextNode?: string;
  
  // Results
  reply?: string;
  error?: string;
}

export const ChatFlowAnnotation = Annotation.Root({
  message: Annotation<string>,
  sessionCode: Annotation<string>,
  hotelId: Annotation<string>,
  guestId: Annotation<string>,
  roomNumber: Annotation<string>,
  lastName: Annotation<string>,
  language: Annotation<string>,
  classifiedIntent: Annotation<ClassifiedOutput>,
  isOnboarding: Annotation<boolean>,
  currentSubChat: Annotation<SubChat>,
  subChatId: Annotation<string>,
  isNewSubChat: Annotation<boolean>,
  currentNode: Annotation<string>,
  nextNode: Annotation<string>,
  reply: Annotation<string>,
  error: Annotation<string>,
});

// Hotel-scoped rate limiting cache (in-memory for now)
const hotelRateLimitCache = new Map<string, { count: number; resetTime: number }>();

async function checkHotelRateLimit(hotelId: string): Promise<boolean> {
  const now = Date.now();
  const key = `hotel_${hotelId}`;
  const limit = hotelRateLimitCache.get(key);
  
  if (!limit || now > limit.resetTime) {
    // Reset or initialize
    hotelRateLimitCache.set(key, { count: 1, resetTime: now + 15 * 60 * 1000 }); // 15 minutes
    return false; // Not rate limited
  }
  
  if (limit.count >= 1000) { // 1000 requests per 15 minutes per hotel
    return true; // Rate limited
  }
  
  limit.count++;
  return false;
}

async function onboardingNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Entering onboarding node', { 
    hotelId: state.hotelId,
    sessionCode: state.sessionCode
  });
  
  // Check hotel-scoped rate limiting
  if (await checkHotelRateLimit(state.hotelId)) {
    logger.warn('CHAT_FLOW', 'Hotel rate limited', { hotelId: state.hotelId });
    return {
      error: 'Too many requests sent. Please try again later.',
      reply: 'Too many requests sent. Please try again later.'
    };
  }
  
  // Validate required fields (should be provided by UI)
  if (!state.roomNumber || !state.lastName) {
    return {
      error: 'Missing required guest information',
      reply: 'Missing required guest information. Please ensure room number and last name are provided.'
    };
  }
  
  // Get hotel name for welcome message
  const hotelName = await getHotelName(state.hotelId);
  
  logger.info('CHAT_FLOW', 'Guest session initialized', {
    hotelId: state.hotelId,
    roomNumber: state.roomNumber,
    sessionCode: state.sessionCode
  });
  
  return {
    nextNode: 'classify_intent',
    isOnboarding: true,
    reply: `Welcome to ${hotelName}! How can I assist you today?`
  };
}

async function classifyIntentNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Classifying intent', { 
    message: state.message,
    roomNumber: state.roomNumber,
    lastName: state.lastName,
    guestId: state.guestId 
  });
  
  // Check if this is the first message and needs onboarding
  if (!state.roomNumber || !state.lastName) {
    logger.debug('CHAT_FLOW', 'Missing guest info, routing to onboarding');
    return {
      nextNode: 'onboarding'
    };
  }
  
  try {
    const classifiedIntent = await classifyIntent(
      state.message,
      state.language || 'en',
      state.guestId,
      state.hotelId
    );
    
    logger.info('CHAT_FLOW', 'Intent classified successfully', {
      message: state.message,
      intents: classifiedIntent.intents,
      sentiment: classifiedIntent.overall_sentiment
    });
    
    return {
      classifiedIntent,
      nextNode: 'subchat_manager'
    };
  } catch (error) {
    logger.error('CHAT_FLOW', 'Intent classification failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    // Fallback to general intent if classification fails
    return {
      classifiedIntent: {
        language: state.language || 'en',
        overall_sentiment: 'neutral',
        intents: [{ type: 'general', confidence: 1.0, details: {} }]
      },
      nextNode: 'subchat_manager'
    };
  }
}

async function subChatManagerNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Entering subchat manager', { 
    message: state.message,
    sessionCode: state.sessionCode,
    classifiedIntent: state.classifiedIntent
  });
  
  if (!state.sessionCode || !state.classifiedIntent) {
    logger.error('CHAT_FLOW', 'Missing required data for subchat management');
    return {
      error: 'Missing session or intent data',
      nextNode: 'error_handler'
    };
  }
  
  try {
    // Process multiple intents from the message
    const intentResults = subChatManager.processMultipleIntents(
      state.sessionCode,
      state.message,
      state.classifiedIntent
    );
    
    logger.info('CHAT_FLOW', 'Processed multiple intents', {
      totalIntents: intentResults.length,
      newSubChats: intentResults.filter(r => r.needsNewSubChat).length,
      existingSubChats: intentResults.filter(r => !r.needsNewSubChat).length
    });
    
    // Process all intents simultaneously - create/update subchats for each
    const processedSubChats: SubChat[] = [];
    
    for (const result of intentResults) {
      let targetSubChat: SubChat;
      
      if (result.matchedSubChat) {
        // Continue existing subchat
        targetSubChat = result.matchedSubChat;
        subChatManager.addMessage(targetSubChat.id, state.message, 'user');
        
        logger.info('CHAT_FLOW', 'Continuing existing subchat', {
          subChatId: targetSubChat.id,
          type: targetSubChat.type,
          status: targetSubChat.status,
          intentType: result.intent.type
        });
      } else {
        // Create new subchat for this intent
        const subChatType = mapIntentToSubChatType(result.intent.type);
        
        // Create filtered classified output for this specific intent
        const intentSpecificOutput: ClassifiedOutput = {
          ...state.classifiedIntent,
          intents: [result.intent]
        };
        
        targetSubChat = subChatManager.createSubChat(
          state.sessionCode,
          subChatType,
          intentSpecificOutput,
          state.message
        );
        
        logger.info('CHAT_FLOW', 'Created new subchat', {
          subChatId: targetSubChat.id,
          type: targetSubChat.type,
          intentType: result.intent.type
        });
      }
      
      processedSubChats.push(targetSubChat);
    }
    
    // For routing, prioritize the highest confidence intent
    const primaryResult = intentResults.reduce((prev, current) => 
      prev.intent.confidence > current.intent.confidence ? prev : current
    );
    
    const primarySubChat = processedSubChats.find(sc => 
      sc.type === mapIntentToSubChatType(primaryResult.intent.type)
    ) || processedSubChats[0];
    
    if (!primarySubChat) {
      logger.error('CHAT_FLOW', 'No primary subchat found after processing');
      return {
        error: 'Failed to process subchats',
        nextNode: 'error_handler'
      };
    }
    
    return {
      currentSubChat: primarySubChat,
      subChatId: primarySubChat.id,
      isNewSubChat: primaryResult.needsNewSubChat,
      nextNode: 'router'
    };
  } catch (error) {
    logger.error('CHAT_FLOW', 'Subchat management failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Subchat management failed',
      nextNode: 'error_handler'
    };
  }
}

// Helper function to map intent type to subchat type
function mapIntentToSubChatType(intentType: string): SubChatType {
  switch (intentType) {
    case 'request':
      return 'request';
    case 'complaint':
      return 'complaint';
    case 'upsell':
      return 'request'; // Treat upsells as requests
    case 'faq':
      return 'faq';
    case 'general':
      return 'general';
    default:
      return 'general';
  }
}

async function conversationalAINode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Entering conversational AI node', { 
    message: state.message,
    guestId: state.guestId 
  });
  
  try {
    const hotelName = await getHotelName(state.hotelId);
    
    const result = await runConversationalFlow({
      message: state.message,
      hotelId: state.hotelId,
      guestId: state.guestId || '',
      sessionCode: state.sessionCode || '',
      roomNumber: state.roomNumber || '',
      lastName: state.lastName || '',
      language: state.language || 'en',
      hotelName
    });
    
    if (result.error) {
      return {
        error: result.error,
        nextNode: 'error_handler'
      };
    }
    
    return {
      reply: result.reply
    };
  } catch (error) {
    logger.error('CHAT_FLOW', 'Conversational AI failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Conversational AI failed',
      nextNode: 'error_handler'
    };
  }
}

async function routerNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Routing based on subchat type', { 
    subChatId: state.subChatId,
    currentSubChat: state.currentSubChat?.type,
    isNewSubChat: state.isNewSubChat
  });
  
  if (!state.currentSubChat) {
    logger.error('CHAT_FLOW', 'No current subchat found');
    return {
      error: 'No subchat context available',
      nextNode: 'error_handler'
    };
  }
  
  // Route based on subchat type
  switch (state.currentSubChat.type) {
    case 'request':
    case 'complaint':
    case 'upsell':
      logger.info('CHAT_FLOW', 'Routing to note flow', { 
        subChatType: state.currentSubChat.type,
        subChatId: state.subChatId,
        status: state.currentSubChat.status
      });
      return {
        nextNode: 'note_flow'
      };
      
    case 'faq':
    case 'general':
      logger.info('CHAT_FLOW', 'Routing to non-note flow', { 
        subChatType: state.currentSubChat.type,
        subChatId: state.subChatId,
        status: state.currentSubChat.status
      });
      return {
        nextNode: 'non_note_flow'
      };
      
    default:
      logger.warn('CHAT_FLOW', 'Unknown subchat type, routing to non-note flow', { 
        subChatType: state.currentSubChat.type
      });
      return {
        nextNode: 'non_note_flow'
      };
  }
}

async function noteFlowNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Entering note flow', { 
    message: state.message,
    subChatId: state.subChatId,
    subChatType: state.currentSubChat?.type,
    subChatStatus: state.currentSubChat?.status
  });
  
  try {
    const result = await runNoteFlow({
      message: state.message,
      sessionCode: state.sessionCode,
      hotelId: state.hotelId,
      guestId: state.guestId,
      roomNumber: state.roomNumber,
      lastName: state.lastName,
      language: state.language,
      classifiedIntent: state.classifiedIntent,
      // Pass subchat information
      subChatId: state.subChatId,
      currentSubChat: state.currentSubChat,
      isNewSubChat: state.isNewSubChat
    });
    
    if (result.error) {
      return {
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your request.'
      };
    }
    
    // Add assistant reply to subchat if we have one
    if (state.subChatId && result.reply) {
      subChatManager.addMessage(state.subChatId, result.reply, 'assistant');
      
      // Update subchat status if flow indicates completion
      if (result.staffNote?.created) {
        subChatManager.updateSubChatStatus(state.subChatId, 'awaiting_confirmation');
      }
    }
    
    return {
      reply: result.reply
    };
  } catch (error) {
    logger.error('CHAT_FLOW', 'Note flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Note flow failed',
      reply: 'I apologize, but I encountered an error processing your request. Please try again.'
    };
  }
}

async function nonNoteFlowNode(state: typeof ChatFlowAnnotation.State): Promise<Partial<typeof ChatFlowAnnotation.State>> {
  logger.debug('CHAT_FLOW', 'Entering non-note flow', { 
    message: state.message,
    subChatId: state.subChatId,
    subChatType: state.currentSubChat?.type,
    subChatStatus: state.currentSubChat?.status
  });
  
  try {
    const result = await runNonNoteFlow({
      message: state.message,
      sessionCode: state.sessionCode,
      hotelId: state.hotelId,
      guestId: state.guestId,
      roomNumber: state.roomNumber,
      lastName: state.lastName,
      language: state.language,
      classifiedIntent: state.classifiedIntent,
      // Pass subchat information
      subChatId: state.subChatId,
      currentSubChat: state.currentSubChat,
      isNewSubChat: state.isNewSubChat
    });
    
    if (result.error) {
      return {
        error: result.error,
        reply: result.reply || 'I apologize, but I encountered an error processing your query.'
      };
    }
    
    // Add assistant reply to subchat if we have one
    if (state.subChatId && result.reply) {
      subChatManager.addMessage(state.subChatId, result.reply, 'assistant');
      
      // For FAQ/general chats, mark as resolved after providing answer
      if (state.currentSubChat?.type === 'faq' || state.currentSubChat?.type === 'general') {
        subChatManager.updateSubChatStatus(state.subChatId, 'resolved');
      }
    }
    
    return {
      reply: result.reply
    };
  } catch (error) {
    logger.error('CHAT_FLOW', 'Non-note flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Non-note flow failed',
      reply: 'I apologize, but I encountered an error processing your query. Please try again.'
    };
  }
}

function conditionalRouter(state: typeof ChatFlowAnnotation.State): string {
  if (state.error) {
    return 'error_handler';
  }
  
  if (state.nextNode === 'onboarding') {
    return 'onboarding';
  }
  
  if (state.nextNode === 'classify_intent') {
    return 'classify_intent';
  }
  
  if (state.nextNode === 'subchat_manager') {
    return 'subchat_manager';
  }
  
  if (state.nextNode === 'router') {
    return 'router';
  }
  
  if (state.nextNode === 'note_flow') {
    return 'note_flow';
  }
  
  if (state.nextNode === 'non_note_flow') {
    return 'non_note_flow';
  }
  
  if (state.nextNode === 'conversational_ai') {
    return 'conversational_ai';
  }
  
  return END;
}

function errorHandler(state: typeof ChatFlowAnnotation.State): Partial<typeof ChatFlowAnnotation.State> {
  logger.error('CHAT_FLOW', 'Error handler activated', { error: state.error });
  
  return {
    reply: 'I apologize, but I encountered an error processing your request. Please try again.',
    error: undefined // Clear the error
  };
}


// Create the root chat flow graph
const chatFlowGraph = new StateGraph(ChatFlowAnnotation)
  .addNode('onboarding', onboardingNode)
  .addNode('classify_intent', classifyIntentNode)
  .addNode('subchat_manager', subChatManagerNode)
  .addNode('router', routerNode)
  .addNode('note_flow', noteFlowNode)
  .addNode('non_note_flow', nonNoteFlowNode)
  .addNode('conversational_ai', conversationalAINode)
  .addNode('error_handler', errorHandler)
  .addEdge(START, 'classify_intent')
  .addConditionalEdges('classify_intent', conditionalRouter, ['onboarding', 'subchat_manager', 'error_handler'])
  .addConditionalEdges('onboarding', conditionalRouter, ['classify_intent', 'error_handler'])
  .addConditionalEdges('subchat_manager', conditionalRouter, ['router', 'error_handler'])
  .addConditionalEdges('router', conditionalRouter, ['note_flow', 'non_note_flow', 'error_handler'])
  .addEdge('note_flow', END)
  .addEdge('non_note_flow', END)
  .addEdge('conversational_ai', END)
  .addEdge('error_handler', END);

export const compiledChatFlow = chatFlowGraph.compile();

export async function runChatFlow(input: Partial<ChatFlowState>): Promise<ChatFlowState> {
  logger.debug('CHAT_FLOW', 'Starting chat flow execution', { input });
  
  try {
    const result = await compiledChatFlow.invoke(input);
    logger.debug('CHAT_FLOW', 'Chat flow completed successfully', { result });
    return result;
  } catch (error) {
    logger.error('CHAT_FLOW', 'Chat flow execution failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      input 
    });
    
    return {
      ...input,
      error: 'Chat flow execution failed',
      reply: 'I apologize, but I encountered an error processing your request. Please try again.'
    } as ChatFlowState;
  }
}