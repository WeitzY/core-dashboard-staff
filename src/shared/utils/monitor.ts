/**
 * Performance Monitoring and Metrics Collection System
 *
 * This module provides comprehensive monitoring capabilities for the application:
 * - Tracks API calls, GPT operations, and Firestore operations
 * - Collects performance metrics (latency, error rates)
 * - Generates performance summaries with p95/p99 latencies
 * - Integrates with alerting system for performance issues
 *
 * Used by:
 * - API handlers to track request performance
 * - OpenAI service to monitor GPT operations
 * - Database operations to track Firestore performance
 * - Alert system for performance-based alerts
 */

import * as admin from 'firebase-admin';
import { logger } from './logger';
import { config } from '../../setup/runtime';

interface MetricData {
  startTime: number;
  requestId: string;
  name: string;
  duration?: number;
  endTime?: number;
  status?: 'success' | 'error';
  error?: string;
  endpoint?: string;
  operation?: string;
  timestamp?: admin.firestore.Timestamp;
  [key: string]: any;
}

interface Metrics {
  gpt: {
    totalCalls: number;
    errors: number;
    totalLatency: number;
  };
  firestore: {
    totalOps: number;
    errors: number;
    totalLatency: number;
  };
}

interface PerformanceSummary {
  totalCount: number;
  errorCount: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
}

export interface Monitor {
  start(operation: string, requestId: string): void;
  stop(operation: string, requestId: string, isError?: boolean): void;
  startMetric(name: string, requestId: string): number;
  endMetric(name: string, requestId: string, additionalData?: Partial<MetricData>): void;
  trackApiCall<T>(requestId: string, endpoint: string, fn: () => Promise<T>): Promise<T>;
  trackGptCall<T>(requestId: string, fn: () => Promise<T>): Promise<T>;
  trackFirestoreOp<T>(requestId: string, operation: string, fn: () => Promise<T>): Promise<T>;
  getMetrics(metric: string, windowMs?: number): Promise<MetricData[]>;
  getPerformanceSummary(metric: string, windowMs?: number): Promise<PerformanceSummary | null>;
  getCurrentMetrics(): Metrics;
}

export class Monitor {
  private metrics: Map<string, MetricData>;
  private metricsData: Metrics;
  private alertThresholdMs: number;
  private errorRateThreshold: number;
  private defaultWindow: number;

  constructor() {
    this.metrics = new Map();
    this.metricsData = {
      gpt: {
        totalCalls: 0,
        errors: 0,
        totalLatency: 0,
      },
      firestore: {
        totalOps: 0,
        errors: 0,
        totalLatency: 0,
      },
    };

    // Convert string values to numbers if needed
    const alertThreshold =
      typeof config.monitoring.alert_threshold_ms === 'string'
        ? parseInt(config.monitoring.alert_threshold_ms, 10)
        : config.monitoring.alert_threshold_ms;

    const errorRate =
      typeof config.monitoring.error_rate_threshold === 'string'
        ? parseFloat(config.monitoring.error_rate_threshold)
        : config.monitoring.error_rate_threshold;

    this.alertThresholdMs = alertThreshold;
    this.errorRateThreshold = errorRate;
    this.defaultWindow = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Start tracking a metric
   */
  public startMetric(name: string, requestId: string): number {
    const startTime = Date.now();
    this.metrics.set(`${name}:${requestId}`, {
      startTime,
      requestId,
      name,
    });
    return startTime;
  }

  /**
   * End tracking a metric
   */
  public endMetric(name: string, requestId: string, additionalData: Partial<MetricData> = {}): void {
    const key = `${name}:${requestId}`;
    const metric = this.metrics.get(key);

    if (!metric) {
      logger.warn('MONITORING', 'Metric not found', { name, requestId });
      return;
    }

    const duration = Date.now() - metric.startTime;
    const data: MetricData = {
      ...metric,
      ...additionalData,
      duration,
      endTime: Date.now(),
    };

    // Store in Firestore
    void this.storeMetric(data);

    // Remove from memory
    this.metrics.delete(key);
  }

  /**
   * Store metric in Firestore
   */
  private async storeMetric(data: MetricData): Promise<void> {
    try {
      await admin
        .firestore()
        .collection('metrics')
        .add({
          ...data,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

      logger.debug('MONITORING', 'Metric stored', {
        name: data.name,
        duration: data.duration,
      });
    } catch (error) {
      logger.error('MONITORING', 'Failed to store metric', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metric: data.name,
      });
    }
  }

  /**
   * Track API call duration
   */
  public async trackApiCall<T>(requestId: string, endpoint: string, fn: () => Promise<T>): Promise<T> {
    const startTime = this.startMetric('api_call', requestId);

    try {
      const result = await fn();
      this.endMetric('api_call', requestId, {
        endpoint,
        status: 'success',
        duration: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      this.endMetric('api_call', requestId, {
        endpoint,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Track GPT call duration
   */
  public async trackGptCall<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
    const startTime = this.startMetric('gpt_call', requestId);

    try {
      const result = await fn();
      this.endMetric('gpt_call', requestId, {
        status: 'success',
        duration: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      this.endMetric('gpt_call', requestId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Track Firestore operation
   */
  public async trackFirestoreOp<T>(requestId: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const startTime = this.startMetric('firestore_op', requestId);

    try {
      const result = await fn();
      this.endMetric('firestore_op', requestId, {
        operation,
        status: 'success',
        duration: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      this.endMetric('firestore_op', requestId, {
        operation,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  public async getMetrics(metric: string, windowMs: number = this.defaultWindow): Promise<MetricData[]> {
    try {
      const cutoffTime = new Date(Date.now() - windowMs);

      const snapshot = await admin
        .firestore()
        .collection('metrics')
        .where('name', '==', metric)
        .where('timestamp', '>', cutoffTime)
        .get();

      return snapshot.docs.map(doc => doc.data() as MetricData);
    } catch (error) {
      logger.error('MONITORING', 'Failed to get metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metric,
      });
      return [];
    }
  }

  /**
   * Get performance summary
   */
  public async getPerformanceSummary(
    metric: string,
    windowMs: number = this.defaultWindow
  ): Promise<PerformanceSummary | null> {
    try {
      const metrics = await this.getMetrics(metric, windowMs);
      if (metrics.length === 0) return null;

      const durations = metrics.map(m => m.duration || 0).sort((a, b) => a - b);

      const totalCount = durations.length;
      const errorCount = metrics.filter(m => m.status === 'error').length;
      const errorRate = errorCount / totalCount;
      const avgLatency = durations.reduce((a, b) => a + b, 0) / totalCount;
      const p95Latency = durations[Math.floor(totalCount * 0.95)];
      const p99Latency = durations[Math.floor(totalCount * 0.99)];

      // Check for performance alerts
      if (avgLatency > this.alertThresholdMs) {
        logger.warn('MONITORING', 'High average latency detected', {
          metric,
          avgLatency,
          threshold: this.alertThresholdMs,
        });
      }

      if (errorRate > this.errorRateThreshold) {
        logger.error('MONITORING', 'High error rate detected', {
          metric,
          errorRate,
          threshold: this.errorRateThreshold,
        });
      }

      return {
        totalCount,
        errorCount,
        errorRate,
        avgLatency,
        p95Latency,
        p99Latency,
      };
    } catch (error) {
      logger.error('MONITORING', 'Failed to get performance summary', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metric,
      });
      return null;
    }
  }

  /**
   * Get current metrics
   */
  public getCurrentMetrics(): Metrics {
    return this.metricsData;
  }

  /**
   * Start monitoring an operation
   */
  public start(operation: string, requestId: string): void {
    this.startMetric(operation, requestId);
  }

  /**
   * Stop monitoring an operation
   */
  public stop(operation: string, requestId: string, isError: boolean = false): void {
    this.endMetric(operation, requestId, {
      status: isError ? 'error' : 'success',
    });
  }
}

// Create singleton instance
export const monitor = new Monitor();
export default monitor;
