import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { searchHotelItemsTool } from "../../shared/tools/searchHotelItems";
import { createStaffNoteTool } from "../../shared/tools/createStaffNote";
import { searchFAQTool } from "../../shared/tools/searchFAQ";
import { getRequestStatusTool } from "../../shared/tools/getRequestStatus";
import { updateRequestTool } from "../../shared/tools/updateRequest";
import { getConversationHistoryForGPT, saveMessage } from "../../db/supabase/getConversationHistory";
import { logger } from "../../shared/utils/logger";
import { Annotation } from "@langchain/langgraph";
import { SubChat } from "../../services/subchat/subChatManager";
import { ClassifiedOutput } from "../../services/ai/classifyIntent";

// Enhanced state for conversational AI
export interface ConversationState {
  messages: BaseMessage[];
  hotelId: string;
  guestId: string;
  sessionCode: string;
  roomNumber: string;
  lastName: string;
  language: string;
  hotelName: string;
  
  // Subchat context
  subChatId?: string;
  currentSubChat?: SubChat;
  isNewSubChat?: boolean;
  classifiedIntent?: ClassifiedOutput;
  
  reply?: string;
  error?: string;
  staffNote?: { created: boolean; id?: string };
}

export const ConversationAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  hotelId: Annotation<string>,
  guestId: Annotation<string>,
  sessionCode: Annotation<string>,
  roomNumber: Annotation<string>,
  lastName: Annotation<string>,
  language: Annotation<string>,
  hotelName: Annotation<string>,
  subChatId: Annotation<string>,
  currentSubChat: Annotation<SubChat>,
  isNewSubChat: Annotation<boolean>,
  classifiedIntent: Annotation<ClassifiedOutput>,
  reply: Annotation<string>,
  error: Annotation<string>,
  staffNote: Annotation<{ created: boolean; id?: string }>,
});

// Initialize the ChatOpenAI model with tools
const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.7,
}).bindTools([
  searchHotelItemsTool,
  createStaffNoteTool,
  searchFAQTool,
  getRequestStatusTool,
  updateRequestTool,
]);

// System prompt for the conversational AI - optimized for GPT-4o-mini with modern best practices
function getSystemPrompt(state: ConversationState): string {
  return `# Role and Objective
You are the professional AI concierge for ${state.hotelName}. Your objective is to provide exceptional guest service while maintaining a natural, empathetic conversation style.

# Guest Context
- Name: ${state.lastName}
- Room: ${state.roomNumber}
- Language: ${state.language}
- Hotel: ${state.hotelName}

# Instructions

## Core Behavior
- Use warm, professional, and conversational language
- Show genuine empathy and understanding for guest needs
- Be proactive in offering relevant assistance
- Always aim to exceed guest expectations

## Conversation Management
${state.currentSubChat ? getSubChatInstructions(state.currentSubChat) : getGeneralInstructions()}

## Tool Usage Guidelines
- Use tools strategically when you need specific information
- Always search for items/services before making assumptions
- Create staff notes for actionable requests that require human intervention
- Check request status when guests ask about previous requests

## Response Requirements
- Provide complete, helpful responses that address the guest's needs
- Ask clarifying questions when needed to better assist
- Offer related services or alternatives when appropriate
- Keep responses focused and relevant to the current conversation

# Available Tools
${state.currentSubChat ? getRelevantToolsForSubChat(state.currentSubChat) : getAllToolsDescription()}

# Output Format
Respond directly to the guest in a natural, conversational manner. Use tools when needed to gather information or take action, then incorporate the results into your response seamlessly.

# Context for Current Conversation
${state.currentSubChat ? getSubChatContext(state.currentSubChat) : 'New conversation - be welcoming and ready to assist with any guest needs.'}

# Final Instructions
Think step by step about what the guest needs. Use tools proactively to gather accurate information. Always prioritize the guest's experience and satisfaction.`;
}

// Get subchat-specific instructions
function getSubChatInstructions(subchat: SubChat): string {
  switch (subchat.type) {
    case 'request':
      return `- This is a REQUEST conversation about: ${subchat.context.itemName || 'hotel services'}
- Help the guest complete their request with all necessary details
- Use searchHotelItems to verify availability and provide accurate information
- Create a staff note when the request is clear and complete
- Confirm timing, quantity, and special requirements
- Status: ${subchat.status}`;
    
    case 'complaint':
      return `- This is a COMPLAINT conversation about: ${subchat.context.complaintSummary || 'a guest concern'}
- Listen empathetically and acknowledge the guest's frustration
- Gather all relevant details about the issue
- Create a staff note to escalate the complaint appropriately
- Offer immediate assistance where possible
- Status: ${subchat.status}`;
    
    case 'upsell':
      return `- This is an UPSELL conversation about premium services or upgrades
- Present options that genuinely add value for the guest
- Use searchHotelItems to find relevant premium offerings
- Be consultative, not pushy - focus on guest benefits
- Create a staff note if the guest shows interest
- Status: ${subchat.status}`;
    
    case 'faq':
      return `- This is an INFORMATIONAL conversation about: ${subchat.context.faqQuery || 'hotel policies/information'}
- Provide accurate, comprehensive information
- Use searchFAQ to find the most current policies
- Offer additional helpful details beyond just answering the question
- Status: ${subchat.status}`;
    
    case 'general':
      return `- This is a GENERAL conversation
- Be welcoming and ready to assist with various needs
- Guide the conversation toward actionable assistance
- Use appropriate tools based on what the guest needs
- Status: ${subchat.status}`;
    
    default:
      return `- Continue the conversation naturally based on the guest's needs
- Status: ${subchat.status}`;
  }
}

// Get general instructions for new conversations
function getGeneralInstructions(): string {
  return `- This is a new conversation - be welcoming and attentive
- Listen carefully to understand what type of assistance the guest needs
- Guide the conversation toward providing meaningful help
- Be ready to assist with requests, answer questions, or address concerns`;
}

// Get all tools description for general conversations
function getAllToolsDescription(): string {
  return `- searchHotelItems: Search for hotel amenities, services, room service items, and facilities
- createStaffNote: Create requests, complaints, or upsell opportunities for staff to handle
- searchFAQ: Search hotel policies, procedures, and general information
- getRequestStatus: Check the status of previous guest requests
- updateRequest: Cancel, modify, or mark existing requests as urgent`;
}

// Get context-specific information for the subchat
function getSubChatContext(subchat: SubChat): string {
  const messageHistory = subchat.messages
    .slice(-5) // Last 5 messages for context
    .map(msg => `${msg.role}: ${msg.content}`)
    .join('\n');

  let contextInfo = `Conversation Type: ${subchat.type.toUpperCase()}\nStatus: ${subchat.status}\n\n`;
  
  if (subchat.context.itemName) {
    contextInfo += `Item/Service: ${subchat.context.itemName}\n`;
  }
  
  if (subchat.context.complaintSummary) {
    contextInfo += `Complaint Summary: ${subchat.context.complaintSummary}\n`;
  }
  
  if (subchat.context.faqQuery) {
    contextInfo += `FAQ Query: ${subchat.context.faqQuery}\n`;
  }
  
  if (subchat.context.quantity) {
    contextInfo += `Quantity: ${subchat.context.quantity}\n`;
  }
  
  if (subchat.context.timingPreference) {
    contextInfo += `Timing: ${subchat.context.timingPreference}\n`;
  }

  contextInfo += `\nRecent Messages:\n${messageHistory}`;
  
  return contextInfo;
}

// Get relevant tools for the subchat type
function getRelevantToolsForSubChat(subchat: SubChat): string {
  switch (subchat.type) {
    case 'request':
      return `- searchHotelItems: Find hotel amenities and services
- createStaffNote: Create requests for staff
- getRequestStatus: Check status of this request
- updateRequest: Cancel, modify, or mark request as urgent`;
    
    case 'complaint':
      return `- createStaffNote: Create complaints for staff
- getRequestStatus: Check status of this complaint
- updateRequest: Cancel or modify the complaint`;
    
    case 'upsell':
      return `- searchHotelItems: Find premium amenities and services
- createStaffNote: Create upsell opportunities for staff
- getRequestStatus: Check status of this upsell inquiry`;
    
    case 'faq':
      return `- searchFAQ: Search hotel policies and general information
- searchHotelItems: Find hotel amenities and services (if relevant)`;
    
    case 'general':
      return `- searchFAQ: Search hotel policies and general information
- searchHotelItems: Find hotel amenities and services
- createStaffNote: Create requests if needed`;
    
    default:
      return `- searchHotelItems: Find hotel amenities and services
- createStaffNote: Create requests, complaints, or upsells for staff
- searchFAQ: Search hotel policies and general information`;
  }
}

// Load conversation history and prepare messages (context-minimized for subchat)
async function loadConversationHistory(state: ConversationState): Promise<Partial<ConversationState>> {
  logger.debug('CONVERSATION_FLOW', 'Loading conversation history', {
    guestId: state.guestId,
    hotelId: state.hotelId,
    subChatId: state.subChatId,
    isNewSubChat: state.isNewSubChat
  });

  try {
    const messages: BaseMessage[] = [
      new HumanMessage(getSystemPrompt(state))
    ];
    
    // If we have a subchat, use its message history instead of full conversation history
    if (state.currentSubChat && !state.isNewSubChat) {
      logger.debug('CONVERSATION_FLOW', 'Using subchat message history', {
        subChatId: state.subChatId,
        messageCount: state.currentSubChat.messages.length
      });
      
      // Add subchat-specific messages (excluding the current user message)
      state.currentSubChat.messages.forEach(msg => {
        if (msg.role === 'user') {
          messages.push(new HumanMessage(msg.content));
        } else {
          messages.push(new AIMessage(msg.content));
        }
      });
    } else {
      // For new subchats or when no subchat context, load minimal recent history
      logger.debug('CONVERSATION_FLOW', 'Loading minimal recent history for new subchat');
      
      const history = await getConversationHistoryForGPT(state.guestId, state.hotelId, 5); // Only last 5 messages
      
      // Add conversation history
      history.forEach(msg => {
        if (msg.role === 'user') {
          messages.push(new HumanMessage(msg.content));
        } else {
          messages.push(new AIMessage(msg.content));
        }
      });
    }
    
    return { messages };
    
  } catch (error) {
    logger.error('CONVERSATION_FLOW', 'Error loading conversation history', { error });
    
    // Return system prompt only if history loading fails
    return { 
      messages: [new HumanMessage(getSystemPrompt(state))]
    };
  }
}

// Main conversational AI node
async function conversationalAI(state: ConversationState): Promise<Partial<ConversationState>> {
  logger.debug('CONVERSATION_AI', 'Processing conversation', {
    guestId: state.guestId,
    messagesCount: state.messages.length
  });

  try {
    // Get the latest message (should be the user's input)
    const latestMessage = state.messages[state.messages.length - 1];
    
    if (!latestMessage) {
      return {
        error: 'No message to process',
        reply: 'I didn\'t receive your message. Could you please try again?'
      };
    }

    // Create context for the AI with tools
    const messagesWithContext = [
      new HumanMessage(getSystemPrompt(state)),
      ...state.messages,
    ];

    // Generate response using OpenAI with tools
    const response = await model.invoke(messagesWithContext);
    
    // Handle tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      logger.debug('CONVERSATION_AI', 'Tool calls detected', {
        toolCalls: response.tool_calls.map(tc => tc.name)
      });
      
      // The model will handle tool calling automatically
      // The response will include the tool results
    }

    const reply = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    
    // Save the conversation to database
    await saveMessage(state.guestId, state.hotelId, latestMessage.content.toString(), 'user');
    await saveMessage(state.guestId, state.hotelId, reply, 'assistant');
    
    logger.debug('CONVERSATION_AI', 'Response generated successfully', {
      guestId: state.guestId,
      replyLength: reply.length,
      toolCallsCount: response.tool_calls?.length || 0
    });

    return {
      reply,
      messages: [response]
    };

  } catch (error) {
    logger.error('CONVERSATION_AI', 'Error in conversational AI', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId: state.guestId
    });

    return {
      error: 'Conversational AI failed',
      reply: 'I apologize, but I encountered an error processing your request. Please try again or contact the front desk for assistance.'
    };
  }
}

// Create the conversational flow graph
const conversationGraph = new StateGraph(ConversationAnnotation)
  .addNode('load_history', loadConversationHistory)
  .addNode('conversational_ai', conversationalAI)
  .addEdge(START, 'load_history')
  .addEdge('load_history', 'conversational_ai')
  .addEdge('conversational_ai', END);

export const compiledConversationFlow = conversationGraph.compile();

// Main function to run conversational flow
export async function runConversationalFlow(input: {
  message: string;
  hotelId: string;
  guestId: string;
  sessionCode: string;
  roomNumber: string;
  lastName: string;
  language: string;
  hotelName: string;
  
  // Subchat context
  subChatId?: string;
  currentSubChat?: SubChat;
  isNewSubChat?: boolean;
  classifiedIntent?: ClassifiedOutput;
}): Promise<{ reply: string; error?: string; staffNote?: { created: boolean; id?: string } }> {
  logger.debug('CONVERSATION_FLOW', 'Starting conversational flow', {
    guestId: input.guestId,
    hotelId: input.hotelId,
    message: input.message.slice(0, 100) + '...'
  });

  try {
    // Add the user's message to the conversation
    const userMessage = new HumanMessage(input.message);
    
    const state: ConversationState = {
      messages: [userMessage],
      hotelId: input.hotelId,
      guestId: input.guestId,
      sessionCode: input.sessionCode,
      roomNumber: input.roomNumber,
      lastName: input.lastName,
      language: input.language,
      hotelName: input.hotelName,
      
      // Subchat context
      subChatId: input.subChatId,
      currentSubChat: input.currentSubChat,
      isNewSubChat: input.isNewSubChat,
      classifiedIntent: input.classifiedIntent
    };

    const result = await compiledConversationFlow.invoke(state);
    
    logger.debug('CONVERSATION_FLOW', 'Conversational flow completed', {
      guestId: input.guestId,
      reply: result.reply?.slice(0, 100) + '...'
    });

    return {
      reply: result.reply || 'I apologize, but I couldn\'t generate a response. Please try again.',
      error: result.error,
      staffNote: result.staffNote
    };

  } catch (error) {
    logger.error('CONVERSATION_FLOW', 'Conversational flow failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId: input.guestId,
      hotelId: input.hotelId
    });

    return {
      reply: 'I apologize, but I encountered an error processing your request. Please try again or contact the front desk for assistance.',
      error: 'Conversational flow execution failed'
    };
  }
}