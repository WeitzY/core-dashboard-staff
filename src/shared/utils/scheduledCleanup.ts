/**
 * @fileoverview Scheduled Cleanup Utility for Hotel Management System
 *
 * This module provides automated cleanup functionality for the hotel management system,
 * periodically removing old logs and metrics data to maintain system performance and
 * prevent database bloat. It uses Firebase Gen 2 scheduler to run every 6 hours.
 *
 * Key Features:
 * - Configurable retention period for logs and metrics (default: 30 days)
 * - Batch processing to handle large datasets efficiently
 * - Automatic cleanup of multiple collections
 * - Detailed logging and error tracking
 * - Configurable batch sizes to optimize performance
 *
 * Configuration:
 * - retentionDays: Number of days to keep data (default: 30)
 * - batchSize: Number of documents to process in one batch (default: 500)
 * - collections: Array of collection names to clean up (default: ['logs', 'metrics'])
 *
 * @version 1.0.0
 * @license MIT
 */

import { onSchedule, ScheduledEvent } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { logger } from './logger';
import { config } from '../../setup/runtime';

// Ensure Firebase is initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

interface CleanupStats {
  logsDeleted: number;
  metricsDeleted: number;
  timestamp: Date;
  status: 'success' | 'error';
  error?: string;
}

interface CleanupConfig {
  retentionDays: number;
  batchSize: number;
  collections: string[];
}

const DEFAULT_CONFIG: CleanupConfig = {
  retentionDays: 30,
  batchSize: 500,
  collections: ['logs', 'metrics'],
};

const cleanupHandler = async (config: CleanupConfig = DEFAULT_CONFIG): Promise<CleanupStats> => {
  const stats: CleanupStats = {
    logsDeleted: 0,
    metricsDeleted: 0,
    timestamp: new Date(),
    status: 'success',
  };

  try {
    logger.info('CLEANUP', 'Starting scheduled cleanup', config);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

    const db = admin.firestore();
    const batch = db.batch();
    let operationsInBatch = 0;

    // Process each collection
    for (const collectionName of config.collections) {
      const snapshot = await db
        .collection(collectionName)
        .where('timestamp', '<', cutoffDate)
        .limit(config.batchSize)
        .get();

      snapshot.forEach(doc => {
        batch.delete(doc.ref);
        operationsInBatch++;

        // Update stats
        if (collectionName === 'logs') stats.logsDeleted++;
        if (collectionName === 'metrics') stats.metricsDeleted++;
      });

      // Commit batch if it's getting full
      if (operationsInBatch >= config.batchSize) {
        await batch.commit();
        operationsInBatch = 0;
      }
    }

    // Commit any remaining operations
    if (operationsInBatch > 0) {
      await batch.commit();
    }

    logger.info('CLEANUP', 'Scheduled cleanup completed', stats);
    return stats;
  } catch (error) {
    stats.status = 'error';
    stats.error = error instanceof Error ? error.message : 'Unknown error';

    logger.error('CLEANUP', 'Cleanup failed', {
      error: stats.error,
      stats,
    });

    throw error;
  }
};

// Export the scheduled cleanup function with environment check
export const scheduledCleanup = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (event: ScheduledEvent): Promise<void> => {
    // Only run in production environment
    if (config.env !== 'production') {
      logger.info('CLEANUP', 'Skipping scheduled cleanup in non-production environment', {
        environment: config.env,
        scheduleTime: event.scheduleTime,
      });
      return;
    }

    logger.info('CLEANUP', 'Starting scheduled cleanup', {
      scheduleTime: event.scheduleTime,
    });

    await cleanupHandler();
  }
);
