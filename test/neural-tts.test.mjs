import test from 'node:test';
import assert from 'node:assert/strict';
import { NeuralPlayer } from '../src/speech/neural.js';

function harness() {
  const synthesized = [];
  const completed = [];
  let loaded = 0;
  const context = {
    state: 'running', destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createBuffer(_channels, size) { return { getChannelData: () => new Float32Array(size) }; },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() {}, stop() { this.onended?.(); } };
      completed.push(source);
      return source;
    }
  };
  const player = new NeuralPlayer({
    load: async () => { loaded++; return {
      init: async () => {}, dispose: async () => {},
      synthesize: async (value, opts) => { synthesized.push({ value, opts }); return { samples: new Float32Array(32), sampleRate: 22050 }; }
    }; },
    createContext: () => context
  });
  return { player, context, synthesized, completed, get loaded() { return loaded; } };
}

test('TTS-LOCAL-001..008: lazy model, local synthesis, controls and bounded next sentence', async () => {
  const h = harness();
  assert.equal(h.loaded, 0);
  h.player.unlock();
  await h.player.play('Sentence one.', { rate: 1.25, nextText: 'Sentence two.' });
  assert.equal(h.loaded, 1);
  await h.player.prepared?.promise;
  assert.deepEqual(h.synthesized.map(x => x.value), ['Sentence one.', 'Sentence two.']);
  assert.equal(h.synthesized[0].opts.speed, 1.25);
  await h.player.pause();
  assert.equal(h.context.state, 'suspended');
  await h.player.resume();
  assert.equal(h.context.state, 'running');
  h.completed[0].onended();
  await h.player.play('Sentence two.', { rate: 1.25 });
  assert.equal(h.synthesized.length, 2, 'look-ahead result reused');
  h.player.stop();
  assert.equal(h.player.prepared, null);
  await h.player.dispose();
  assert.equal(h.context.state, 'closed');
});

test('TTS-LOCAL-019..020: stopped synthesis cannot complete into another document', async () => {
  const h = harness();
  await h.player.play('Old document.');
  let advanced = false;
  await h.player.play('New sentence.', { onEnd: () => { advanced = true; } });
  h.player.stop();
  h.completed.at(-1).onended?.();
  assert.equal(advanced, false);
  await h.player.dispose();
});
