import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { saveStaffNote } from "../../db/supabase/saveStaffNote";
import { logger } from "../utils/logger";

const createStaffNoteSchema = z.object({
  intentType: z.enum(['request', 'complaint', 'upsell']).describe("The type of staff note to create"),
  noteContent: z.record(z.any()).describe("The detailed content of the note, including guest request details, items, quantities, etc."),
  department: z.enum(['front_desk', 'maintenance', 'housekeeping', 'kitchen', 'security', 'spa']).optional().describe("The department to route this note to"),
  hotelId: z.string().describe("The hotel ID"),
  guestId: z.string().describe("The guest ID"),
});

export const createStaffNoteTool = tool(
  async ({ intentType, noteContent, department, hotelId, guestId }) => {
    logger.debug('TOOL_CREATE_STAFF_NOTE', 'Creating staff note', { 
      intentType, 
      department, 
      hotelId, 
      guestId,
      noteContent 
    });
    
    try {
      await saveStaffNote({
        intent: intentType,
        hotelId,
        guestId,
        note: noteContent,
        dept: department
      });
      
      const priorityText = intentType === 'complaint' ? 'high priority' : 'normal priority';
      const departmentText = department ? ` to ${department}` : '';
      
      return {
        type: 'success',
        message: `Your ${intentType} has been submitted successfully${departmentText} and marked as ${priorityText}. Our staff will handle this promptly and keep you updated.`
      };
      
    } catch (error) {
      logger.error('TOOL_CREATE_STAFF_NOTE', 'Error creating staff note', { 
        error, 
        intentType, 
        hotelId, 
        guestId 
      });
      
      return {
        type: 'error',
        message: 'I encountered an error while submitting your request. Please try again or contact the front desk directly.'
      };
    }
  },
  {
    name: "createStaffNote",
    description: "Create a staff note for guest requests, complaints, or upsells. Use this when a guest wants to request something, report an issue, or you want to offer an upsell.",
    schema: createStaffNoteSchema,
  }
);