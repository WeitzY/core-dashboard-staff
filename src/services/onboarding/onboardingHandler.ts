import { logger } from '../../shared/utils/logger.js';

export interface OnboardingState {
  message: string;
  hotelId: string;
  guestId?: string;
  roomNumber?: string;
  lastName?: string;
  language?: string;
}

export interface OnboardingResult {
  isOnboarding: boolean;
  isComplete: boolean;
  guestId?: string;
  roomNumber?: string;
  lastName?: string;
  language?: string;
  reply?: string;
  error?: string;
}

/**
 * Validates if guest info is complete for the session
 */
export function validateGuestInfo(state: OnboardingState): boolean {
  return !!(state.guestId && state.roomNumber && state.lastName);
}

/**
 * Determines if the current message indicates onboarding intent
 */
export function detectOnboardingIntent(message: string): boolean {
  const onboardingKeywords = [
    'room', 'check in', 'checkin', 'guest', 'reservation',
    'booking', 'name', 'last name', 'room number'
  ];
  
  const lowerMessage = message.toLowerCase();
  return onboardingKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Handles the onboarding process for new guests
 */
export async function handleOnboarding(state: OnboardingState): Promise<OnboardingResult> {
  logger.debug('ONBOARDING_HANDLER', 'Processing onboarding', {
    message: state.message,
    hasGuestId: !!state.guestId,
    hasRoomNumber: !!state.roomNumber,
    hasLastName: !!state.lastName
  });

  try {
    // Check if onboarding is complete
    if (validateGuestInfo(state)) {
      logger.debug('ONBOARDING_HANDLER', 'Guest info complete, onboarding finished');
      return {
        isOnboarding: false,
        isComplete: true,
        guestId: state.guestId,
        roomNumber: state.roomNumber,
        lastName: state.lastName,
        language: state.language || 'en'
      };
    }

    // Determine what information is missing
    const missingInfo = [];
    if (!state.roomNumber) missingInfo.push('room number');
    if (!state.lastName) missingInfo.push('last name');

    // Generate appropriate onboarding message
    let reply = '';
    if (missingInfo.length === 2) {
      reply = `Welcome! To assist you better, I'll need your room number and last name. Could you please provide them?`;
    } else if (missingInfo.includes('room number')) {
      reply = `Thank you! I also need your room number to continue.`;
    } else if (missingInfo.includes('last name')) {
      reply = `Thank you! I also need your last name to continue.`;
    }

    return {
      isOnboarding: true,
      isComplete: false,
      reply,
      guestId: state.guestId,
      roomNumber: state.roomNumber,
      lastName: state.lastName,
      language: state.language || 'en'
    };

  } catch (error) {
    logger.error('ONBOARDING_HANDLER', 'Error in onboarding process', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return {
      isOnboarding: true,
      isComplete: false,
      error: 'Onboarding failed',
      reply: 'Welcome! I\'m here to help. Could you please provide your room number and last name?'
    };
  }
}

/**
 * Extracts guest information from the message
 */
export function extractGuestInfo(message: string, currentState: OnboardingState): Partial<OnboardingState> {
  const extracted: Partial<OnboardingState> = {};
  
  // Extract room number (3-4 digit numbers)
  const roomMatch = message.match(/\b(\d{3,4})\b/);
  if (roomMatch && !currentState.roomNumber) {
    extracted.roomNumber = roomMatch[1];
  }
  
  // Extract last name (capitalize first letter)
  const nameMatch = message.match(/\b([A-Za-z]{2,})\b/);
  if (nameMatch && nameMatch[1] && !currentState.lastName && !roomMatch) {
    extracted.lastName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
  }
  
  return extracted;
} 