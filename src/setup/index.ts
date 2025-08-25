/**
 * Setup Module for Velin Core
 * 
 * This module contains one-time setup scripts and utilities for:
 * - Hotel onboarding
 * - Embedding population
 * - Database initialization
 * - Future: Stripe payment setup, etc.
 */

export {
  populateAllEmbeddings,
  populateFAQEmbeddings,
  populateItemEmbeddings,
  validateHotelExists,
  runSetup,
  type PopulateConfig
} from './populateEmbeddings';

// Future exports for additional setup modules:
// export { setupStripePayments } from './setupPayments';
// export { initializeHotelDatabase } from './hotelInitialization';
// export { setupDefaultItems } from './defaultData';