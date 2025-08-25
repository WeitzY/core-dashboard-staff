import { OpenAI } from 'openai';
import { logger } from '../../shared/utils/logger';
import { config } from '../../setup/runtime';

// Initialize OpenAI client with API key
const openai = new OpenAI({ apiKey: config.openai.apiKey });

//Generate embeddings for text using OpenAI
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const model = 'text-embedding-3-small';

    const response = await openai.embeddings.create({
      model,
      input: text,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('No embedding returned from OpenAI');
    }

    return embedding;
  } catch (error) {
    logger.error('EMBEDDING', 'Error generating embedding', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      textLength: text.length
    });
    throw new Error('Failed to generate embedding');
  }
}
