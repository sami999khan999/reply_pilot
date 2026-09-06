import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));

/**
 * An invalid manifest does not fail loudly — Chrome refuses the whole extension
 * and nothing runs at all. These assertions encode the rules that are easy to
 * break while editing the match lists.
 */

test('every file the manifest points at exists', async () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap(cs => cs.js),
    ...Object.values(manifest.icons),
  ];
  for (const path of referenced) {
    await assert.doesNotReject(access(join(ROOT, path)), `missing: ${path}`);
  }
});

test('web_accessible_resources matches are origin-only patterns', () => {
  // Chrome rejects a path here — the manifest becomes invalid and the extension
  // silently fails to load. content_scripts.matches may carry paths; these may not.
  for (const entry of manifest.web_accessible_resources) {
    for (const pattern of entry.matches) {
      assert.match(pattern, /^https:\/\/[^/]+\/\*$/, `not origin-only: ${pattern}`);
    }
  }
});

test('every injected origin can load the extension modules it imports', () => {
  // A content script that cannot import its own module graph does nothing.
  const accessible = manifest.web_accessible_resources.flatMap(e => e.matches)
    .map(p => p.replace(/\/\*$/, ''));

  for (const cs of manifest.content_scripts) {
    for (const pattern of cs.matches) {
      const origin = pattern.replace(/^(https:\/\/[^/]+).*$/, '$1');
      assert.ok(accessible.includes(origin), `${origin} injects but cannot load resources`);
    }
  }
});

test('content script matches are valid patterns', () => {
  for (const cs of manifest.content_scripts) {
    for (const pattern of cs.matches) {
      assert.match(pattern, /^https:\/\/[^/*]+\/\S*$/, `malformed: ${pattern}`);
    }
  }
});

test('every platform we claim to support is actually injected on', async () => {
  const { PLATFORMS, findPlatform } = await import('../src/content/adapters/platforms.js');
  const patterns = manifest.content_scripts.flatMap(cs => cs.matches);

  // Turn each match pattern into a concrete URL and check a platform claims it.
  const covered = new Set();
  for (const pattern of patterns) {
    const url = new URL(pattern.replace(/\*$/, ''));
    const platform = findPlatform(url);
    if (platform) covered.add(platform.id);
  }

  for (const config of PLATFORMS) {
    assert.ok(covered.has(config.id), `${config.id} has a config but no content_scripts match`);
  }
});

test('the extension asks for no more permissions than it uses', () => {
  // Everything else is on-device; storage holds preferences only.
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
});

test('the service worker is a module, matching its import statements', () => {
  assert.equal(manifest.background.type, 'module');
});
