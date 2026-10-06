const MODEL_URL = '/models/pp_doclayout_s.onnx';
const LABELS = [
  'heading', 'image', 'body', 'page_number', 'abstract', 'body',
  'figure_caption', 'equation', 'table', 'table_caption', 'bibliography',
  'title', 'footnote', 'header', 'other', 'footer', 'other',
  'figure_caption', 'image', 'formula_number', 'image', 'image', 'sidebar'
];
let sessionPromise;
let unavailable;
let stage = 'idle';
export const layoutDetectorStatus = () => stage;

export function needsLayoutInference({ lines, imageBoxes, width, height }) {
  if (imageBoxes.length) return true;
  const narrow = lines.filter(line => line.box.w < width * .55 && line.box.y > height * .05 && line.box.y < height * .9);
  const left = narrow.filter(line => line.box.x + line.box.w / 2 < width / 2);
  const right = narrow.filter(line => line.box.x + line.box.w / 2 >= width / 2);
  if (left.length >= 3 && right.length >= 3) return true;
  return lines.some(line => line.runs?.length >= 3 ||
    (/[=∑∫√≈≤≥]/u.test(line.text) && line.text.length < 100 && line.box.x > width * .12));
}

export function decodeDetections(data, count, imageWidth, imageHeight, pdfWidth, pdfHeight) {
  const regions = [];
  for (let index = 0; index < Math.min(count, Math.floor(data.length / 6)); index++) {
    const [classId, score, ax, ay, bx, by] = data.slice(index * 6, index * 6 + 6);
    const type = LABELS[Math.round(classId)];
    if (!type || type === 'other' || score < .55) continue;
    const x = Math.max(0, Math.min(pdfWidth, ax * pdfWidth / imageWidth));
    const y = Math.max(0, Math.min(pdfHeight, ay * pdfHeight / imageHeight));
    const x2 = Math.max(0, Math.min(pdfWidth, bx * pdfWidth / imageWidth));
    const y2 = Math.max(0, Math.min(pdfHeight, by * pdfHeight / imageHeight));
    if (x2 <= x || y2 <= y) continue;
    regions.push({ type, confidence: score, bounds: { x, y, w: x2 - x, h: y2 - y },
      source: 'PP-DocLayout-S' });
  }
  return regions;
}

async function createSession() {
  const start = performance.now();
  stage = 'runtime';
  // Mobile Safari's supported path is WASM. Browser emulation may report a
  // GPU device while disabling its backend, so avoid a failed GPU init there.
  const preferGpu = navigator.gpu && !/iPad|iPhone|iPod/i.test(navigator.userAgent) &&
    !matchMedia('(max-width: 950px)').matches;
  // Import the vendor's prebuilt ESM from local assets. This avoids Vite
  // bundling unused WASM variants into the production application.
  const runtimeUrl = new URL(preferGpu ? '/ort/ort.webgpu.min.mjs' : '/ort/ort.wasm.min.mjs', location.origin).href;
  const ort = await import(/* @vite-ignore */ runtimeUrl);
  ort.env.wasm.numThreads = 1; // Safari must work without cross-origin isolation.
  ort.env.logLevel = 'error';
  // All runtime code and binaries remain on the application origin.
  const moduleName = preferGpu ? 'ort-wasm-simd-threaded.jsep.mjs' : 'ort-wasm-simd-threaded.mjs';
  const wasmName = preferGpu ? 'ort-wasm-simd-threaded.jsep.wasm' : 'ort-wasm-simd-threaded.wasm';
  ort.env.wasm.wasmPaths = {
    mjs: `/ort/${moduleName}`,
    wasm: `/ort/${wasmName}`
  };
  const response = await fetch(MODEL_URL, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Local layout model unavailable (${response.status})`);
  const weights = new Uint8Array(await response.arrayBuffer());
  stage = 'session';
  let session, provider = 'wasm';
  if (preferGpu) {
    try {
      session = await ort.InferenceSession.create(weights, { executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' });
      provider = 'webgpu';
    } catch { /* Unsupported model operators or GPU: WASM is the supported path. */ }
  }
  session ||= await ort.InferenceSession.create(weights, { executionProviders: ['wasm'], graphOptimizationLevel: 'disabled' });
  stage = 'ready';
  return { ort, session, provider, modelBytes: weights.byteLength, initializationMs: performance.now() - start };
}

async function rasterInput(page, width, height) {
  const scale = 480 / width;
  const viewport = page.getViewport({ scale });
  const raster = document.createElement('canvas');
  raster.width = Math.round(viewport.width); raster.height = Math.round(viewport.height);
  await page.render({ canvasContext: raster.getContext('2d', { alpha: false }), viewport }).promise;
  const square = document.createElement('canvas'); square.width = 480; square.height = 480;
  const context = square.getContext('2d', { willReadFrequently: true });
  context.drawImage(raster, 0, 0, 480, 480);
  const pixels = context.getImageData(0, 0, 480, 480).data;
  const chw = new Float32Array(3 * 480 * 480);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let pixel = 0; pixel < 480 * 480; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      chw[channel * 480 * 480 + pixel] = (pixels[pixel * 4 + channel] / 255 - mean[channel]) / std[channel];
    }
  }
  raster.width = raster.height = square.width = square.height = 0;
  return { chw, imageWidth: viewport.width, imageHeight: viewport.height };
}

export async function detectPageLayout(page, width, height) {
  if (unavailable) return { regions: [], error: unavailable };
  try {
    sessionPromise ||= createSession();
    const runtime = await sessionPromise;
    const start = performance.now();
    stage = 'raster';
    const { chw, imageWidth, imageHeight } = await rasterInput(page, width, height);
    stage = 'inference';
    const outputs = await runtime.session.run({
      image: new runtime.ort.Tensor('float32', chw, [1, 3, 480, 480]),
      scale_factor: new runtime.ort.Tensor('float32', new Float32Array([480 / imageHeight, 480 / imageWidth]), [1, 2])
    });
    const tensors = Object.values(outputs);
    const boxes = tensors.find(tensor => tensor.dims.at(-1) === 6);
    const count = tensors.find(tensor => tensor !== boxes);
    const regions = boxes ? decodeDetections(boxes.data, Number(count?.data[0] ?? boxes.data.length / 6), imageWidth, imageHeight, width, height) : [];
    stage = 'ready';
    return { regions, metrics: { provider: runtime.provider, modelBytes: runtime.modelBytes,
      initializationMs: runtime.initializationMs, inferenceMs: performance.now() - start,
      detections: regions.length,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null } };
  } catch (error) {
    unavailable = String(error?.message || error);
    stage = 'error';
    return { regions: [], error: unavailable };
  }
}
