import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "./supabaseClient";
import { logger } from "../utils/logger";

const getRequestStatusSchema = z.object({
  guestId: z.string().describe("The guest ID to check requests for"),
  hotelId: z.string().describe("The hotel ID"),
});

export const getRequestStatusTool = tool(
  async ({ guestId, hotelId }) => {
    logger.debug('TOOL_GET_REQUEST_STATUS', 'Getting request status', { guestId, hotelId });
    
    try {
      const { data: requests, error } = await supabase
        .from('staff_notes')
        .select('id, note_content, status, priority, intent_type, department, created_at')
        .eq('hotel_id', hotelId)
        .eq('guest_id', guestId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      if (!requests || requests.length === 0) {
        return {
          type: 'no_requests',
          message: 'You don\'t have any active requests at the moment. Is there anything I can help you with?'
        };
      }
      
      const activeRequests = requests.filter(r => r.status !== 'completed');
      const completedRequests = requests.filter(r => r.status === 'completed');
      
      let message = '';
      
      if (activeRequests.length > 0) {
        message += `Your active requests:\n`;
        activeRequests.forEach((request, index) => {
          const requestSummary = extractRequestSummary(request.note_content);
          message += `${index + 1}. ${requestSummary} (${request.status}, ${request.priority} priority)\n`;
        });
      }
      
      if (completedRequests.length > 0) {
        message += `\nRecently completed requests:\n`;
        completedRequests.slice(0, 3).forEach((request, index) => {
          const requestSummary = extractRequestSummary(request.note_content);
          message += `${index + 1}. ${requestSummary} (completed)\n`;
        });
      }
      
      return {
        type: 'found',
        requests: {
          active: activeRequests,
          completed: completedRequests
        },
        message: message.trim()
      };
      
    } catch (error) {
      logger.error('TOOL_GET_REQUEST_STATUS', 'Error getting request status', { error, guestId, hotelId });
      return {
        type: 'error',
        message: 'I encountered an error while checking your requests. Please try again.'
      };
    }
  },
  {
    name: "getRequestStatus",
    description: "Check the status of a guest's previous requests and complaints. Use this when a guest asks about the status of their requests or what they've asked for.",
    schema: getRequestStatusSchema,
  }
);

function extractRequestSummary(noteContent: any): string {
  try {
    if (typeof noteContent === 'string') {
      return noteContent;
    }
    
    if (noteContent && typeof noteContent === 'object') {
      // Try to extract meaningful info from the note content
      const { item, description, request, complaint } = noteContent;
      
      if (item) {
        return `${item}${description ? ` - ${description}` : ''}`;
      }
      
      if (request) {
        return request;
      }
      
      if (complaint) {
        return `Complaint: ${complaint}`;
      }
      
      // Fallback to JSON string
      return JSON.stringify(noteContent);
    }
    
    return 'Request details';
  } catch (error) {
    return 'Request details';
  }
}