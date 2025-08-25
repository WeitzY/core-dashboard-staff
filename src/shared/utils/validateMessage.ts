import { Request } from 'firebase-functions/v2/https';
import { logger } from './logger';

interface RequestBody {
  message: string;
  language?: string;
  hotelId?: string;
  guestId?: string;
  isNewConversation?: boolean;
}

export interface NormalizedRequest {
  message: string;
  language: string;
  hotelId?: string;
  guestId?: string;
  messageLength: number;
  sanitized: boolean;
  timestamp: number;
  isNewConversation: boolean;
}

// Maximum message length allowed to prevent token abuse
const MAX_MESSAGE_LENGTH = 500;

// Supported languages - limited to hotel concierge essentials
const SUPPORTED_LANGUAGES = [
  'en', // English
  'es', // Spanish
  'fr', // French
  'de', // German
  'it', // Italian
  'pt', // Portuguese
  'ru', // Russian
  'he', // Hebrew
  'ar', // Arabic
  'nl', // Dutch
  'pl', // Polish
  'ja', // Japanese
];

/**
 * Removes excessive emoji characters and normalizes unicode characters
 * to prevent token abuse and weird Unicode sequences
 */
const sanitizeMessage = (message: string): string => {
  // 1. Normalize Unicode to NFC form for consistent representation
  let sanitized = message.normalize('NFC');

  // 2. Replace consecutive emojis (more than 3) with a single representation
  const emojiPattern = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}){4,}/gu;
  sanitized = sanitized.replace(emojiPattern, '😊');

  // 3. Replace zero-width characters which can be used to sneak in extra content
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 4. Normalize whitespace (no more than 2 consecutive spaces)
  sanitized = sanitized.replace(/\s{3,}/g, '  ');

  // 5. Truncate if still too long after sanitization
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    sanitized = sanitized.substring(0, MAX_MESSAGE_LENGTH) + '...';
  }

  return sanitized;
};

/**
 * Validates incoming request and normalizes the payload
 * Rejects unsupported languages to maintain service quality
 *
 * @param req - HTTP Request object
 * @param requestId - Unique request identifier for tracing
 * @returns Normalized and validated request data
 */
export const validateIncomingMessage = (req: Request, requestId: string): NormalizedRequest => {
  try {
    const body = req.body as RequestBody;
    const timestamp = Date.now();

    // Basic payload validation
    if (!body) {
      logger.error('VALIDATION', 'Missing request body', { requestId });
      throw new Error('Missing request body');
    }

    // Message validation
    if (!body.message || typeof body.message !== 'string') {
      logger.error('VALIDATION', 'Missing or invalid message in request', { requestId });
      throw new Error('Missing or invalid message');
    }

    // Check for excessive message length before sanitization
    if (body.message.length > MAX_MESSAGE_LENGTH * 2) {
      logger.warn('VALIDATION', 'Excessively long message received', {
        requestId,
        messageLength: body.message.length,
      });
    }

    // Initial message trimming
    const rawMessage = body.message.trim();

    // Apply sanitization
    const message = sanitizeMessage(rawMessage);
    const sanitized = message !== rawMessage;

    // Language validation - reject unsupported languages
    let language = 'en'; // Default to English
    if (typeof body.language === 'string') {
      const langCode = body.language.trim().toLowerCase();
      if (SUPPORTED_LANGUAGES.includes(langCode)) {
        language = langCode;
      } else {
        // Reject unsupported languages with clear error
        logger.warn('VALIDATION', 'Unsupported language requested', {
          requestId,
          requestedLanguage: langCode,
          supportedLanguages: SUPPORTED_LANGUAGES,
        });
        throw new Error(`Language '${langCode}' is not supported. Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
      }
    }

    // Hotel and guest validation
    const hotelId = typeof body.hotelId === 'string' && body.hotelId.trim() ? body.hotelId.trim() : undefined;
    const guestId = typeof body.guestId === 'string' && body.guestId.trim() ? body.guestId.trim() : undefined;

    // New conversation validation - defaults to false if not provided or invalid
    const isNewConversation = typeof body.isNewConversation === 'boolean' ? body.isNewConversation : false;

    // Simplified logging
    logger.debug('VALIDATION', 'Message validated', {
      requestId,
      messageLength: message.length,
      language,
      sanitized,
      hasHotelId: !!hotelId,
      hasGuestId: !!guestId,
      isNewConversation,
    });

    return {
      message,
      language,
      hotelId,
      guestId,
      messageLength: message.length,
      sanitized,
      timestamp,
      isNewConversation,
    };
  } catch (error) {
    logger.error('VALIDATION', 'Message validation failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    });
    throw error;
  }
};
