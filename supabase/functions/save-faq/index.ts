import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { 
  createCorsResponse, 
  createCorsErrorResponse, 
  handleCorsPreflightRequest 
} from '../_shared/cors.ts'
import { processFAQ, type FAQInput } from './faqProcessor.ts'

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest()
  }

  try {
    // Validate method
    if (req.method !== 'POST') {
      return createCorsErrorResponse('Method not allowed. Use POST.', 405)
    }

    // Parse request body
    let requestData: { hotelId: string; faq: FAQInput }
    try {
      requestData = await req.json()
    } catch {
      return createCorsErrorResponse('Invalid JSON format in request body', 400)
    }

    const { hotelId, faq } = requestData

    // Validate required fields
    if (!hotelId || typeof hotelId !== 'string') {
      return createCorsErrorResponse('Hotel ID is required and must be a string', 400)
    }

    if (!faq || typeof faq !== 'object') {
      return createCorsErrorResponse('FAQ data is required and must be an object', 400)
    }

    if (!faq.title || typeof faq.title !== 'string') {
      return createCorsErrorResponse('FAQ title is required and must be a string', 400)
    }

    if (!faq.content || typeof faq.content !== 'string') {
      return createCorsErrorResponse('FAQ content is required and must be a string', 400)
    }

    // Process FAQ
    const result = await processFAQ(hotelId, faq)

    return createCorsResponse(result)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('FAQ processing error:', errorMessage)
    
    return createCorsErrorResponse('Internal server error. Please try again later.', 500)
  }
})