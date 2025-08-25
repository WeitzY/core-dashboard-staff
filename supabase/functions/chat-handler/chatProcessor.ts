// Main chat processing logic
import { processMessage } from './aiResponse.ts'
import { 
  getHotelDepartments,
  findOrCreateGuest,
  saveChatMessage,
  createStaffNote
} from './databaseOps.ts'
import type { ChatRequest } from '../_shared/validation.ts'

export async function processChatMessage(requestData: ChatRequest) {
  const { message, hotelId, lastName, roomNumber, language, sessionCode: _sessionCode, guestId } = requestData

  // Get hotel departments for AI classification
  const departments = await getHotelDepartments(hotelId)

  // Process message with AI (generates guest response, staff summary, and department)
  const aiResponse = await processMessage(message, departments, roomNumber, hotelId, language)

  // Find or create guest
  const guest = await findOrCreateGuest(hotelId, lastName, roomNumber, guestId)

  // Save guest message to chat_messages
  await saveChatMessage(
    guest.id,
    hotelId,
    guest.user_id,
    'guest',
    message
  )

  // Save AI guest response to chat_messages (what the guest sees)
  await saveChatMessage(
    guest.id,
    hotelId,
    guest.user_id,
    'ai',
    aiResponse.guestResponse
  )

  // Create staff note only if the AI can handle the request AND it's not an FAQ-only match
  if (aiResponse.canHandle && !aiResponse.isFAQ) {
    await createStaffNote({
      hotelId,
      guestId: guest.id,
      createdByName: lastName,
      department: aiResponse.department,
      noteContent: aiResponse.staffSummary,
      roomNumber,
      status: 'pending',
      priority: 'normal',
      intentType: null
    })
  }

  return {
    success: true, 
    guestResponse: aiResponse.guestResponse,
    staffSummary: aiResponse.staffSummary,
    department: aiResponse.department,
    canHandle: aiResponse.canHandle,
    guestId: guest.id,
    message: aiResponse.canHandle
      ? (aiResponse.isFAQ ? 'Message processed (FAQ provided)' : 'Message processed and staff notified')
      : 'Message processed - guest referred to front desk'
  }
}
