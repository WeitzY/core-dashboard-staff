import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { logger } from "../../shared/utils/logger";
import { SubChat } from "../../services/subchat/subChatManager";
import { ClassifiedOutput } from "../../services/ai/classifyIntent";
import { runFaqFlow } from "../flows/faqFlow";
import { runGeneralFlow } from "../flows/generalFlow";

export interface NonNoteFlowState {
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
  
  // Non-note flow specific state
  intentType?: 'faq' | 'general';
  
  // Flow control
  currentNode?: string;
  
  // Results
  reply?: string;
  error?: string;
}

export const NonNoteFlowAnnotation = Annotation.Root({
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
  intentType: Annotation<'faq' | 'general'>,
  currentNode: Annotation<string>,
  reply: Annotation<string>,
  error: Annotation<string>,
});

async function determineChatTypeNode(state: typeof NonNoteFlowAnnotation.State): Promise<Partial<typeof NonNoteFlowAnnotation.State>> {
  logger.debug('NON_NOTE_FLOW', 'Determining chat type', { 
    message: state.message,
    intents: state.classifiedIntent?.intents 
  });
  
  if (!state.classifiedIntent?.intents || state.classifiedIntent.intents.length === 0) {
    logger.warn('NON_NOTE_FLOW', 'No classified intents found, defaulting to FAQ');
    return {
      intentType: 'faq',
      currentNode: 'handle_faq'
    };
  }
  
  // Filter for non-note intents (FAQ, general)
  const nonNoteIntents = state.classifiedIntent.intents.filter((intent: any) => 
    intent.type === 'faq' || intent.type === 'general'
  );
  
  if (nonNoteIntents.length === 0) {
    logger.warn('NON_NOTE_FLOW', 'No non-note intents found, this should not happen');
    return {
      intentType: 'faq',
      currentNode: 'handle_faq'
    };
  }
  
  // Get the highest confidence non-note intent
  const primaryIntent = nonNoteIntents.reduce((prev: any, current: any) => 
    prev.confidence > current.confidence ? prev : current
  );
  
  logger.info('NON_NOTE_FLOW', 'Primary intent determined', {
    intentType: primaryIntent.type,
    confidence: primaryIntent.confidence,
    totalIntents: state.classifiedIntent.intents.length,
    nonNoteIntents: nonNoteIntents.length
  });
  
  return {
    intentType: primaryIntent.type as 'faq' | 'general',
    currentNode: primaryIntent.type === 'faq' ? 'handle_faq' : 'handle_general_chat'
  };
}

async function handleFAQNode(state: typeof NonNoteFlowAnnotation.State): Promise<Partial<typeof NonNoteFlowAnnotation.State>> {
  logger.debug('NON_NOTE_FLOW', 'Delegating to FAQ flow', { 
    message: state.message,
    hotelId: state.hotelId,
    subChatId: state.subChatId
  });
  
  try {
    const result = await runFaqFlow(state);
    return result;
  } catch (error) {
    logger.error('NON_NOTE_FLOW', 'FAQ flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Failed to process FAQ query',
      reply: getHardcodedFallbackResponse(state.language || 'en')
    };
  }
}

async function handleGeneralChatNode(state: typeof NonNoteFlowAnnotation.State): Promise<Partial<typeof NonNoteFlowAnnotation.State>> {
  logger.debug('NON_NOTE_FLOW', 'Delegating to general flow', { 
    message: state.message,
    language: state.language,
    subChatId: state.subChatId
  });
  
  try {
    const result = await runGeneralFlow(state);
    return result;
  } catch (error) {
    logger.error('NON_NOTE_FLOW', 'General flow failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: state.message 
    });
    
    return {
      error: 'Failed to process general chat',
      reply: getHelpfulResponse(state.language || 'en')
    };
  }
}

// Hardcoded response functions for different languages
function getHardcodedFallbackResponse(language: string): string {
  const responses = {
    en: "I can help you with hotel-related questions, requests, and concerns. If you need assistance with something specific, please let me know how I can help!",
    es: "Puedo ayudarte con preguntas, solicitudes y preocupaciones relacionadas con el hotel. Si necesitas ayuda con algo específico, ¡por favor dime cómo puedo ayudarte!",
    fr: "Je peux vous aider avec des questions, des demandes et des préoccupations liées à l'hôtel. Si vous avez besoin d'aide pour quelque chose de spécifique, veuillez me dire comment je peux vous aider!",
    de: "Ich kann Ihnen bei hotelbezogenen Fragen, Anfragen und Anliegen helfen. Wenn Sie Hilfe bei etwas Bestimmtem benötigen, lassen Sie mich bitte wissen, wie ich Ihnen helfen kann!",
    it: "Posso aiutarti con domande, richieste e preoccupazioni relative all'hotel. Se hai bisogno di aiuto per qualcosa di specifico, per favore fammi sapere come posso aiutarti!",
    pt: "Posso ajudá-lo com perguntas, solicitações e preocupações relacionadas ao hotel. Se você precisar de ajuda com algo específico, por favor me diga como posso ajudá-lo!"
  };
  
  return responses[language as keyof typeof responses] || responses.en;
}

function getGreetingResponse(language: string, timeOfDay?: string): string {
  const responses = {
    en: {
      default: "Hello! Welcome to our hotel. How can I assist you today?",
      morning: "Good morning! Welcome to our hotel. How can I assist you today?",
      afternoon: "Good afternoon! Welcome to our hotel. How can I assist you today?",
      evening: "Good evening! Welcome to our hotel. How can I assist you today?"
    },
    es: {
      default: "¡Hola! Bienvenido a nuestro hotel. ¿Cómo puedo ayudarte hoy?",
      morning: "¡Buenos días! Bienvenido a nuestro hotel. ¿Cómo puedo ayudarte hoy?",
      afternoon: "¡Buenas tardes! Bienvenido a nuestro hotel. ¿Cómo puedo ayudarte hoy?",
      evening: "¡Buenas noches! Bienvenido a nuestro hotel. ¿Cómo puedo ayudarte hoy?"
    },
    fr: {
      default: "Bonjour! Bienvenue dans notre hôtel. Comment puis-je vous aider aujourd'hui?",
      morning: "Bonjour! Bienvenue dans notre hôtel. Comment puis-je vous aider aujourd'hui?",
      afternoon: "Bon après-midi! Bienvenue dans notre hôtel. Comment puis-je vous aider aujourd'hui?",
      evening: "Bonsoir! Bienvenue dans notre hôtel. Comment puis-je vous aider aujourd'hui?"
    }
  };
  
  const langResponses = responses[language as keyof typeof responses] || responses.en;
  return langResponses[timeOfDay as keyof typeof langResponses] || langResponses.default;
}

function getThankYouResponse(language: string): string {
  const responses = {
    en: "You're welcome! Is there anything else I can help you with?",
    es: "¡De nada! ¿Hay algo más con lo que pueda ayudarte?",
    fr: "Je vous en prie! Y a-t-il autre chose avec laquelle je peux vous aider?",
    de: "Gern geschehen! Gibt es noch etwas, womit ich Ihnen helfen kann?",
    it: "Prego! C'è qualcos'altro con cui posso aiutarti?",
    pt: "De nada! Há mais alguma coisa com que eu possa ajudá-lo?"
  };
  
  return responses[language as keyof typeof responses] || responses.en;
}

function getGoodbyeResponse(language: string): string {
  const responses = {
    en: "Thank you for choosing our hotel! Have a wonderful day!",
    es: "¡Gracias por elegir nuestro hotel! ¡Que tengas un día maravilloso!",
    fr: "Merci d'avoir choisi notre hôtel! Passez une excellente journée!",
    de: "Vielen Dank, dass Sie unser Hotel gewählt haben! Haben Sie einen wunderbaren Tag!",
    it: "Grazie per aver scelto il nostro hotel! Buona giornata!",
    pt: "Obrigado por escolher nosso hotel! Tenha um dia maravilhoso!"
  };
  
  return responses[language as keyof typeof responses] || responses.en;
}

function getHelpfulResponse(language: string): string {
  const responses = {
    en: "I'm here to help! You can ask me about hotel services, make requests, or let me know if you have any concerns.",
    es: "¡Estoy aquí para ayudar! Puedes preguntarme sobre los servicios del hotel, hacer solicitudes o decirme si tienes alguna preocupación.",
    fr: "Je suis là pour vous aider! Vous pouvez me poser des questions sur les services de l'hôtel, faire des demandes ou me faire savoir si vous avez des préoccupations.",
    de: "Ich bin da, um zu helfen! Sie können mich über Hotelservices fragen, Anfragen stellen oder mir mitteilen, wenn Sie Bedenken haben.",
    it: "Sono qui per aiutare! Puoi chiedermi informazioni sui servizi dell'hotel, fare richieste o farmi sapere se hai delle preoccupazioni.",
    pt: "Estou aqui para ajudar! Você pode me perguntar sobre os serviços do hotel, fazer solicitações ou me avisar se tiver alguma preocupação."
  };
  
  return responses[language as keyof typeof responses] || responses.en;
}

function conditionalRouter(state: typeof NonNoteFlowAnnotation.State): string {
  if (state.error) {
    return END;
  }
  
  if (state.currentNode === 'handle_faq') {
    return 'handle_faq';
  }
  
  if (state.currentNode === 'handle_general_chat') {
    return 'handle_general_chat';
  }
  
  return END;
}

// Create the non-note flow sub-graph
const nonNoteFlowGraph = new StateGraph(NonNoteFlowAnnotation)
  .addNode('determine_chat_type', determineChatTypeNode)
  .addNode('handle_faq', handleFAQNode)
  .addNode('handle_general_chat', handleGeneralChatNode)
  .addEdge(START, 'determine_chat_type')
  .addConditionalEdges('determine_chat_type', conditionalRouter, ['handle_faq', 'handle_general_chat', END])
  .addEdge('handle_faq', END)
  .addEdge('handle_general_chat', END);

export const compiledNonNoteFlow = nonNoteFlowGraph.compile();

export async function runNonNoteFlow(input: Partial<NonNoteFlowState>): Promise<NonNoteFlowState> {
  logger.debug('NON_NOTE_FLOW', 'Starting non-note flow execution', { input });
  
  try {
    const result = await compiledNonNoteFlow.invoke(input);
    logger.debug('NON_NOTE_FLOW', 'Non-note flow completed successfully', { result });
    return result;
  } catch (error) {
    logger.error('NON_NOTE_FLOW', 'Non-note flow execution failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      input 
    });
    
    return {
      ...input,
      error: 'Non-note flow execution failed',
      reply: getHardcodedFallbackResponse(input.language || 'en')
    } as NonNoteFlowState;
  }
}