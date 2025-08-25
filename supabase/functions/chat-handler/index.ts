import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { 
  createCorsResponse, 
  createCorsErrorResponse, 
  handleCorsPreflightRequest,
} from '../_shared/cors.ts'
import { validateChatRequest } from '../_shared/validation.ts'
import { processChatMessage } from './chatProcessor.ts'

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest()
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    return createCorsErrorResponse('Method not allowed. Only POST requests are supported.', 405)
  }

  try {
    // Validate and parse request
    const validation = await validateChatRequest(req)
    if (!validation.isValid) {
      return createCorsErrorResponse(validation.error!, 400)
    }

    // Process the chat message
    const result = await processChatMessage(validation.data!)
    
    return createCorsResponse(result)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('Chat processing error:', errorMessage)
    
    return createCorsErrorResponse(
      'Internal server error. Please try again later.',
      500
    )
  }
})