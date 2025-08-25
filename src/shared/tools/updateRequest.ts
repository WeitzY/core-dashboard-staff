import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabase } from "./supabaseClient";
import { logger } from "../utils/logger";

const updateRequestSchema = z.object({
  guestId: z.string().describe("The guest ID"),
  hotelId: z.string().describe("The hotel ID"),
  requestId: z.string().optional().describe("The specific request ID to update (if known)"),
  action: z.enum(['cancel', 'modify', 'urgent']).describe("The action to perform on the request"),
  newContent: z.record(z.any()).optional().describe("New content for the request if modifying"),
  reason: z.string().optional().describe("Reason for the change"),
});

export const updateRequestTool = tool(
  async ({ guestId, hotelId, requestId, action, newContent, reason }) => {
    logger.debug('TOOL_UPDATE_REQUEST', 'Updating request', { 
      guestId, 
      hotelId, 
      requestId, 
      action, 
      reason 
    });
    
    try {
      // If no specific request ID, get the most recent active request
      let targetRequestId = requestId;
      
      if (!targetRequestId) {
        const { data: recentRequests, error: fetchError } = await supabase
          .from('staff_notes')
          .select('id')
          .eq('hotel_id', hotelId)
          .eq('guest_id', guestId)
          .eq('is_active', true)
          .neq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (fetchError) {
          throw fetchError;
        }
        
        if (!recentRequests || recentRequests.length === 0) {
          return {
            type: 'no_requests',
            message: 'You don\'t have any active requests to update.'
          };
        }
        
        targetRequestId = recentRequests[0]?.id;
      }
      
      // Perform the update based on action
      let updateData: any = {};
      let actionMessage = '';
      
      switch (action) {
        case 'cancel':
          const currentRequest = await supabase
            .from('staff_notes')
            .select('note_content')
            .eq('id', targetRequestId)
            .single();
          
          if (currentRequest.data) {
            const updatedContent = {
              ...currentRequest.data.note_content,
              cancellation_reason: reason || 'Cancelled by guest'
            };
            
            updateData = {
              status: 'cancelled',
              note_content: updatedContent
            };
          } else {
            updateData = {
              status: 'cancelled'
            };
          }
          actionMessage = 'Your request has been cancelled.';
          break;
          
        case 'modify':
          if (newContent) {
            updateData = {
              note_content: newContent,
              status: 'pending' // Reset to pending if modified
            };
            actionMessage = 'Your request has been updated.';
          } else {
            return {
              type: 'error',
              message: 'No new content provided for modification.'
            };
          }
          break;
          
        case 'urgent':
          updateData = {
            priority: 'high'
          };
          actionMessage = 'Your request has been marked as urgent.';
          break;
      }
      
      const { error: updateError } = await supabase
        .from('staff_notes')
        .update(updateData)
        .eq('id', targetRequestId)
        .eq('hotel_id', hotelId)
        .eq('guest_id', guestId);
      
      if (updateError) {
        throw updateError;
      }
      
      return {
        type: 'success',
        message: `${actionMessage} Our staff will be notified of this change.`
      };
      
    } catch (error) {
      logger.error('TOOL_UPDATE_REQUEST', 'Error updating request', { 
        error, 
        guestId, 
        hotelId, 
        requestId, 
        action 
      });
      
      return {
        type: 'error',
        message: 'I encountered an error while updating your request. Please try again or contact the front desk.'
      };
    }
  },
  {
    name: "updateRequest",
    description: "Update or modify a guest's existing request. Use this when a guest wants to cancel, modify, or mark a request as urgent.",
    schema: updateRequestSchema,
  }
);