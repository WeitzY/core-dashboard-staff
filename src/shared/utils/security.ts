/**
 * @fileoverview Security Middleware System for Hotel Management System
 *
 * This module provides a comprehensive security middleware that wraps HTTP handlers
 * with various security measures to protect the application from common web vulnerabilities
 * and attacks. It implements multiple layers of security controls following industry best practices.
 *
 * Key Security Features:
 * - CORS (Cross-Origin Resource Sharing) protection
 * - Rate limiting with sliding window
 * - Request size limitations
 * - Content-Type validation
 * - Security headers implementation
 * - Input sanitization
 * - IP-based request tracking
 * - Proxy-aware client IP detection
 * - Request monitoring and metrics
 *
 * Security Headers Set:
 * - X-Content-Type-Options
 * - X-Frame-Options
 * - X-XSS-Protection
 * - Strict-Transport-Security
 * - Content-Security-Policy
 * - Referrer-Policy
 * - Permissions-Policy
 *
 * Usage:
 * ```typescript
 * import { secureHandler } from '../utils/security';
 *
 * export const secureEndpoint = secureHandler(async (req, res) => {
 *   // Your handler code here
 *   // req.sanitizedBody contains cleaned input
 * });
 * ```
 *
 * @version 1.0.0
 * @license MIT
 */

import * as admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';
import { HttpsFunction, onRequest } from 'firebase-functions/v2/https';
import { config } from '../../setup/runtime';
import { logger } from './logger';
import { monitor } from './monitor';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: CustomJwtPayload;
    }
  }
}

// Custom JWT Payload type
interface CustomJwtPayload {
  uid: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

// Initialize Firebase Admin if not already
if (!admin.apps.length) {
  admin.initializeApp({
    ...(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT } : {}),
  });
}

// In-memory stores for rate limiting
const ipRequestLog = new Map<string, number[]>();
let activeRequests = 0;

/**
 * Get the real client IP address, handling proxy chains
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];

  if (Array.isArray(forwardedFor)) {
    // Get the first non-trusted IP in the chain
    for (const ip of forwardedFor) {
      if (!config.security.trustedProxies.includes(ip)) {
        return ip;
      }
    }
    return forwardedFor[0];
  } else if (typeof forwardedFor === 'string') {
    // Split the chain and get the first non-trusted IP
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    for (const ip of ips) {
      if (!config.security.trustedProxies.includes(ip)) {
        return ip;
      }
    }
    return ips[0];
  } else if (realIp && !config.security.trustedProxies.includes(realIp as string)) {
    return realIp as string;
  }

  return req.ip || 'unknown';
}

/**
 * Wraps a handler with security checks (CORS, rate limiting, size limits, sanitization).
 */
export function secureHandler(
  handler: (req: Request & { sanitizedBody?: any }, res: any) => Promise<void>
): HttpsFunction {
  return onRequest({ region: 'europe-west1' }, async (req, res) => {
    activeRequests++;
    res.on('finish', () => activeRequests--);

    try {
      const clientIp = getClientIp(req);

      // Log security events
      monitor.startMetric('security_check', (req.headers['x-request-id'] as string) || 'unknown');

      // CORS and preflight
      const origin = req.headers.origin as string;
      if (origin && config.security.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-hotel-id');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }

      // Security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

      // Content-Type check
      const ct = ((req.headers['content-type'] as string) || '').split(';')[0];
      if (!config.security.allowedContentTypes.includes(ct)) {
        res.status(415).json({ error: 'Unsupported Media Type' });
        return;
      }

      // Body size limits
      const body = req.body;
      const rawSize = Buffer.byteLength(JSON.stringify(body || {}), 'utf8');
      if (rawSize > config.security.maxRequestSize) {
        res.status(413).json({ error: 'Payload Too Large' });
        return;
      }

      // Field size limits
      for (const [k, v] of Object.entries(body || {})) {
        if (typeof v === 'string' && Buffer.byteLength(v, 'utf8') > config.security.maxFieldSize) {
          res.status(413).json({ error: `Field ${k} exceeds size limit` });
          return;
        }
      }

      // Rate limiting per IP (sliding window)
      const now = Date.now();
      const windowStart = now - config.security.requestWindowMs;
      const timestamps = (ipRequestLog.get(clientIp) || []).filter(ts => ts > windowStart);
      timestamps.push(now);
      ipRequestLog.set(clientIp, timestamps);

      if (timestamps.length > config.security.maxRequestsPerIP) {
        logger.warn('SECURITY', 'Rate limit exceeded', { ip: clientIp, count: timestamps.length });
        res.status(429).json({ error: 'Too Many Requests' });
        return;
      }

      // Payload validation & sanitization
      const sanitizedBody = {
        ...body,
        message: body?.message?.replace(/[<>]/g, '').trim(),
      };
      (req as any).sanitizedBody = sanitizedBody;

      // End security metric
      monitor.endMetric('security_check', (req.headers['x-request-id'] as string) || 'unknown', {
        ip: clientIp,
        status: 'success',
      });

      await handler(req as any, res);
    } catch (error) {
      logger.error('SECURITY', 'Handler error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
}

// JWT Utilities
export const generateToken = (payload: CustomJwtPayload): string => {
  try {
    return jwt.sign(payload, config.security.jwt_secret);
  } catch (error) {
    logger.error('SECURITY', 'Failed to generate JWT token', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to generate token');
  }
};

export const verifyToken = (token: string): CustomJwtPayload => {
  try {
    return jwt.verify(token, config.security.jwt_secret) as CustomJwtPayload;
  } catch (error) {
    logger.error('SECURITY', 'Failed to verify JWT token', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Invalid token');
  }
};

// Encryption Utilities
export const encrypt = (text: string): string => {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(config.security.encryption_key), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('SECURITY', 'Failed to encrypt data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to encrypt data');
  }
};

export const decrypt = (text: string): string => {
  try {
    const [ivHex, encryptedText] = text.split(':');
    if (!ivHex || !encryptedText) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(config.security.encryption_key), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error('SECURITY', 'Failed to decrypt data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to decrypt data');
  }
};

// Middleware to verify JWT token
export const verifyJWT = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Invalid token format' });
      return;
    }

    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('SECURITY', 'JWT verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(401).json({ error: 'Invalid token' });
  }
};
