import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { 
  createCorsResponse, 
  createCorsErrorResponse, 
  handleCorsPreflightRequest 
} from '../_shared/cors.ts'
import { processItem, type ItemInput } from './itemProcessor.ts'

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
    let requestData: { hotelId: string; item: ItemInput }
    try {
      requestData = await req.json()
    } catch {
      return createCorsErrorResponse('Invalid JSON format in request body', 400)
    }

    const { hotelId, item } = requestData

    // Validate required fields
    if (!hotelId || typeof hotelId !== 'string') {
      return createCorsErrorResponse('Hotel ID is required and must be a string', 400)
    }

    if (!item || typeof item !== 'object') {
      return createCorsErrorResponse('Item data is required and must be an object', 400)
    }

    if (!item.item || typeof item.item !== 'string') {
      return createCorsErrorResponse('Item name is required and must be a string', 400)
    }

    if (!item.department || typeof item.department !== 'string') {
      return createCorsErrorResponse('Item department is required and must be a string', 400)
    }

    if (item.description && typeof item.description !== 'string') {
      return createCorsErrorResponse('Item description must be a string if provided', 400)
    }

    // Process item
    const result = await processItem(hotelId, item)

    return createCorsResponse(result)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('Item processing error:', errorMessage)
    
    return createCorsErrorResponse('Internal server error. Please try again later.', 500)
  }
})