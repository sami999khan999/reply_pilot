import { findPlatform } from './adapters/platforms.js';
import { GenericAdapter } from './adapters/generic.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';

/**
 * Platforms needing behaviour a config cannot express get a subclass here.
 * Everything else is driven by its config alone.
 * @type {Record<string, typeof GenericAdapter>}
 */
const SPECIALIZED = {
  whatsapp: WhatsAppAdapter,
};

/**
 * Detects the current chat platform and builds its adapter.
 *
 * @param {Location|URL} [location]
 * @returns {{ adapter: GenericAdapter, platform: import('./adapters/platforms.js').PlatformConfig }|null}
 */
export function detect(location = window.location) {
  const config = findPlatform(location);
  if (!config) return null;

  const Adapter = SPECIALIZED[config.id] || GenericAdapter;
  return { adapter: new Adapter(config), platform: config };
}
