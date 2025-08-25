// Embedding generation utilities for Edge Functions - English only for resume version

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float'
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI embedding error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error('Invalid embedding response from OpenAI')
  }

  return data.data[0].embedding
}

export function estimateTokenCount(text: string): number {
  // More accurate estimation: average 0.75 tokens per word
  const words = text.split(/\s+/).filter(word => word.length > 0)
  return Math.ceil(words.length * 0.75)
}
