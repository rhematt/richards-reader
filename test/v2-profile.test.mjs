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
