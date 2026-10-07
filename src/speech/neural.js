// The English pack, ONNX runtime, model and pronunciation data load only after
// the user selects local neural speech. All asset URLs are same-origin.
async function loadLocalVoice() {
  const [{ DittliTTS }, _pack] = await Promise.all([
    import('@dittli/tts-core'),
    import('@dittli/tts-en')
  ]);
  return new DittliTTS({ language: 'en', assetBase: '/tts/', executionProviders: ['wasm'] });
}

export class NeuralPlayer {
  constructor({ load = loadLocalVoice, createContext = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
    this.load = load;
    this.createContext = createContext;
    this.context = null;
    this.engine = null;
    this.enginePromise = null;
    this.current = null;
    this.prepared = null;
    this.generation = 0;
    this.metrics = { initializationMs: null, synthesis: [] };
  }

  unlock() {
    if (!this.context) this.context = this.createContext();
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  async #engine() {
    if (this.engine) return this.engine;
    if (!this.enginePromise) {
      const started = performance.now();
      this.enginePromise = this.load().then(async engine => {
      try { await engine.init(); this.engine = engine; return engine; }
      catch (error) { await engine.dispose?.(); throw error; }
      }).then(engine => { this.metrics.initializationMs = performance.now() - started; return engine; })
        .catch(error => { this.enginePromise = null; throw error; });
    }
    return this.enginePromise;
  }

  async #synthesize(text, rate, signal) {
    const engine = await this.#engine();
    if (signal.aborted) throw new DOMException('Speech cancelled', 'AbortError');
    const started = performance.now();
    const result = await engine.synthesize(text, { speed: rate, signal });
    this.metrics.synthesis.push({ milliseconds: performance.now() - started, samples: result.samples.length });
    if (this.metrics.synthesis.length > 12) this.metrics.synthesis.shift();
    return result;
  }

  #clearCurrent() {
    if (!this.current) return;
    const current = this.current;
    this.current = null;
    current.abort.abort();
    if (current.source) {
      current.source.onended = null;
      try { current.source.stop(); } catch { /* already ended */ }
      current.source.disconnect?.();
    }
  }

  async play(text, { rate = 1, nextText = null, onEnd = () => {} } = {}) {
    this.unlock();
    this.#clearCurrent();
    const generation = ++this.generation;
    const matching = this.prepared?.text === text && this.prepared.rate === rate ? this.prepared : null;
    if (!matching) this.prepared?.abort.abort();
    this.prepared = null;
    const abort = matching?.abort || new AbortController();
    const current = { abort, source: null };
    this.current = current;
    try {
      const { samples, sampleRate } = await (matching?.promise || this.#synthesize(text, rate, abort.signal));
      if (generation !== this.generation || abort.signal.aborted) return;
      const buffer = this.context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      current.source = source;
      source.onended = () => {
        if (generation !== this.generation || this.current !== current) return;
        this.current = null;
        source.disconnect?.();
        onEnd();
      };
      source.start();
      if (nextText) this.prepareNext(nextText, rate);
    } catch (error) {
      if (generation !== this.generation || abort.signal.aborted) return;
      this.current = null;
      throw error;
    }
  }

  prepareNext(text, rate = 1) {
    this.prepared?.abort.abort();
    const abort = new AbortController();
    const promise = this.#synthesize(text, rate, abort.signal);
    // The next sentence is optional look-ahead. A failure is reported only if
    // it becomes the sentence being played; never create an unhandled rejection.
    promise.catch(() => {});
    this.prepared = { text, rate, abort, promise };
  }

  pause() { return this.context?.suspend() || Promise.resolve(); }
  resume() { return this.context?.resume() || Promise.resolve(); }
  stop() {
    ++this.generation;
    this.#clearCurrent();
    this.prepared?.abort.abort();
    this.prepared = null;
  }
  async dispose() {
    this.stop();
    const engine = this.engine || await this.enginePromise?.catch(() => null);
    await engine?.dispose?.();
    this.engine = null;
    this.enginePromise = null;
    await this.context?.close();
    this.context = null;
  }
}
