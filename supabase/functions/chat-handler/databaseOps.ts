import { createSupabaseServiceClient } from '../_shared/supabaseClient.ts'

export interface Guest {
  id: string
  user_id: string
  hotel_id: string
  room_number: string | null
  last_name: string | null
  language: string | null
  last_active_at: string | null
  url_token: string | null
  checkout_date: string | null
}
export interface ChatMessage {
  id: string
  user_id: string
  hotel_id: string
  sender: string
  message: string
  created_at: string
  guest_id: string
}
export interface StaffNoteInput {
  hotelId: string
  guestId: string
  createdByName: string
  department: string
  noteContent: string
  roomNumber: string
  status?: string
  priority?: string
  intentType?: string | null
}

export async function getHotelDepartments(hotelId: string): Promise<string[]> {
  const supabase = createSupabaseServiceClient()
  
  const { data: hotelData, error: hotelError } = await supabase
    .from('hotels')
    .select('departments')
    .eq('id', hotelId)
    .single()

  if (hotelError || !hotelData) {
    throw new Error(`Invalid hotel ID: ${hotelId}`)
  }

  return hotelData.departments || ['general', 'housekeeping', 'maintenance', 'concierge', 'room-service']
}

export async function findOrCreateGuest(
  hotelId: string, 
  lastName: string, 
  roomNumber: string,
  userId?: string
): Promise<Guest> {
  const supabase = createSupabaseServiceClient()
  
  const { data: existingGuest, error: findError } = await supabase
    .from('guests')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('room_number', roomNumber)
    .eq('last_name', lastName)
    .single()

  if (existingGuest && !findError) {
    return existingGuest
  }

  // Create new guest if not found
  // For simplified version, we'll create a user_id if not provided
  const guestUserId = userId || crypto.randomUUID()
  
  const { data: newGuest, error: createError } = await supabase
    .from('guests')
    .insert({
      user_id: guestUserId,
      hotel_id: hotelId,
      room_number: roomNumber,
      last_name: lastName,
      language: 'en'
    })
    .select()
    .single()

  if (createError || !newGuest) {
    throw new Error(`Failed to create guest: ${createError?.message}`)
  }

  return newGuest
}

export async function saveChatMessage(
  guestId: string,
  hotelId: string,
  userId: string,
  sender: string,
  message: string
): Promise<ChatMessage> {
  const supabase = createSupabaseServiceClient()
  
  const { data: newMessage, error } = await supabase
    .from('chat_messages')
    .insert({
      user_id: userId,
      hotel_id: hotelId,
      sender,
      message,
      guest_id: guestId,
    })
    .select()
    .single()

  if (error || !newMessage) {
    throw new Error(`Failed to save chat message: ${error?.message}`)
  }

  return newMessage
}

export async function createStaffNote(input: StaffNoteInput) {
  const supabase = createSupabaseServiceClient()

  const { hotelId, guestId, department, noteContent, roomNumber } = input

  const { data, error } = await supabase
    .from('staff_notes')
    .insert({
      hotel_id: hotelId,
      guest_id: guestId,
      created_by_name: 'Chatbot',
      created_by_staff_id: null,
      department: department,
      note_content: noteContent,
      status: input.status ?? 'pending',
      priority: input.priority ?? 'normal',
      intent_type: input.intentType ?? null,
      is_active: true,
      room_number: roomNumber
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create staff note: ${error.message}`)
  }

  return data
}