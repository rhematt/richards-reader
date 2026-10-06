import test from 'node:test';
import assert from 'node:assert/strict';
import { defineWord } from '../src/dictionary/index.js';

test('DICT-001/002: a bounded local dictionary defines words without network and handles misses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Dictionary made a network request'); };
  try {
    const result = await defineWord('reader');
    assert.equal(result.headword, 'reader');
    assert.ok(result.senses.some(sense => sense.partOfSpeech === 'noun' && sense.definition.length > 15));
    assert.equal(await defineWord('zzqnotaword'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
