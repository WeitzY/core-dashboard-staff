// Item processing logic - English only for resume version
import { createSupabaseServiceClient } from '../_shared/supabaseClient.ts'
import { getEmbedding } from '../_shared/embeddings.ts'

export interface ItemInput {
  id?: string // If provided = update existing, if not = create new
  item: string
  description?: string
  department: string
}

export interface SaveItemResult {
  itemId: string
  itemName: string
  isNew: boolean
  saved: boolean
  embeddingUpdated: boolean
  error?: string
}

export async function processItem(
  hotelId: string, 
  itemData: ItemInput
): Promise<SaveItemResult> {
  const supabase = createSupabaseServiceClient()
  const isNewItem = !itemData.id

  try {
    let itemRecord: {
      id: string
      item: string
      description: string | null
      department: string | null
      hotel_id: string
      is_active: boolean
    }

    if (isNewItem) {
      // === CREATE NEW ITEM ===

      const { data: newItem, error: insertError } = await supabase
        .from('items')
        .insert({
          item: itemData.item,
          description: itemData.description || null,
          department: itemData.department,
          hotel_id: hotelId,
          is_active: true
        })
        .select()
        .single()

      if (insertError || !newItem) {
        throw new Error(`Failed to create item: ${insertError?.message}`)
      }

      itemRecord = newItem

    } else {
      // === UPDATE EXISTING ITEM ===

      const { data: updatedItem, error: updateError } = await supabase
        .from('items')
        .update({
          item: itemData.item,
          description: itemData.description || null,
          department: itemData.department
        })
        .eq('id', itemData.id)
        .eq('hotel_id', hotelId) // Ensure hotel scope
        .select()
        .single()

      if (updateError || !updatedItem) {
        throw new Error(`Failed to update item: ${updateError?.message}`)
      }

      itemRecord = updatedItem
    }

    // Generate embedding
    const textForEmbedding = [
      itemRecord.item || '',
      itemRecord.description || '',
      itemRecord.department || ''
    ]
      .filter(part => part.trim())
      .join(' ')
      .trim()

    if (!textForEmbedding) {
      console.warn(`No content for embedding generation for item ${itemRecord.id}`)
      return {
        itemId: itemRecord.id,
        itemName: itemData.item,
        isNew: isNewItem,
        saved: true,
        embeddingUpdated: false,
        error: 'No content available for embedding generation'
      }
    }

    const embedding = await getEmbedding(textForEmbedding)

    const { error: embeddingError } = await supabase
      .from('items')
      .update({ 
        embedding,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemRecord.id)

    if (embeddingError) {
      console.error(`Failed to update embedding for item ${itemRecord.id}:`, embeddingError)
      return {
        itemId: itemRecord.id,
        itemName: itemData.item,
        isNew: isNewItem,
        saved: true,
        embeddingUpdated: false,
        error: `Embedding update failed: ${embeddingError.message}`
      }
    }

    return {
      itemId: itemRecord.id,
      itemName: itemData.item,
      isNew: isNewItem,
      saved: true,
      embeddingUpdated: true
    }

  } catch (error) {
    console.error(`Error processing item: ${itemData.item}`, error)
    return {
      itemId: itemData.id || 'unknown',
      itemName: itemData.item,
      isNew: isNewItem,
      saved: false,
      embeddingUpdated: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
