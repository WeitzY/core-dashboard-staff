/**
 * Alert Management System
 *
 * Handles system-wide alerts and notifications:
 * - Manages alert delivery through multiple channels (Firestore, Email)
 * - Implements alert cooldown to prevent notification spam
 * - Provides environment-specific alert routing (prod/staging/dev)
 * - Maintains alert history and cleanup
 *
 * Used by:
 * - Monitor for performance alerts
 * - Logger for error alerts
 * - Circuit breaker for system health alerts
 * - Scheduled tasks for system status updates
 */

import admin from 'firebase-admin';
import sgMail from '@sendgrid/mail';
import * as functions from 'firebase-functions';
import { MailDataRequired } from '@sendgrid/mail';

// Keeping interfaces for future use
interface AlertConfig {
  cooldown: number;
  channels: {
    production: string[];
    staging: string[];
    development: string[];
  };
}

interface Alert {
  category: string;
  message: string;
  count: number;
  consecutive: number;
  timestamp: string;
  details?: string;
  errorRate?: number;
}

interface AlertDocument extends Alert {
  status: 'sent' | 'failed';
}

interface AlertStats {
  [category: string]: number;
}

class AlertManager {
  private db: admin.firestore.Firestore;
  private config: AlertConfig;

  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.db = admin.firestore();

    const functionsConfig = functions.config();

    // Default config
    this.config = {
      cooldown: 15 * 60 * 1000, // 15 minutes
      channels: {
        production: functionsConfig.alert?.emails_prod?.split(',') || [],
        staging: functionsConfig.alert?.emails_staging?.split(',') || [],
        development: functionsConfig.alert?.emails_dev?.split(',') || [],
      },
    };

    // Initialize SendGrid if API key is available
    if (functionsConfig.sendgrid?.api_key) {
      sgMail.setApiKey(functionsConfig.sendgrid.api_key);
    }
  }

  public async sendAlert(alert: Alert): Promise<void> {
    try {
      // Store alert in Firestore
      await this.db.collection('alerts').add({
        ...alert,
        status: 'sent',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Send email if configured
      await this.sendEmailAlert(alert);
    } catch (error) {
      console.error('Failed to send alert:', error);
    }
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    const env = process.env.NODE_ENV || 'development';
    const recipients = this.config.channels[env as keyof typeof this.config.channels];
    const functionsConfig = functions.config();

    if (!recipients.length || !functionsConfig.sendgrid?.api_key) {
      return;
    }

    const msg: MailDataRequired = {
      to: recipients,
      from: functionsConfig.alert?.from_email || 'alerts@velin.app',
      subject: `[${env.toUpperCase()}] Alert: ${alert.category}`,
      text: `
Alert Details:
Category: ${alert.category}
Message: ${alert.message}
Count: ${alert.count}
Consecutive: ${alert.consecutive}
Time: ${alert.timestamp}
${alert.details ? `\nDetails: ${alert.details}` : ''}
${alert.errorRate ? `\nError Rate: ${(alert.errorRate * 100).toFixed(2)}%` : ''}
      `.trim(),
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error('Failed to send email alert:', error);
    }
  }

  public async cleanupOldAlerts(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const snapshot = await this.db.collection('alerts').where('timestamp', '<', thirtyDaysAgo).get();

      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (error) {
      console.error('Failed to cleanup alerts:', error);
    }
  }

  public async getAlertStats(timeWindow: number = 24 * 60 * 60 * 1000): Promise<AlertStats> {
    try {
      const cutoffTime = new Date(Date.now() - timeWindow);
      const snapshot = await this.db.collection('alerts').where('timestamp', '>', cutoffTime).get();

      const stats: AlertStats = {};
      snapshot.docs.forEach(doc => {
        const alert = doc.data() as AlertDocument;
        stats[alert.category] = (stats[alert.category] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('Failed to get alert stats:', error);
      return {};
    }
  }
}

// Export disabled instance
export const alertManager = new AlertManager();
export default alertManager;
