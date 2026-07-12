/**
 * loader.js — Classic-script bootstrap.
 *
 * MV3 content scripts declared in the manifest are always classic scripts,
 * so `import` statements would throw. This stub dynamically imports the real
 * ES-module entry point, which runs in the same isolated world with full
 * chrome.runtime access. Requires src/content/* in web_accessible_resources.
 */
(async () => {
  try {
    await import(chrome.runtime.getURL('src/content/index.js'));
  } catch (err) {
    console.error('[ReplyPilot] Failed to load content module:', err);
  }
})();
