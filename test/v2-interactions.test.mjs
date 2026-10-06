import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerImport } from 'vite';

test('DICT-004..007: sentence click is deferred once and a word double-click only defines', async () => {
  const { module: { createClickArbiter } } = await runnerImport('/src/dictionary/click-arbitration.js');
  const pending = new Map();
  let next = 0;
  const events = [];
  const timer = (callback, ms) => { assert.ok(ms >= 200 && ms <= 300); pending.set(++next, callback); return next; };
  const clear = id => pending.delete(id);
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); };
  const arbiter = createClickArbiter({ timer, clear, onSentence: id => events.push(`speech:${id}`), onDefine: word => events.push(`define:${word}`) });
  arbiter.click({ sentenceId: 's1', word: 'Reader', detail: 1 });
  assert.deepEqual(events, [], 'first click waits for double-click window');
  flush();
  assert.deepEqual(events, ['speech:s1'], 'DICT-004: one click starts one sentence action');
  arbiter.click({ sentenceId: 's2', word: 'Layout', detail: 1 });
  arbiter.click({ sentenceId: 's2', word: 'Layout', detail: 2 });
  arbiter.doubleClick({ sentenceId: 's2', word: 'Layout' });
  flush();
  assert.deepEqual(events, ['speech:s1', 'define:Layout'], 'DICT-005..007: double-click never invokes speech');
});
