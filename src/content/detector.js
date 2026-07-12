import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { MessengerAdapter } from './adapters/messenger.js';

const ADAPTERS = {
  'web.whatsapp.com': () => new WhatsAppAdapter(),
  'www.messenger.com': () => new MessengerAdapter(),
  'www.facebook.com': () => new MessengerAdapter(),
};

/**
 * Detects the current chat platform and returns the appropriate adapter instance.
 * @returns {{ adapter: import('./adapters/base.js').BaseAdapter, platform: string } | null}
 */
export function detect() {
  const host = location.hostname;
  const factory = ADAPTERS[host];
  if (!factory) return null;
  const adapter = factory();
  return { adapter, platform: host };
}
