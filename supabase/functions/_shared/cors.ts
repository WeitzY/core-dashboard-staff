// CORS headers and response utilities for Edge Functions
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
}

export function createCorsResponse(body: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify(body),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  ) 
  
}

export function createCorsErrorResponse(error: string, status: number = 400): Response {
  return createCorsResponse({ error }, status)
}

export function handleCorsPreflightRequest(): Response {
  return new Response('ok', { headers: corsHeaders })
}
