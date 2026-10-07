import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// ONNX Runtime dynamically imports its Emscripten loader with ?import. Vite
// otherwise tries to transform this public asset and returns HTTP 500. Serve
// that exact loader as a static same-origin module during source development.
export default defineConfig({
  plugins: [{
    name: 'neural-ort-dev-loader',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/tts/ort/ort-wasm-simd-threaded.mjs') return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        createReadStream(resolve('public/tts/ort/ort-wasm-simd-threaded.mjs'))
          .on('error', next).pipe(response);
      });
    }
  }]
});
