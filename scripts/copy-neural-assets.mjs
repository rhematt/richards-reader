import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Package tarballs are pinned in package-lock.json. These hashes pin each
// runtime, model and language asset separately and detect upstream drift.
const assets = [
  ['@dittli/tts-core/ort-wasm/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs', '2de262ca1fe2d6e0ef9236bf77632fa01de232ce7b6a33071c37637ee53f4669'],
  ['@dittli/tts-core/ort-wasm/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm', '040d52ce5066707a10d45cb9500c35e70a9c2fb33c4fb63428da9ae45b956b97'],
  ['@dittli/tts-en/assets/en/cmudict.json', 'en/cmudict.json', '592b3a124fc79d850eaa1ec117b13503a48723ae710555fd44f155ba71409740'],
  ['@dittli/tts-en/assets/en/g2p_model.json', 'en/g2p_model.json', 'b9bf424ae0d6fea011960032cee6615097db23ab71c5770576c9c44103f1b49f'],
  ['@dittli/tts-en/assets/en/metadata.json', 'en/metadata.json', 'a95904be55672ee09479d77d658183752fbd39d442b411ae71d8dfcd0f55c712'],
  ['@dittli/tts-en/assets/en/model.onnx', 'en/model.onnx', 'f0244ccac461c46b964a630a2acbb65818ff2454a0d286c31ba878c8cc425efa']
];

for (const [source, target, expected] of assets) {
  const from = resolve('node_modules', source);
  const bytes = await readFile(from);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Neural asset checksum mismatch: ${source}`);
  const to = resolve('public/tts', target);
  await mkdir(resolve(to, '..'), { recursive: true });
  await copyFile(from, to);
}
