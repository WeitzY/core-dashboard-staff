// FAQ processing logic - English only for resume version
import { createSupabaseServiceClient } from '../_shared/supabaseClient.ts'
import { getEmbedding } from '../_shared/embeddings.ts'

export interface FAQInput {
  id?: string // If provided = update existing, if not = create new
  title: string
  content: string
}

export interface SaveFAQResult {
  faqId: string
  title: string
  isNew: boolean
  saved: boolean
  embeddingUpdated: boolean
  error?: string
}

export async function processFAQ(
  hotelId: string, 
  faqData: FAQInput
): Promise<SaveFAQResult> {
  const supabase = createSupabaseServiceClient()
  const isNewFAQ = !faqData.id

  try {
    // Prepare embedding from provided data first so we can upsert with embedding atomically
    const textForEmbedding = `${faqData.title} ${faqData.content}`.trim()
    const embedding = await getEmbedding(textForEmbedding)

    let faqRecord: {
      id: string
      title: string
      content: string
      hotel_id: string
      is_active: boolean
    }

    if (isNewFAQ) {
      // === CREATE NEW FAQ (store embedding on insert) ===

      const { data: sourceFAQ, error: insertError } = await supabase
        .from('faq_info')
        .insert({
          title: faqData.title,
          content: faqData.content,
          hotel_id: hotelId,
          is_active: true,
          embedding
        })
        .select()
        .single()

      if (insertError || !sourceFAQ) {
        throw new Error(`Failed to create FAQ: ${insertError?.message}`)
      }

      faqRecord = sourceFAQ

    } else {
      // === UPDATE EXISTING FAQ (update embedding together) ===

      const { data: updatedFAQ, error: updateError } = await supabase
        .from('faq_info')
        .update({
          title: faqData.title,
          content: faqData.content,
          embedding
        })
        .eq('id', faqData.id)
        .eq('hotel_id', hotelId) // Ensure hotel scope
        .select()
        .single()

      if (updateError || !updatedFAQ) {
        throw new Error(`Failed to update FAQ: ${updateError?.message}`)
      }

      faqRecord = updatedFAQ
    }

    return {
      faqId: faqRecord.id,
      title: faqData.title,
      isNew: isNewFAQ,
      saved: true,
      embeddingUpdated: true
    }

  } catch (error) {
    console.error(`Error processing FAQ: ${faqData.title}`, error)
    return {
      faqId: faqData.id || 'unknown',
      title: faqData.title,
      isNew: isNewFAQ,
      saved: false,
      embeddingUpdated: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
