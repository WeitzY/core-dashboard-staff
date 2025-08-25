// Request validation using Zod for better type safety and validation
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts"

// Security: Check for SQL injection patterns
function containsSQLInjection(input: string): boolean {
  const sqlPatterns = [
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b/i,
    /(--|\/\*|\*\/)/,
    /\b(OR|AND)\b.*=/i,
    /[;|&]/,
    /\bxp_cmdshell\b/i,
    /\bsp_executesql\b/i
  ]
  
  return sqlPatterns.some(pattern => pattern.test(input))
}

// Security: Sanitize string input
function sanitizeString(input: string): string {
  const CONTROL_CHARS = /\p{Cc}/gu; // Unicode control characters
  return input
    .trim()
    .replace(CONTROL_CHARS, '')  // Remove control characters
    .replace(/[<>'"&`]/g, '')    // Remove potential XSS chars
    .substring(0, 1000);         // Limit length for safety
}

// Zod schema for chat request validation
const ChatRequestSchema = z.object({
  message: z.string()
    .min(5, "Message too short. Minimum 5 characters required.")
    .max(2000, "Message too long. Maximum 2000 characters allowed.")
    .refine(
      (val: string) => !containsSQLInjection(val), 
      "Invalid characters in message"
    ),
  hotelId: z.string()
    .uuid("Hotel ID must be a valid UUID")
    .transform((val: string) => val.toLowerCase()),
  lastName: z.string()
    .min(1, "Last name is required")
    .max(50, "Last name is too long")
    .regex(/^[a-zA-Z\s\-']+$/, "Last name contains invalid characters"),
  roomNumber: z.string()
    .min(1, "Room number is required")
    .max(20, "Room number is too long")
    .regex(/^[a-zA-Z0-9\-_.]+$/, "Room number contains invalid characters"),
  language: z.string()
    .max(10, "Language code is too long")
    .optional(),
  sessionCode: z.string()
    .max(100, "Session code is too long")
    .optional(),
  guestId: z.string()
    .uuid("Guest ID must be a valid UUID")
    .transform((val: string) => val.toLowerCase())
    .optional()
}).transform((data: {
  message: string
  hotelId: string
  lastName: string
  roomNumber: string
  language?: string
  sessionCode?: string
  guestId?: string
}) => ({
  ...data,
  message: sanitizeString(data.message),
  lastName: sanitizeString(data.lastName),
  roomNumber: sanitizeString(data.roomNumber),
  language: data.language ? sanitizeString(data.language) : undefined,
  sessionCode: data.sessionCode ? sanitizeString(data.sessionCode) : undefined
}))

export type ChatRequest = z.infer<typeof ChatRequestSchema>

export interface ValidationResult {
  isValid: boolean
  error?: string
  data?: ChatRequest
}



export async function validateChatRequest(req: Request): Promise<ValidationResult> {
  // Validate method
  if (req.method !== 'POST') {
    return { isValid: false, error: 'Method not allowed. Use POST.' }
  }

  // Parse JSON with size limit
  let requestData: unknown
  try {
    const body = await req.text()
    
    // Security: Limit request body size
    if (body.length > 10000) {
      return { isValid: false, error: 'Request body too large' }
    }
    
    requestData = JSON.parse(body)
  } catch {
    return { isValid: false, error: 'Invalid JSON format in request body' }
  }

  // Security: Ensure requestData is an object
  if (!requestData || typeof requestData !== 'object' || Array.isArray(requestData)) {
    return { isValid: false, error: 'Request body must be a JSON object' }
  }

  // Validate using Zod schema
  try {
    const validatedData = ChatRequestSchema.parse(requestData)
    return { isValid: true, data: validatedData }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      // Return the first validation error for better UX
      const firstError = error.errors[0]
      return { isValid: false, error: firstError.message }
    }
    return { isValid: false, error: 'Validation failed' }
  }
}
