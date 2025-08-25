import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { logger } from "../../shared/utils/logger";
import { SubChat } from "../../services/subchat/subChatManager";
import { ClassifiedOutput } from "../../services/ai/classifyIntent";
import { runRequestFlow } from "../flows/requestFlow";
import { runComplaintFlow } from "../flows/complaintFlow";
import { runUpsellFlow } from "../flows/upsellFlow";

export interface NoteFlowState {
  // Input from main flow
  message: string;
  sessionCode?: string;
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
  
  // Note flow specific state
  intentType?: 'request' | 'complaint' | 'upsell';
  
  // Flow control
  currentNode?: string;
  
  // Results
  reply?: string;
  staffNote?: any;
  error?: string;
}

export const NoteFlowAnnotation = Annotation.Root({
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
  intentType: Annotation<'request' | 'complaint' | 'upsell'>,
  currentNode: Annotation<string>,
  reply: Annotation<string>,
  staffNote: Annotation<any>,
  error: Annotation<string>,
});

async function determineIntentTypeNode(state: typeof NoteFlowAnnotation.State): Promise<Partial<typeof NoteFlowAnnotation.State>> {
  logger.debug('NOTE_FLOW', 'Determining intent type', { 
    intents: state.classifiedIntent?.intents 
  });
  
  if (!state.classifiedIntent?.intents || state.classifiedIntent.intents.length === 0) {
    return {
      error: 'No classified intent found',
      reply: 'I apologize, but I couldn\'t understand your request. Could you please rephrase it?'
    };
  }
  
  // Filter for note intents (request, complaint, upsell)
  const noteIntents = state.classifiedIntent.intents.filter((intent: any) => 
    intent.type === 'request' || intent.type === 'complaint' || intent.type === 'upsell'
  );
  
  if (noteIntents.length === 0) {
    logger.warn('NOTE_FLOW', 'No note intents found, this should not happen');
    return {
      error: 'No note intent found',
      reply: 'I apologize, but I couldn\'t understand your request. Could you please rephrase it?'
    };
  }
  
  // Get the highest confidence note intent
  const primaryIntent = noteIntents.reduce((prev: any, current: any) => 
    prev.confidence > current.confidence ? prev : current
  );
  
  const intentType = primaryIntent.type as 'request' | 'complaint' | 'upsell';
  
  logger.info('NOTE_FLOW', 'Intent type determined', { 
    intentType,
    confidence: primaryIntent.confidence,
    totalIntents: state.classifiedIntent.intents.length,
    noteIntents: noteIntents.length
  });
  
  return {
    intentType,
    currentNode: intentType === 'request' ? 'handle_request' : 
                 intentType === 'complaint' ? 'handle_complaint' : 
                 'handle_upsell'
  };
}

async function handleRequestNode(state: typeof NoteFlowAnnotation.State): Promise<Partial<typeof NoteFlowAnnotation.State>> {
  logger.debug('NOTE_FLOW', 'Delegating to request flow', { 
    message: state.message,
    guestId: state.guestId,
    subChatId: state.subChatId
  });
  
  try {
    const result = await runRequestFlow(state);
    return result;
  } catch (error) {
    logger.error('NOTE_FLOW', 'Request flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Failed to process request',
      reply: 'I apologize, but I encountered an error processing your request. Please try again.'
    };
  }
}

async function handleComplaintNode(state: typeof NoteFlowAnnotation.State): Promise<Partial<typeof NoteFlowAnnotation.State>> {
  logger.debug('NOTE_FLOW', 'Delegating to complaint flow', { 
    message: state.message,
    guestId: state.guestId,
    subChatId: state.subChatId
  });
  
  try {
    const result = await runComplaintFlow(state);
    return result;
  } catch (error) {
    logger.error('NOTE_FLOW', 'Complaint flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Failed to process complaint',
      reply: 'I apologize, but I encountered an error processing your complaint. Please try again.'
    };
  }
}

async function handleUpsellNode(state: typeof NoteFlowAnnotation.State): Promise<Partial<typeof NoteFlowAnnotation.State>> {
  logger.debug('NOTE_FLOW', 'Delegating to upsell flow', { 
    message: state.message,
    guestId: state.guestId,
    subChatId: state.subChatId
  });
  
  try {
    const result = await runUpsellFlow(state);
    return result;
  } catch (error) {
    logger.error('NOTE_FLOW', 'Upsell flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Failed to process upsell inquiry',
      reply: 'I apologize, but I encountered an error processing your inquiry. Please try again.'
    };
  }
}

// Removed helper functions - now handled in modular flows

function conditionalRouter(state: typeof NoteFlowAnnotation.State): string {
  if (state.error) {
    return END;
  }
  
  if (state.currentNode === 'handle_request') {
    return 'handle_request';
  }
  
  if (state.currentNode === 'handle_complaint') {
    return 'handle_complaint';
  }
  
  if (state.currentNode === 'handle_upsell') {
    return 'handle_upsell';
  }
  
  return END;
}

// Create the note flow sub-graph
const noteFlowGraph = new StateGraph(NoteFlowAnnotation)
  .addNode('determine_intent_type', determineIntentTypeNode)
  .addNode('handle_request', handleRequestNode)
  .addNode('handle_complaint', handleComplaintNode)
  .addNode('handle_upsell', handleUpsellNode)
  .addEdge(START, 'determine_intent_type')
  .addConditionalEdges('determine_intent_type', conditionalRouter, ['handle_request', 'handle_complaint', 'handle_upsell', END])
  .addEdge('handle_request', END)
  .addEdge('handle_complaint', END)
  .addEdge('handle_upsell', END);

export const compiledNoteFlow = noteFlowGraph.compile();

export async function runNoteFlow(input: Partial<NoteFlowState>): Promise<NoteFlowState> {
  logger.debug('NOTE_FLOW', 'Starting note flow execution', { input });
  
  try {
    const result = await compiledNoteFlow.invoke(input);
    logger.debug('NOTE_FLOW', 'Note flow completed successfully', { result });
    return result;
  } catch (error) {
    logger.error('NOTE_FLOW', 'Note flow execution failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      input 
    });
    
    return {
      ...input,
      error: 'Note flow execution failed',
      reply: 'I apologize, but I encountered an error processing your request. Please try again.'
    } as NoteFlowState;
  }
}