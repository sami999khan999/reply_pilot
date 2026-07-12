/**
 * availability.js
 * Gates all AI calls on the LanguageModel / Summarizer availability state.
 *
 * Chrome 138+ stable exposes `LanguageModel.availability()` returning
 * 'unavailable' | 'downloadable' | 'downloading' | 'available'.
 * Older builds exposed `self.ai.languageModel.capabilities()` with
 * { available: 'readily' | 'after-download' | 'no' }.
 * We support both and normalize to: 'readily' | 'after-download' | 'no' | 'unknown'.
 */

/**
 * @typedef {'readily' | 'after-download' | 'no' | 'unknown'} AIAvailability
 */

/** @param {string} raw @returns {AIAvailability} */
function normalizeAvailability(raw) {
  switch (raw) {
    case 'available':
    case 'readily':
      return 'readily';
    case 'downloadable':
    case 'downloading':
    case 'after-download':
      return 'after-download';
    case 'unavailable':
    case 'no':
      return 'no';
    default:
      return 'unknown';
  }
}

/**
 * Queries availability on an API object, handling both the modern
 * `availability()` and legacy `capabilities()` surfaces.
 * @param {object|null} api
 * @returns {Promise<AIAvailability>}
 */
async function queryAvailability(api) {
  if (!api) return 'no';
  try {
    if (typeof api.availability === 'function') {
      return normalizeAvailability(await api.availability());
    }
    if (typeof api.capabilities === 'function') {
      const caps = await api.capabilities();
      return normalizeAvailability(caps?.available ?? caps?.availability ?? 'no');
    }
    return 'no';
  } catch {
    return 'unknown';
  }
}

/**
 * Checks if the Prompt API (LanguageModel) is available.
 * @returns {Promise<AIAvailability>}
 */
export async function checkLanguageModelAvailability() {
  return queryAvailability(getLanguageModelAPI());
}

/**
 * Checks if the Summarizer API is available.
 * @returns {Promise<AIAvailability>}
 */
export async function checkSummarizerAvailability() {
  return queryAvailability(getSummarizerAPI());
}

/**
 * Gets the LanguageModel API object regardless of which Chrome version's namespace it's in.
 * @returns {object|null}
 */
export function getLanguageModelAPI() {
  return self.LanguageModel ?? self.ai?.languageModel ?? null;
}

/**
 * Gets the Summarizer API object.
 * @returns {object|null}
 */
export function getSummarizerAPI() {
  return self.Summarizer ?? self.ai?.summarizer ?? null;
}
