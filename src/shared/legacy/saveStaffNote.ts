import { supabase } from '../../shared/tools/supabaseClient';
import { logger } from '../../shared/utils/logger';

type IntentType = 'request' | 'complaint' | 'upsell';
type Department = 'front_desk' | 'maintenance' | 'housekeeping' | 'kitchen' | 'security' | 'spa';

interface StaffNoteData {
  intent: IntentType;
  hotelId: string;
  guestId: string;
  note: Record<string, any>;
  dept?: Department; // Optional department routing
}

/**
 * Saves a staff note to the Supabase staff_notes table
 * Throws errors to allow caller to handle them and show to guest
 *
 * @param data Staff note data including intent type, hotel ID, guest ID, and note content
 */
export async function saveStaffNote(data: StaffNoteData): Promise<void> {
  const { intent, hotelId, guestId, note, dept } = data;

  // Validate required fields
  if (!intent || !hotelId || !guestId || !note) {
    const error = new Error('Missing required fields for staff note');
    logger.error('SUPABASE', error.message, { data });
    throw error;
  }

  try {
    // Build the staff note record matching the SQL table structure
    const staffNoteRecord = {
      hotel_id: hotelId,
      guest_id: guestId,
      created_by: 'Velin', // AI-generated notes are marked as "Velin"
      department: dept || 'front_desk',
      note_content: note,
      status: 'pending',
      priority: intent === 'complaint' ? 'high' : 'normal', // Complaints are high priority
      intent_type: intent,
      is_active: true
      // created_at is handled automatically by Supabase
    };

    // Insert into staff_notes table
    const { data: insertedNote, error: insertError } = await supabase
      .from('staff_notes')
      .insert(staffNoteRecord)
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to save staff note: ${insertError.message}`);
    }

    logger.info('SUPABASE', 'Staff note saved successfully', {
      noteId: insertedNote?.id,
      intent,
      hotelId,
      guestId,
      department: dept,
      priority: intent === 'complaint' ? 'high' : 'normal'
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('SUPABASE', `Failed to save staff note: ${errorMessage}`, {
      intent,
      hotelId,
      guestId,
      department: dept,
      error: errorMessage
    });
    throw error; // Re-throw to propagate error to caller
  }
} 