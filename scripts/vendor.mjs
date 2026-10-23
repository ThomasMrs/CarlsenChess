import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/stockfish/bin/stockfish-19-single.js', 'extension/engine/stockfish-19-single.js'],
  ['node_modules/stockfish/bin/stockfish-19-single.wasm', 'extension/engine/stockfish-19-single.wasm'],
  ['node_modules/chess.js/dist/esm/chess.js', 'extension/vendor/chess.js'],
  ['node_modules/stockfish/Copying.txt', 'extension/licenses/Stockfish-GPL-3.0.txt'],
  ['node_modules/chess.js/LICENSE', 'extension/licenses/chess.js-BSD-2-Clause.txt'],
  ['node_modules/stockfish/Copying.txt', 'LICENSE'],
];
const checksums = [];
for (const [source, target] of files) {
  await mkdir(path.dirname(path.join(root, target)), { recursive: true });
  await copyFile(path.join(root, source), path.join(root, target));
  const hash = createHash('sha256').update(await readFile(path.join(root, target))).digest('hex');
  checksums.push(`${hash}  ${target}`);
}
for (const target of ['vendor-source/stockfish-19.0.1-source.tar.gz','vendor-source/nn-1a298aa575a0.nnue']) {
  const hash = createHash('sha256').update(await readFile(path.join(root,target))).digest('hex');
  if (target.endsWith('.nnue') && !hash.startsWith('1a298aa575a0')) throw new Error('Réseau NNUE inattendu.');
  checksums.push(`${hash}  ${target}`);
}
await writeFile(path.join(root, 'vendor-source/SHA256SUMS'), `${checksums.join('\n')}\n`);
console.log('Moteur complet, règles et licences copiés sans modification.');
