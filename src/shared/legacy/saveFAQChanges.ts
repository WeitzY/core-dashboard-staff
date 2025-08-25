import { supabase } from '../tools/supabaseClient';
import { generateAndStoreMultipleFAQEmbeddings, FAQInput } from './generateAndStoreFAQEmbedding';
import { config } from '../../setup/runtime';
import { logger } from '../utils/logger';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface SaveFAQChangesResult {
  totalFAQs: number;
  newFAQs: number;
  updatedFAQs: number;
  embeddingErrors: number;
  results: Array<{
    faqId: string;
    faqTitle: string;
    isNew: boolean;
    saved: boolean;
    embeddingUpdated: boolean;
    error?: string;
  }>;
}

// Unified FAQ input - ID is optional (new FAQs don't have ID)
export interface FAQChangeInput {
  id?: string; // If provided = update existing, if not = create new
  title: string;
  content: string;
  category?: string;
  language?: string;
  hotel_id: string;
}

/**
 * Translate FAQ content to target language using GPT
 */
async function translateFAQContent(
  title: string, 
  content: string, 
  fromLanguage: string, 
  toLanguage: string
): Promise<{ title: string; content: string }> {
  try {
    const prompt = `Translate this hotel FAQ from ${fromLanguage} to ${toLanguage}. Keep it natural and hotel-appropriate:

Title: ${title}
Content: ${content}

Respond in JSON format:
{
  "title": "translated title",
  "content": "translated content"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    return {
      title: result.title || title,
      content: result.content || content
    };
  } catch (error) {
    logger.error('FAQ_TRANSLATION', `Translation error (${fromLanguage} → ${toLanguage})`, { error });
    return { title, content };
  }
}

/**
 * UNIFIED SAVE CHANGES FUNCTION
 * Handles both creating new FAQs and updating existing ones
 * - New FAQs (no ID): Creates + translates to ALL hotel languages
 * - Existing FAQs (has ID): Updates + regenerates embeddings  
 * - Perfect for one "Save Changes" button in frontend
 */
export async function saveFAQChanges(
  hotelId: string,
  faqChanges: FAQChangeInput[]
): Promise<SaveFAQChangesResult> {
  logger.info('FAQ_CHANGES', `Processing ${faqChanges.length} FAQ changes`, { hotelId });
  
  const results: SaveFAQChangesResult['results'] = [];
  let newFAQs = 0;
  let updatedFAQs = 0;
  let embeddingErrors = 0;

  try {
    // Step 1: Get hotel's supported languages
    const { data: hotel, error: hotelError } = await supabase
      .from('hotels')
      .select('languages')
      .eq('id', hotelId)
      .single();

    if (hotelError || !hotel) {
      throw new Error(`Failed to fetch hotel languages: ${hotelError?.message}`);
    }

    const languages = hotel.languages || ['en'];
    const allCreatedOrUpdatedFAQs: FAQInput[] = [];

    // Step 2: Process each FAQ change
    for (const faqChange of faqChanges) {
      const sourceLanguage = faqChange.language || 'en';
      const isNewFAQ = !faqChange.id;

      try {
        if (isNewFAQ) {
          // === CREATE NEW FAQ + TRANSLATIONS ===
          logger.debug('FAQ_CREATE', `Creating new FAQ: ${faqChange.title}`);

          // Create source FAQ
          const { data: sourceFAQ, error: insertError } = await supabase
            .from('faq_info')
            .insert({
              title: faqChange.title,
              content: faqChange.content,
              category: faqChange.category || 'general',
              language: sourceLanguage,
              hotel_id: hotelId,
              is_active: true
            })
            .select()
            .single();

          if (insertError || !sourceFAQ) {
            throw new Error(`Failed to create FAQ: ${insertError?.message}`);
          }

          // Add to embedding queue
          allCreatedOrUpdatedFAQs.push({
            id: sourceFAQ.id,
            title: sourceFAQ.title,
            content: sourceFAQ.content,
            category: sourceFAQ.category,
            language: sourceFAQ.language,
            hotelId: hotelId
          });

          // Create translations
          const translationPromises = languages
            .filter((lang: string) => lang !== sourceLanguage)
            .map(async (targetLanguage: string) => {
              try {
                const translated = await translateFAQContent(
                  faqChange.title,
                  faqChange.content,
                  sourceLanguage,
                  targetLanguage
                );

                const { data: translatedFAQ, error: translationError } = await supabase
                  .from('faq_info')
                  .insert({
                    title: translated.title,
                    content: translated.content,
                    category: faqChange.category || 'general',
                    language: targetLanguage,
                    hotel_id: hotelId,
                    is_active: true
                  })
                  .select()
                  .single();

                if (translationError || !translatedFAQ) {
                  logger.error('FAQ_TRANSLATION', `Failed to create ${targetLanguage} translation`, { error: translationError });
                  return null;
                }

                // Add to embedding queue
                allCreatedOrUpdatedFAQs.push({
                  id: translatedFAQ.id,
                  title: translatedFAQ.title,
                  content: translatedFAQ.content,
                  category: translatedFAQ.category,
                  language: translatedFAQ.language,
                  hotelId: hotelId
                });

                return translatedFAQ.id;
              } catch (error) {
                logger.error('FAQ_TRANSLATION', `Error creating ${targetLanguage} translation`, { error, targetLanguage });
                return null;
              }
            });

          await Promise.all(translationPromises);
          newFAQs++;

          results.push({
            faqId: sourceFAQ.id,
            faqTitle: faqChange.title,
            isNew: true,
            saved: true,
            embeddingUpdated: false, // Will be updated in batch
            error: undefined
          });

        } else {
          // === UPDATE EXISTING FAQ ===
          logger.debug('FAQ_UPDATE', `Updating existing FAQ: ${faqChange.id}`);

          const { data: updatedFAQ, error: updateError } = await supabase
            .from('faq_info')
            .update({
              title: faqChange.title,
              content: faqChange.content,
              category: faqChange.category || 'general'
            })
            .eq('id', faqChange.id)
            .select()
            .single();

          if (updateError || !updatedFAQ) {
            throw new Error(`Failed to update FAQ: ${updateError?.message}`);
          }

          // Add to embedding queue
          allCreatedOrUpdatedFAQs.push({
            id: updatedFAQ.id,
            title: updatedFAQ.title,
            content: updatedFAQ.content,
            category: updatedFAQ.category,
            language: updatedFAQ.language,
            hotelId: hotelId
          });

          updatedFAQs++;

          results.push({
            faqId: faqChange.id!,
            faqTitle: faqChange.title,
            isNew: false,
            saved: true,
            embeddingUpdated: false, // Will be updated in batch
            error: undefined
          });
        }

      } catch (error) {
        logger.error('FAQ_PROCESSING', `Error processing FAQ: ${faqChange.title}`, { error });
        results.push({
          faqId: faqChange.id || 'unknown',
          faqTitle: faqChange.title,
          isNew: isNewFAQ,
          saved: false,
          embeddingUpdated: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Step 3: Generate all embeddings in batch
    if (allCreatedOrUpdatedFAQs.length > 0) {
      logger.info('FAQ_EMBEDDINGS', `Generating embeddings for ${allCreatedOrUpdatedFAQs.length} FAQs`);
      
      const embeddingResult = await generateAndStoreMultipleFAQEmbeddings(allCreatedOrUpdatedFAQs, {
        batchSize: 5,
        hotelId: hotelId
      });
      
      // Update results with embedding status
      results.forEach(result => {
        const embeddingRes = embeddingResult.results.find((r: any) => r.faqId === result.faqId);
        result.embeddingUpdated = embeddingRes?.success || false;
        
        if (!result.embeddingUpdated) {
          embeddingErrors++;
          result.error = result.error || 'Failed to generate embedding';
        }
      });
    }

    logger.info('FAQ_COMPLETION', `FAQ processing completed: ${newFAQs} new, ${updatedFAQs} updated, ${embeddingErrors} embedding errors`);

    return {
      totalFAQs: faqChanges.length,
      newFAQs,
      updatedFAQs,
      embeddingErrors,
      results
    };

  } catch (error) {
    logger.error('FAQ_CHANGES', 'Error in saveFAQChanges', { error, hotelId });
    
    return {
      totalFAQs: faqChanges.length,
      newFAQs,
      updatedFAQs,
      embeddingErrors: faqChanges.length,
      results: faqChanges.map(faq => ({
        faqId: faq.id || 'unknown',
        faqTitle: faq.title,
        isNew: !faq.id,
        saved: false,
        embeddingUpdated: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    };
  }
}