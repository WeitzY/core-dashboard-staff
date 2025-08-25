import crypto from 'crypto';
import { logger } from './logger';

// In-memory rate limiting for session code attempts
const sessionCodeAttempts = new Map<string, number[]>();

// Session code configuration
const SESSION_CODE_LENGTH = 6;
const SESSION_CODE_RATE_LIMIT = 5; // Max attempts per IP per window
const SESSION_CODE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionData {
  sessionCode: string;
  hotelId: string;
  roomNumber?: string;
  lastName?: string;
  language: string;
  tosAccepted: boolean;
  createdAt: number;
  expiresAt: number;
  qrType: 'general' | 'room-specific';
}

/**
 * Generate a random 6-digit session code
 */
export function generateSessionCode(): string {
  // Generate a random 6-digit number
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

/**
 * Check if session code entry is rate limited for an IP
 */
export function isSessionCodeRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const windowStart = now - SESSION_CODE_WINDOW_MS;
  
  // Get attempts for this IP within the window
  const attempts = (sessionCodeAttempts.get(clientIp) || []).filter(timestamp => timestamp > windowStart);
  
  return attempts.length >= SESSION_CODE_RATE_LIMIT;
}

/**
 * Record a session code attempt for rate limiting
 */
export function recordSessionCodeAttempt(clientIp: string): void {
  const now = Date.now();
  const windowStart = now - SESSION_CODE_WINDOW_MS;
  
  // Get existing attempts within window
  const attempts = (sessionCodeAttempts.get(clientIp) || []).filter(timestamp => timestamp > windowStart);
  
  // Add current attempt
  attempts.push(now);
  
  // Update the map
  sessionCodeAttempts.set(clientIp, attempts);
  
  // Log if rate limit is reached
  if (attempts.length >= SESSION_CODE_RATE_LIMIT) {
    logger.warn('SESSION', 'Session code rate limit reached', { 
      clientIp, 
      attempts: attempts.length 
    });
  }
}

/**
 * Create a new session with generated code
 */
export function createSession(params: {
  hotelId: string;
  roomNumber?: string;
  lastName?: string;
  language: string;
  qrType: 'general' | 'room-specific';
}): SessionData {
  const sessionCode = generateSessionCode();
  const now = Date.now();
  
  const sessionData: SessionData = {
    sessionCode,
    hotelId: params.hotelId,
    roomNumber: params.roomNumber,
    lastName: params.lastName,
    language: params.language,
    tosAccepted: false, // Will be set to true after TOS acceptance
    createdAt: now,
    expiresAt: now + SESSION_EXPIRY_MS,
    qrType: params.qrType
  };
  
  logger.debug('SESSION', 'New session created', {
    sessionCode,
    hotelId: params.hotelId,
    qrType: params.qrType,
    hasRoomNumber: !!params.roomNumber,
    hasLastName: !!params.lastName,
    language: params.language
  });
  
  return sessionData;
}

/**
 * Check if a session is expired
 */
export function isSessionExpired(sessionData: SessionData): boolean {
  return Date.now() > sessionData.expiresAt;
}

/**
 * Validate room number (basic validation - hotel-specific validation would be done elsewhere)
 */
export function validateRoomNumber(roomNumber: string): boolean {
  // Basic room number validation
  // Room numbers should be 1-5 digits, possibly with letters
  const roomPattern = /^[A-Za-z0-9]{1,5}$/;
  return roomPattern.test(roomNumber.trim());
}

/**
 * Validate last name (basic validation for guest context)
 */
export function validateLastName(lastName: string): boolean {
  // Basic last name validation
  // Should be 1-50 characters, letters, spaces, hyphens, and apostrophes
  const namePattern = /^[A-Za-z\s\-']{1,50}$/;
  return namePattern.test(lastName.trim());
}

/**
 * Parse QR code data to extract room information
 */
export function parseQRCode(qrData: string): { 
  type: 'general' | 'room-specific';
  roomNumber?: string;
  hotelId?: string;
} {
  try {
    // Try to parse as JSON first (for room-specific QR codes)
    const parsed = JSON.parse(qrData);
    
    if (parsed.type === 'room-specific' && parsed.roomNumber) {
      return {
        type: 'room-specific',
        roomNumber: parsed.roomNumber,
        hotelId: parsed.hotelId
      };
    }
  } catch {
    // If JSON parsing fails, treat as general QR code
  }
  
  // Default to general QR code
  return { type: 'general' };
}

/**
 * Generate room-specific QR code data
 */
export function generateRoomQRCode(hotelId: string, roomNumber: string): string {
  const qrData = {
    type: 'room-specific',
    hotelId,
    roomNumber,
    version: '1.0'
  };
  
  return JSON.stringify(qrData);
}

/**
 * Generate general QR code data
 */
export function generateGeneralQRCode(hotelId: string): string {
  const qrData = {
    type: 'general',
    hotelId,
    version: '1.0'
  };
  
  return JSON.stringify(qrData);
}

/**
 * Clean up expired session code attempts (should be called periodically)
 */
export function cleanupExpiredAttempts(): void {
  const now = Date.now();
  const windowStart = now - SESSION_CODE_WINDOW_MS;
  
  for (const [ip, attempts] of sessionCodeAttempts.entries()) {
    const validAttempts = attempts.filter(timestamp => timestamp > windowStart);
    
    if (validAttempts.length === 0) {
      sessionCodeAttempts.delete(ip);
    } else {
      sessionCodeAttempts.set(ip, validAttempts);
    }
  }
  
  logger.debug('SESSION', 'Cleaned up expired session code attempts', {
    remainingIPs: sessionCodeAttempts.size
  });
}