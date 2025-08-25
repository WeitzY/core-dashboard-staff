import { logger } from '../../shared/utils/logger';
import OpenAI from 'openai';

// Extract valid departments into a constant to avoid repetition
const DEPARTMENTS = ["housekeeping", "maintenance", "reception", "kitchen", "security", "general", "spa"] as const;

// Define and export the Department union type
export type Department = typeof DEPARTMENTS[number];

// Response schema for structured output
interface DepartmentClassificationResponse {
  department: Department;
}

/**
 * Classifies a staff note into the appropriate hotel department using GPT-4.1-nano
 * @param note The staff note to classify
 * @returns Promise<Department> The target department
 */
export async function classifyDepartment(note: string): Promise<Department> {
  try {
    const openai = new OpenAI();
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      messages: [
        {
          role: 'system',
          content: `You are a department classifier for hotel staff notes. Classify each note into exactly one department:

- "housekeeping": Room cleaning, linens, amenities, housekeeping supplies
- "maintenance": Repairs, technical issues, equipment problems, facilities
- "reception": Front desk matters, check-in/out, guest services, reservations
- "kitchen": Food service, restaurant, room service, catering, dining
- "security": Safety issues, incidents, access problems, security concerns
- "spa": Spa and wellness services, treatments, bookings, equipment issues
- "general": Administrative, HR, general operations, or unclear category

Return the single most appropriate department for routing the note.`
        },
        {
          role: 'user',
          content: note
        }
      ],
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: "department_classification",
          schema: {
            type: "object",
            properties: {
              department: {
                type: "string",
                enum: DEPARTMENTS
              }
            },
            required: ["department"],
            additionalProperties: false
          }
        }
      },
      temperature: 0,
      max_tokens: 30
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      logger.warn('DEPT_CLASSIFY', 'Empty response from model');
      return 'general';
    }

    const parsed: DepartmentClassificationResponse = JSON.parse(content);
    
    // Validate the response structure and department value
    if (!parsed.department || !DEPARTMENTS.includes(parsed.department as Department)) {
      logger.warn('DEPT_CLASSIFY', 'Invalid department in response', {
        received: parsed.department
      });
      return 'general';
    }

    logger.debug('DEPT_CLASSIFY', 'Successfully classified note', {
      note: process.env.NODE_ENV !== 'production' ? note : undefined,
      department: parsed.department
    });

    return parsed.department;

  } catch (error) {
    logger.error('DEPT_CLASSIFY', 'Department classification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      note: process.env.NODE_ENV !== 'production' ? note : undefined
    });
    
    // Fallback to general department on any error
    return 'general';
  }
} 