/**
 * @fileoverview Circuit Breaker Pattern Implementation for Hotel Management System
 *
 * This module implements the Circuit Breaker pattern to prevent cascading failures
 * in distributed systems. It provides protection against repeated failures of external
 * services and allows for graceful degradation of functionality.
 *
 * Key Features:
 * - Three-state circuit breaker (CLOSED, OPEN, HALF-OPEN)
 * - Configurable failure thresholds and reset timeouts
 * - Automatic state transitions based on failure patterns
 * - Half-open state for gradual recovery
 * - Firestore-based state persistence
 * - Configurable per-service settings
 * - Built-in logging and monitoring
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is broken, requests fail fast
 * - HALF-OPEN: Limited requests allowed to test recovery
 *
 * Default Configurations:
 * - Failure Threshold: 5 consecutive failures
 * - Reset Timeout: 60 seconds
 * - Half-Open Limit: 3 test requests
 *
 * Usage:
 * ```typescript
 * import { gptCircuitBreaker } from '../utils/circuitBreaker';
 *
 * try {
 *   const result = await gptCircuitBreaker.execute(async () => {
 *     // Your potentially failing operation here
 *     return await someExternalService();
 *   });
 * } catch (error) {
 *   // Handle circuit breaker or operation failure
 * }
 * ```
 *
 * Pre-configured Instances:
 * - gptCircuitBreaker: For GPT API operations
 * - firestoreCircuitBreaker: For Firestore operations
 *
 * @version 1.0.0
 * @license MIT
 */

import * as admin from 'firebase-admin';
import { config } from '../../setup/runtime';
import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenLimit?: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
}

interface CircuitBreakerLog extends CircuitBreakerState {
  timestamp: admin.firestore.FieldValue;
}

class CircuitBreaker {
  private name: string;
  private state: CircuitState;
  private failureCount: number;
  private lastFailureTime: number | null;
  private halfOpenCallCount: number;
  private failureThreshold: number;
  private resetTimeout: number;
  private halfOpenLimit: number;
  private db: admin.firestore.Firestore;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenCallCount = 0;

    // Load from config or use defaults
    this.failureThreshold = options.failureThreshold || config.circuitBreaker?.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || config.circuitBreaker?.resetTimeout || 60000;
    this.halfOpenLimit = options.halfOpenLimit || config.circuitBreaker?.halfOpenLimit || 3;

    this.db = admin.firestore();
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.halfOpenCallCount = 0;
        logger.info('CIRCUIT_BREAKER', `${this.name} circuit breaker entering half-open state`);
      } else {
        logger.warn('CIRCUIT_BREAKER', `${this.name} circuit breaker is open, rejecting request`);
        throw new Error(`${this.name} circuit breaker is open`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCallCount >= this.halfOpenLimit) {
      logger.warn('CIRCUIT_BREAKER', `${this.name} circuit breaker half-open call limit reached`);
      throw new Error(`${this.name} circuit breaker half-open call limit reached`);
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenCallCount++;
      }

      const result = await fn();

      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = null;
        logger.info('CIRCUIT_BREAKER', `${this.name} circuit breaker reset to closed state`);
      }

      return result;
    } catch (error) {
      this.handleFailure();
      throw error;
    }
  }

  private handleFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('CIRCUIT_BREAKER', `${this.name} circuit breaker opened after ${this.failureCount} failures`);
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn('CIRCUIT_BREAKER', `${this.name} circuit breaker reopened after failure in half-open state`);
    }
  }

  public async logState(): Promise<void> {
    try {
      const log: CircuitBreakerLog = {
        state: this.state,
        failures: this.failureCount,
        lastFailureTime: this.lastFailureTime,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      await this.db.collection('circuit_breaker_logs').add(log);
    } catch (error) {
      logger.error('CIRCUIT_BREAKER', 'Failed to log circuit breaker state', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  public getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Create instances for different services
export const gptCircuitBreaker = new CircuitBreaker('GPT', {
  failureThreshold: config.circuitBreaker?.gpt?.failureThreshold,
  resetTimeout: config.circuitBreaker?.gpt?.resetTimeout,
  halfOpenLimit: config.circuitBreaker?.gpt?.halfOpenLimit,
});

export const firestoreCircuitBreaker = new CircuitBreaker('Firestore', {
  failureThreshold: config.circuitBreaker?.firestore?.failureThreshold,
  resetTimeout: config.circuitBreaker?.firestore?.resetTimeout,
  halfOpenLimit: config.circuitBreaker?.firestore?.halfOpenLimit,
});

export default {
  gptCircuitBreaker,
  firestoreCircuitBreaker,
};
