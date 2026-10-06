import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerImport } from 'vite';

test('PROFILE-001: exported settings restore exactly and contain no document-derived fields', async () => {
  const { module: { PROFILE_SETTING_IDS, exportProfile, importProfile } } = await runnerImport('/src/profile.js');
  const configured = Object.fromEntries(PROFILE_SETTING_IDS.map((id, index) => [id, index % 3 === 0 ? true : String(index + 1)]));
  configured.documentText = 'Confidential manuscript';
  configured.privateUrl = 'https://private.invalid/file.pdf';
  configured.annotations = [{ text: 'Private note' }];
  configured.history = ['manuscript.pdf'];
  const file = exportProfile(configured);
  for (const forbidden of ['Confidential manuscript', 'private.invalid', 'Private note', 'manuscript.pdf']) {
    assert.ok(!file.includes(forbidden));
  }
  const restored = importProfile(file);
  assert.deepEqual(restored, Object.fromEntries(PROFILE_SETTING_IDS.map(id => [id, configured[id]])));
  assert.throws(() => importProfile('{"version":1,"settings":{"documentText":"leak"}}'));
});

test('HIGHLIGHT-006..008: word colour survives profile round-trip and older profiles get its default', async () => {
  const { module: { PROFILE_SETTING_IDS, WORD_HIGHLIGHT_DEFAULT, exportProfile, importProfile } } = await runnerImport('/src/profile.js');
  assert.ok(PROFILE_SETTING_IDS.includes('word-highlight-color'));
  const configured = Object.fromEntries(PROFILE_SETTING_IDS.map(id => [id, id === 'word-highlight-color' ? '#12ab34' : 'sample']));
  const restored = importProfile(exportProfile(configured));
  assert.equal(restored['word-highlight-color'], '#12ab34', 'HIGHLIGHT-007: export/import preserves word colour');
  const legacy = JSON.parse(exportProfile(configured));
  delete legacy.settings['word-highlight-color'];
  delete legacy.settings['equation-speech'];
  const older = importProfile(JSON.stringify(legacy));
  assert.equal(older['word-highlight-color'], WORD_HIGHLIGHT_DEFAULT, 'HIGHLIGHT-008: older profile gets documented default');
  assert.ok(PROFILE_SETTING_IDS.every(id => id in older), 'older profile restores a complete setting set');
});
