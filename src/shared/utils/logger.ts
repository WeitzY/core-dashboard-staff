/**
 * Advanced Logger for Hotel System
 *
 * - error/warn: console + Firestore (prod only)
 * - info/debug: console only
 * - Alerts on repeated errors
 *
 * Usage:
 *   logger.info('CATEGORY', 'Message', { ctx });
 *   logger.error('SYSTEM', 'Failure', { error });
 */

import * as admin from 'firebase-admin';
import { alertManager } from './alertManager';
import { config } from '../../setup/runtime';

// Ensure Firestore is initialized in production/emulator
if (!admin.apps.length) {
  admin.initializeApp({
    ...(process.env.NODE_ENV !== 'production' && process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT }
      : {}),
  });
}

// Define error category configuration
interface ErrorCategoryConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  alert: boolean;
  description: string;
}

const ERROR_CATEGORIES: Record<string, ErrorCategoryConfig> = {
  SYSTEM: { level: 'error', alert: true, description: 'Critical system failures' },
  GPT: { level: 'error', alert: true, description: 'GPT API related errors' },
  FIRESTORE: { level: 'error', alert: true, description: 'Database operation failures' },
  VALIDATION: { level: 'warn', alert: false, description: 'Input validation failures' },
  RATE_LIMIT: { level: 'warn', alert: false, description: 'Rate limit exceeded' },
  SECURITY: { level: 'error', alert: true, description: 'Security related issues' },
  CACHE: { level: 'warn', alert: false, description: 'Cache operation failures' },
  GENERAL: { level: 'error', alert: false, description: 'Uncategorized errors' },
};

// Alert thresholds
const ALERT_THRESHOLDS = {
  errorWindow: 5 * 60 * 1000, // 5 minutes
  consecutiveErrors: 3,
};

// Context type
type LogContext = Record<string, any>;

export class Logger {
  private db = admin.firestore();
  private level = config.logging.level || 'info';
  private errorCounts = new Map<string, number>();
  private consecutiveMap = new Map<string, number>();
  private lastAlertMap = new Map<string, number>();

  private shouldLog(msgLevel: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    return levels.indexOf(msgLevel) <= levels.indexOf(this.level);
  }

  private async writeToFirestore(entry: any): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    try {
      await this.db.collection('logs').add(entry);
    } catch (err) {
      console.error('Firestore log failure:', err);
    }
  }

  private sanitizeContext(ctx: LogContext): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx || {})) {
      if (v instanceof Error) out[k] = v.message;
      else if (typeof v === 'object') {
        try {
          out[k] = JSON.stringify(v);
        } catch {
          out[k] = '[Unserializable]';
        }
      } else out[k] = String(v);
    }
    return out;
  }

  private async handleAlert(cat: string): Promise<void> {
    const now = Date.now();
    const countKey = `${cat}:${Math.floor(now / ALERT_THRESHOLDS.errorWindow)}`;
    const count = (this.errorCounts.get(countKey) || 0) + 1;
    this.errorCounts.set(countKey, count);

    const cons = (this.consecutiveMap.get(cat) || 0) + 1;
    this.consecutiveMap.set(cat, cons);

    const last = this.lastAlertMap.get(cat) || 0;
    if (now - last < ALERT_THRESHOLDS.errorWindow) return;

    if (cons >= ALERT_THRESHOLDS.consecutiveErrors) {
      await alertManager.sendAlert({
        category: cat,
        count,
        consecutive: cons,
        timestamp: new Date().toISOString(),
        message: `Multiple consecutive errors detected in ${cat} category`,
      });
      this.lastAlertMap.set(cat, now);
      this.consecutiveMap.set(cat, 0);
    }
  }

  private async logEntry(
    category: string,
    message: string,
    context: LogContext,
    level: 'error' | 'warn' | 'info' | 'debug'
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      category,
      level,
      message,
      context: this.sanitizeContext(context),
      environment: process.env.NODE_ENV || 'production',
    };

    // Console fallback with proper typing
    switch (level) {
      case 'error':
        console.error(`[ERROR] ${category}: ${message}`, entry.context);
        break;
      case 'warn':
        console.warn(`[WARN] ${category}: ${message}`, entry.context);
        break;
      case 'info':
        console.info(`[INFO] ${category}: ${message}`, entry.context);
        break;
      case 'debug':
        console.debug(`[DEBUG] ${category}: ${message}`, entry.context);
        break;
    }

    // Only write errors/warnings to Firestore
    if (level === 'error' || level === 'warn') {
      await this.writeToFirestore(entry);
    }

    // Alert on error
    if (level === 'error' && ERROR_CATEGORIES[category]?.alert) {
      await this.handleAlert(category);
    }
  }

  public error(category: string, msg: string, ctx: LogContext = {}): void {
    if (!this.shouldLog('error')) return;
    this.logEntry(category, msg, ctx, 'error');
  }
  public warn(category: string, msg: string, ctx: LogContext = {}): void {
    if (!this.shouldLog('warn')) return;
    this.logEntry(category, msg, ctx, 'warn');
  }
  public info(category: string, msg: string, ctx: LogContext = {}): void {
    if (!this.shouldLog('info')) return;
    this.logEntry(category, msg, ctx, 'info');
  }
  public debug(category: string, msg: string, ctx: LogContext = {}): void {
    if (!this.shouldLog('debug')) return;
    this.logEntry(category, msg, ctx, 'debug');
  }

  public async getErrorStats(category: string) {
    const now = Date.now();
    const key = `${category}:${Math.floor(now / ALERT_THRESHOLDS.errorWindow)}`;
    return {
      count: this.errorCounts.get(key) || 0,
      consecutive: this.consecutiveMap.get(category) || 0,
    };
  }
}

export const logger = new Logger();

/**
 * One-line logger utility that keeps all metadata on a single line
 * Use this instead of multi-line logger statements to keep code compact
 */
export const logOneLine = {
  debug: (category: string, message: string, metadata: Record<string, any> = {}) => {
    logger.debug(category, message, { ...metadata });
  },
  info: (category: string, message: string, metadata: Record<string, any> = {}) => {
    logger.info(category, message, { ...metadata });
  },
  warn: (category: string, message: string, metadata: Record<string, any> = {}) => {
    logger.warn(category, message, { ...metadata });
  },
  error: (category: string, message: string, metadata: Record<string, any> = {}) => {
    logger.error(category, message, { ...metadata });
  },
};
