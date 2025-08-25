// Enhanced AI processing with vector search capabilities for hotel-specific data
import { createSupabaseServiceClient } from '../_shared/supabaseClient.ts'
import { getEmbedding } from '../_shared/embeddings.ts'

export interface AIResponse {
  guestResponse: string
  staffSummary: string
  department: string
  canHandle: boolean
  isFAQ: boolean
}

interface VectorSearchResult {
  items: Array<{id: string, item: string, description: string, similarity: number}>
  faqs: Array<{id: string, title: string, content: string, similarity: number}>
}

// Vector search for hotel-specific data
async function searchHotelData(message: string, hotelId: string): Promise<VectorSearchResult> {
  const supabase = createSupabaseServiceClient()
  
  try {
    // Generate embedding for the user message
    const messageEmbedding = await getEmbedding(message)
    
    // Search items using vector similarity (initial threshold: 0.4)
    const { data: items, error: itemsError } = await supabase.rpc(
      'search_items_by_similarity',
      {
        query_embedding: messageEmbedding,
        hotel_id: hotelId,
        similarity_threshold: 0.4,
        match_limit: 5
      }
    )

    // Search FAQs using vector similarity (initial threshold: 0.4)  
    const { data: faqs, error: faqsError } = await supabase.rpc(
      'search_faqs_by_similarity',
      {
        query_embedding: messageEmbedding,
        hotel_id: hotelId,
        similarity_threshold: 0.4,
        match_limit: 3
      }
    )

    if (itemsError) {
      console.error('Items search error:', itemsError)
    }
    if (faqsError) {
      console.error('FAQs search error:', faqsError)
    }

    // If nothing found, retry once with a more permissive threshold
    const initialItems = items || []
    const initialFaqs = faqs || []

    if (initialItems.length === 0 && initialFaqs.length === 0) {
      const { data: retryItems } = await supabase.rpc(
        'search_items_by_similarity',
        {
          query_embedding: messageEmbedding,
          hotel_id: hotelId,
          similarity_threshold: 0.2,
          match_limit: 10
        }
      )

      const { data: retryFaqs } = await supabase.rpc(
        'search_faqs_by_similarity',
        {
          query_embedding: messageEmbedding,
          hotel_id: hotelId,
          similarity_threshold: 0.2,
          match_limit: 5
        }
      )

      return {
        items: retryItems || [],
        faqs: retryFaqs || []
      }
    }

    return { items: initialItems, faqs: initialFaqs }
  } catch (error) {
    console.error('Vector search error:', error)
    return { items: [], faqs: [] }
  }
}

export async function processMessage(
  message: string, 
  departments: string[], 
  roomNumber: string,
  hotelId: string,
  language?: string
): Promise<AIResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const isEnglish = !language || language.toLowerCase() === 'en' || language.toLowerCase() === 'english'
  
  // Perform vector search for hotel-specific data
  const searchResults = await searchHotelData(message, hotelId)
  const hasRelevantData = searchResults.items.length > 0 || searchResults.faqs.length > 0
  const inferredIsFAQ = searchResults.items.length === 0 && searchResults.faqs.length > 0

  // Enhanced function schema following OpenAI best practices
  const functionSchema = {
    type: "function",
    function: {
      name: "process_hotel_message",
      description: "Process a hotel guest message and generate appropriate responses based on available hotel data",
      parameters: {
        type: "object",
        properties: {
          canHandle: {
            type: "boolean",
            description: "Whether this request can be handled based on available hotel services/items/information. Set to false if the request is outside hotel capabilities."
          },
          guestResponse: {
            type: "string",
            description: `A friendly, professional response to the guest for room ${roomNumber}. If canHandle is false, politely explain that you cannot assist with this specific request and suggest contacting the front desk. Always respond in ${isEnglish ? 'English' : language}.`
          },
          staffSummary: {
            type: "string", 
            description: "One clear, actionable sentence in English for hotel staff describing what needs to be done. Include room number and specific details."
          },
          department: {
            type: "string",
            enum: departments,
            description: `The most appropriate department to handle this request. Must be exactly one of: ${departments.join(', ')}`
          }
        },
        required: ["canHandle", "guestResponse", "staffSummary", "department"],
        additionalProperties: false
      }
    }
  }

  // Build context with hotel-specific data
  let contextMessage = `Guest in room ${roomNumber}: "${message}"`
  
  if (hasRelevantData) {
    contextMessage += "\n\nAvailable hotel services/items for this request:"
    
    if (searchResults.items.length > 0) {
      contextMessage += "\nItems/Services:"
      searchResults.items.forEach(item => {
        contextMessage += `\n- ${item.item}${item.description ? `: ${item.description}` : ''}`
      })
    }
    
    if (searchResults.faqs.length > 0) {
      contextMessage += "\nRelevant Information:"
      searchResults.faqs.forEach(faq => {
        contextMessage += `\n- ${faq.title}: ${faq.content}`
      })
    }
  } else {
    // Provide soft hints to encourage matches even if vectors are sparse
    contextMessage += "\n\nNote: Hotel data may be limited. If the request looks like a common service (e.g., towels, amenities, check-in/out times, room service), treat it as supported when reasonable."
  }

  const systemContent = `You are a professional hotel AI assistant. Your role is to:
1. Analyze guest requests against available hotel services and information
2. Only confirm requests that match available hotel data
3. Politely decline requests outside hotel capabilities
4. Always be helpful, professional, and specific about room ${roomNumber}
${isEnglish ? '' : `5. Respond to guests in ${language}, but provide staff summaries in English`}

Guidelines:
- If hotel data shows relevant services/items OR a close match exists, set canHandle to true
- If no relevant hotel data exists, set canHandle to false and suggest contacting front desk
- Be specific about room number in all responses
- Keep responses concise but warm and professional`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemContent
        },
        {
          role: 'user',
          content: contextMessage
        }
      ],
      tools: [functionSchema],
      tool_choice: { type: "function", function: { name: "process_hotel_message" } },
      max_tokens: 400,  // Increased for more detailed responses
      temperature: 0.2,  // Lower for more consistent, predictable responses
      frequency_penalty: 0.1  // Slight penalty to avoid repetition
    })
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorData}`)
  }

  const data = await response.json()
  
  if (!data.choices?.[0]?.message) {
    throw new Error('Invalid response from OpenAI API')
  }

  const messageResponse = data.choices[0].message
  
  // Validate function call
  if (!messageResponse.tool_calls?.[0]) {
    throw new Error('OpenAI did not call the expected function')
  }

  const toolCall = messageResponse.tool_calls[0]
  
  if (toolCall.type !== 'function' || toolCall.function.name !== 'process_hotel_message') {
    throw new Error('OpenAI called unexpected function')
  }

  type ToolResponse = Omit<AIResponse, 'isFAQ'>
  let toolResponse: ToolResponse
  try {
    toolResponse = JSON.parse(toolCall.function.arguments)
  } catch (error) {
    throw new Error(`Failed to parse OpenAI function arguments: ${error}`)
  }

  // Validate required fields
  if (typeof toolResponse.canHandle !== 'boolean' || 
      !toolResponse.guestResponse || 
      !toolResponse.staffSummary || 
      !toolResponse.department) {
    throw new Error('AI response missing required fields')
  }

  // Validate department
  if (!departments.includes(toolResponse.department)) {
    console.warn(`Invalid department ${toolResponse.department}, falling back to ${departments[0]}`)
    toolResponse.department = departments[0] || 'front_desk'
  }

  // Enrich with deterministic FAQ flag based on vector matches
  const enriched: AIResponse = { ...toolResponse, isFAQ: inferredIsFAQ }
  return enriched
}
