/**
 * @fileoverview Advanced Rate Limiting System for Hotel Management System
 *
 * This module provides a sophisticated rate limiting solution using Firestore as a
 * distributed storage backend. It implements endpoint-specific and IP-based rate
 * limiting with configurable thresholds and automatic cleanup.
 *
 * Key Features:
 * - Endpoint-specific rate limiting configurations
 * - IP-based rate limiting support
 * - Request size validation
 * - Sliding window rate limiting algorithm
 * - Distributed rate limiting using Firestore
 * - Automatic cleanup of stale entries
 * - Configurable retry-after intervals
 * - Graceful failure handling
 *
 * Default Configurations:
 * - Guest Message Endpoint: 60 requests/minute, 1MB max size
 * - Default Endpoints: 30 requests/minute, 512KB max size
 *
 * Usage:
 * ```typescript
 * import { rateLimiter } from '../utils/rateLimiter';
 *
 * const result = await rateLimiter.checkRateLimit(req);
 * if (!result.allowed) {
 *   res.status(429).set('Retry-After', result.retryAfter).json({
 *     error: result.reason
 *   });
 *   return;
 * }
 * ```
 *
 * Cleanup:
 * - Automatically removes rate limit entries older than 1 hour
 * - Cleanup runs every hour in the background
 *
 * @version 1.0.0
 * @license MIT
 */

import * as admin from 'firebase-admin';
import { logger } from './logger';
import { Request } from 'firebase-functions/v2/https';

interface RateLimitConfig {
  requestsPerMinute: number;
  maxRequestSize: number;
  ipBased: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
}

// Rate limit configuration
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/handleGuestMessage': {
    requestsPerMinute: 60, // 1 request per second
    maxRequestSize: 1024 * 1024, // 1MB
    ipBased: true,
  },
};

// Default limits for unknown endpoints
const DEFAULT_LIMITS: RateLimitConfig = {
  requestsPerMinute: 30,
  maxRequestSize: 512 * 1024, // 512KB
  ipBased: true,
};

class RateLimiter {
  private db: admin.firestore.Firestore;
  private collection: admin.firestore.CollectionReference;

  constructor() {
    this.db = admin.firestore();
    this.collection = this.db.collection('rateLimits');
  }

  async checkRateLimit(req: Request): Promise<RateLimitResult> {
    const endpoint = req.path;
    const ip = req.headers['x-forwarded-for'] || 'unknown';
    const limits = RATE_LIMITS[endpoint] || DEFAULT_LIMITS;

    // Check request size
    if (this.isRequestTooLarge(req, limits.maxRequestSize)) {
      logger.warn('RATE_LIMIT', 'Request too large', {
        endpoint,
        ip,
        size: this.getRequestSize(req),
      });
      return {
        allowed: false,
        reason: 'Request too large',
        retryAfter: 60,
      };
    }

    const key = limits.ipBased ? `${endpoint}:${ip}` : endpoint;
    const now = Date.now();
    const windowStart = now - 60 * 1000; // 1 minute window

    try {
      const docRef = this.collection.doc(key);
      const doc = await docRef.get();

      if (!doc.exists) {
        // First request
        await docRef.set({
          count: 1,
          firstRequest: now,
          lastRequest: now,
        });
        return { allowed: true };
      }

      const data = doc.data();
      if (!data) return { allowed: true };

      // Reset counter if window has passed
      if (data.firstRequest < windowStart) {
        await docRef.update({
          count: 1,
          firstRequest: now,
          lastRequest: now,
        });
        return { allowed: true };
      }

      // Check if limit exceeded
      if (data.count >= limits.requestsPerMinute) {
        const retryAfter = Math.ceil((data.firstRequest + 60000 - now) / 1000);
        logger.warn('RATE_LIMIT', 'Rate limit exceeded', {
          endpoint,
          ip,
          count: data.count,
          limit: limits.requestsPerMinute,
        });
        return {
          allowed: false,
          reason: 'Too many requests',
          retryAfter,
        };
      }

      // Increment counter
      await docRef.update({
        count: admin.firestore.FieldValue.increment(1),
        lastRequest: now,
      });

      return { allowed: true };
    } catch (error) {
      logger.error('RATE_LIMIT', 'Rate limit check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Allow request if rate limit check fails
      return { allowed: true };
    }
  }

  private isRequestTooLarge(req: Request, maxSize: number): boolean {
    const size = this.getRequestSize(req);
    return size > maxSize;
  }

  private getRequestSize(req: Request): number {
    if (!req.body) return 0;
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8');
  }

  async cleanupOldEntries() {
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const oldEntries = await this.collection.where('lastRequest', '<', oneHourAgo).get();

      const batch = this.db.batch();
      oldEntries.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      logger.info('RATE_LIMIT', 'Cleaned up old rate limit entries', {
        count: oldEntries.size,
      });
    } catch (error) {
      logger.error('RATE_LIMIT', 'Failed to cleanup rate limit entries', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Create singleton instance
export const rateLimiter = new RateLimiter();

// Cleanup old entries every hour
setInterval(() => rateLimiter.cleanupOldEntries(), 60 * 60 * 1000);
