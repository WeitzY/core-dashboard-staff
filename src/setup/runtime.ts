/**
 * @fileoverview Runtime Configuration for Supabase + Vercel
 *
 * This module provides type-safe access to environment variables using Zod validation.
 * It's designed for a Vercel hosting environment connected to a Supabase backend.
 *
 * --------------------------------------------------------
 * HOW TO ADD NEW ENVIRONMENT VARIABLES:
 * 1. Add the variable to your Vercel project's environment settings.
 * 2. Add the variable to the ConfigSchema object with appropriate validation.
 * 3. Add the variable to the process.env destructuring in getConfigValues().
 * 4. Access in your code via: import { config } from "./config/runtime";
 * --------------------------------------------------------
 */
import { z } from 'zod';

// Define environment type based on Vercel's system variable
const Environment = z.enum(['development', 'preview', 'production']);
type Environment = z.infer<typeof Environment>;

// Configuration schema with all validations
const ConfigSchema = z.object({
  // Environment
  env: Environment.default('development'),

  // Supabase Configuration
  supabase: z.object({
    url: z.string().url(),
    anonKey: z.string(),
    serviceRoleKey: z.string(),
  }),

  // OpenAI Configuration
  openai: z.object({
    apiKey: z.string(),
    intentClassifierModel: z.string().default('gpt-4.1-nano'),
  }),

  // Emailing (Resend)
  resend: z.object({
    apiKey: z.string(),
  }),

  // Alerting Configuration
  alert: z.object({
    emailTo: z.string().email().default('alerts@velin.app'),
  }),

  // Logging Configuration
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),

  // Rate Limiting (for custom logic, complements Vercel's built-in protection)
  rateLimit: z.object({
    maxRequests: z.number().default(100),
    windowMs: z.number().default(60000), // 1 minute
  }),

  // Circuit Breaker for external services
  circuitBreaker: z.object({
    failureThreshold: z.number().default(5),
    resetTimeout: z.number().default(60000), // 1 minute
    openai: z.object({
      failureThreshold: z.number().default(3),
      resetTimeout: z.number().default(30000), // 30 seconds
    }),
  }),
});

// Helper function to get configuration based on environment
const getConfigValues = (): z.input<typeof ConfigSchema> => {
  const {
    VERCEL_ENV,
    OPENAI_API_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    ALERT_EMAIL_TO,
  } = process.env;

  const env = Environment.parse(VERCEL_ENV || 'development');

  const baseConfig = {
    env,
    supabase: {
      url: SUPABASE_URL || '',
      anonKey: SUPABASE_ANON_KEY || '',
      serviceRoleKey: SERVICE_ROLE_KEY || '',
    },
    openai: {
      apiKey: OPENAI_API_KEY || '',
    },
    resend: {
      apiKey: RESEND_API_KEY || '',
    },
    alert: {
      emailTo: ALERT_EMAIL_TO || 'alerts@velin.app',
    },
  };

  if (env === 'production') {
    return {
      ...baseConfig,
      logging: {
        level: 'info',
      },
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000,
        openai: {
          failureThreshold: 3,
          resetTimeout: 30000,
        },
      },
    };
  }

  // Development or Preview environments
  return {
    ...baseConfig,
    logging: {
      level: 'debug',
    },
    rateLimit: {
      // More lenient for testing
      maxRequests: 1000,
      windowMs: 60000,
    },
    circuitBreaker: {
      failureThreshold: 10,
      resetTimeout: 10000, // Shorter for easier testing
      openai: {
        failureThreshold: 5,
        resetTimeout: 10000,
      },
    },
  };
};

// Parse and validate the configuration
const config = ConfigSchema.parse(getConfigValues());

export { config };

// Type export for consumers
export type Config = z.infer<typeof ConfigSchema>;
