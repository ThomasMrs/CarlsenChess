import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';

const root = path.resolve(import.meta.dirname, '..');
const resultsPath = path.join(root, 'test-results');
const extensionPath = path.join(resultsPath, 'chesscom-extension-fixture');
const fixtureUrl = 'https://www.chess.com/__carlsenchess_test_fixture/';
const profile = await mkdtemp(path.join(tmpdir(), 'carlsenchess-chesscom-test-'));
const productionManifest = await readFile(path.join(root, 'extension/manifest.json'), 'utf8');
const steps = [];
const failures = [];
const routedRequests = [];
let context;
let page;
let background;
let host;

await mkdir(resultsPath, { recursive: true });
await rm(extensionPath, { recursive: true, force: true });
await cp(path.join(root, 'extension'), extensionPath, { recursive: true });
// The test cannot grant activeTab through a physical Chrome toolbar click.
// Only this disposable copy receives permission to the intercepted fixture
// origin. Production permissions and domain checks remain unchanged.
const manifest = JSON.parse(productionManifest);
manifest.host_permissions = ['https://www.chess.com/*'];
await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));

async function messages(type) {
  return background.evaluate((type) => globalThis.__ccFixtureMessages.filter((message) => message.type === type), type);
}

async function waitForAnalysis(fen, after = 0, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const requests = await messages('CC_ANALYZE');
    if (requests.length > after && requests.at(-1).fen === fen) return requests.at(-1);
    await page.waitForTimeout(80);
  }
  throw new Error(`No fresh engine request for FEN ${fen}`);
}

async function overlayDisplay() {
  return host.locator('.cc-overlay').evaluate((element) => getComputedStyle(element).display);
}

async function expectReady(fen, { after = 0, timeout = 25000 } = {}) {
  await waitForAnalysis(fen, after, timeout);
  await host.locator('[data-ref="badge"][data-state="ready"]').waitFor({ timeout });
  assert.equal(await overlayDisplay(), 'block', 'a current suggestion must draw its arrow');
  const coordinates = await host.locator('[data-ref="coordinates"]').innerText();
  const match = coordinates.match(/^([a-h][1-8])\s*→\s*([a-h][1-8])(?:.*promotion\s+([QRBN]))?/i);
  assert.ok(match, `suggestion coordinates are readable: ${coordinates}`);
  const chess = new Chess(fen);
  const move = chess.move({ from: match[1], to: match[2], ...(match[3] ? { promotion: match[3].toLowerCase() } : {}) });
  assert.equal(await host.locator('[data-ref="move"]').innerText(), move.san, 'the displayed SAN is legal for the exact current FEN');
  const [arrow, rect, flipped] = await Promise.all([
    host.locator('.cc-arrow').evaluate((element) => ({ x: Number(element.getAttribute('x1')), y: Number(element.getAttribute('y1')) })),
    page.locator('#board-analysis-board').boundingBox(),
    page.locator('#board-analysis-board').evaluate((board) => board.classList.contains('flipped')),
  ]);
  assert.ok(rect, 'the board must be visible');
  const file = match[1].charCodeAt(0) - 97;
  const rank = Number(match[1][1]) - 1;
  const expectedX = rect.x + ((flipped ? 7 - file : file) + 0.5) * rect.width / 8;
  const expectedY = rect.y + ((flipped ? rank : 7 - rank) + 0.5) * rect.height / 8;
  assert.ok(Math.abs(arrow.x - expectedX) < 1 && Math.abs(arrow.y - expectedY) < 1, 'the arrow starts at the current move source square in the current orientation');
  assert.equal((await messages('CC_ANALYZE')).at(-1).fen, fen, 'the full FEN must reach Stockfish without reconstruction');
  return { fen, move: move.san, coordinates };
}

async function loadFen(fen) {
  await page.locator('#fen-input').fill(fen);
  await page.locator('#load-fen').click();
  assert.equal(await page.locator('#fixture-error').innerText(), '', 'fixture FEN loading must succeed');
  return page.locator('#board-analysis-board').evaluate((board) => board.game.getFEN());
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('https://www.chess.com/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    routedRequests.push(pathname);
    let relative;
    if (pathname.startsWith('/__carlsenchess_test_fixture/')) relative = 'demo/chesscom.html';
    else if (['/demo/chesscom-fixture.js', '/demo/chesscom-fixture.css', '/extension/vendor/chess.js'].includes(pathname)) relative = pathname.slice(1);
    else if (pathname === '/favicon.ico') { await route.fulfill({ status: 204 }); return; }
    else { await route.fulfill({ status: 404, body: 'Fixture route unavailable' }); return; }
    const contentType = relative.endsWith('.html') ? 'text/html; charset=utf-8' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    await route.fulfill({ status: 200, contentType, body: await readFile(path.join(root, relative)) });
  });
  background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await background.evaluate(() => {
    globalThis.__ccFixtureMessages = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (['CC_READ_CHESSCOM', 'CC_ANALYZE', 'CC_STOP'].includes(message?.type)) {
        globalThis.__ccFixtureMessages.push({ type: message.type, fen: message.fen, at: Date.now() });
      }
      return false;
    });
  });
  page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto(fixtureUrl);
  await page.locator('#board-analysis-board .piece').first().waitFor();
  assert.match(await page.locator('.notice').innerText(), /Fixture de test locale.*aucune connexion Chess\.com/);
  const initialFen = await page.locator('#board-analysis-board').evaluate((board) => board.game.getFEN());
  assert.equal(initialFen, new Chess().fen());
  const tabId = await background.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/__carlsenchess_test_fixture/'))?.id);
  assert.ok(Number.isInteger(tabId));
  const isolated = await background.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => ({ hasGameApi: typeof document.querySelector('#board-analysis-board').game?.getFEN === 'function', hasFenAttribute: [...document.querySelector('#board-analysis-board').attributes].some((attribute) => /fen/i.test(attribute.name)) }),
    });
    return result.result;
  }, tabId);
  assert.deepEqual(isolated, { hasGameApi: false, hasFenAttribute: false }, 'the isolated content world cannot directly read the page game API or a FEN attribute');
  await background.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['content/bootstrap.js'] }), tabId);
  host = page.locator('#carlsenchess-root');
  await host.getByRole('button', { name: 'Démarrer', exact: true }).waitFor();
  await host.locator('#cc-strength-mode').selectOption('max');
  await host.locator('#cc-humanize').uncheck();
  await host.locator('#cc-time').selectOption('400');
  await host.getByRole('button', { name: 'Démarrer', exact: true }).click();
  await expectReady(initialFen, { timeout: 60000 });
  assert.ok((await messages('CC_READ_CHESSCOM')).length > 0, 'the content client must use the background MAIN-world bridge');
  steps.push('fixture locale sous origine Chess.com interceptée ; séparation MAIN/ISOLATED et Stockfish réel');

  let count = (await messages('CC_ANALYZE')).length;
  await page.locator('#play-e2e4').click();
  const afterWhiteFen = await page.locator('#board-analysis-board').evaluate((board) => board.game.getFEN());
  await expectReady(afterWhiteFen, { after: count });
  assert.equal(await host.locator('[data-ref="source"]').innerText(), 'Chess.com · Noirs');
  count = (await messages('CC_ANALYZE')).length;
  await page.locator('#play-e7e5').click();
  const afterBlackFen = await page.locator('#board-analysis-board').evaluate((board) => board.game.getFEN());
  await expectReady(afterBlackFen, { after: count });
  assert.equal(await host.locator('[data-ref="source"]').innerText(), 'Chess.com · Blancs');
  steps.push('e2e4 et e7e5 relus automatiquement avec le trait complet');

  count = (await messages('CC_ANALYZE')).length;
  await page.locator('#flip-board').click();
  await expectReady(afterBlackFen, { after: count });
  steps.push('orientation retournée et départ de la flèche sur la bonne case');

  count = (await messages('CC_ANALYZE')).length;
  await page.evaluate(() => { window.__ccPreviousBoard = document.querySelector('#board-analysis-board'); });
  await page.locator('#replace-board').click();
  assert.equal(await page.evaluate(() => window.__ccPreviousBoard === document.querySelector('#board-analysis-board')), false);
  await expectReady(afterBlackFen, { after: count });
  steps.push('remplacement du nœud plateau à FEN identique et nouveau calcul');

  count = (await messages('CC_ANALYZE')).length;
  const rightsFen = 'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 20';
  assert.equal(await loadFen(rightsFen), rightsFen);
  await expectReady(rightsFen, { after: count });
  steps.push('FEN exacte avec les quatre droits de roque et prise en passant transmise au moteur');

  // Change the page while a longer real engine calculation is pending. Its late
  // response must be discarded and the final arrow legal for the newer FEN.
  await host.locator('#cc-time').selectOption('2500');
  count = (await messages('CC_ANALYZE')).length;
  const obsoleteFen = '6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1';
  await loadFen(obsoleteFen);
  await waitForAnalysis(obsoleteFen, count);
  count = (await messages('CC_ANALYZE')).length;
  const freshFen = await loadFen('r3k2r/8/8/8/3pP3/8/8/R3K2R b KQkq e3 0 20');
  await expectReady(freshFen, { after: count });
  await page.waitForTimeout(300);
  await expectReady(freshFen);
  steps.push('position changée pendant un calcul réel, résultat périmé ignoré et coup actuel légal');

  await page.evaluate(() => {
    const board = document.querySelector('#board-analysis-board');
    window.__ccSavedGameApi = board.game;
    board.game = { getFEN: () => 'invalid FEN' };
  });
  await host.locator('[data-ref="badge"][data-state="waiting"]').waitFor({ timeout: 10000 });
  assert.equal(await overlayDisplay(), 'none');
  assert.equal(await host.locator('[data-ref="move"]').innerText(), '—');
  count = (await messages('CC_ANALYZE')).length;
  await page.evaluate(() => { delete document.querySelector('#board-analysis-board').game; });
  await page.waitForTimeout(1400);
  assert.equal(await overlayDisplay(), 'none');
  assert.equal((await messages('CC_ANALYZE')).length, count, 'missing full FEN must never trigger a reconstructed analysis');
  await page.evaluate(() => { document.querySelector('#board-analysis-board').game = window.__ccSavedGameApi; });
  await expectReady(freshFen, { after: count });
  steps.push('API invalide puis absente : attente, aucune flèche périmée, aucune FEN inventée, reprise');

  await host.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  assert.equal(await overlayDisplay(), 'none');
  await page.waitForTimeout(300);
  const pausedReadCount = (await messages('CC_READ_CHESSCOM')).length;
  const pausedAnalysisCount = (await messages('CC_ANALYZE')).length;
  await page.locator('#reset-game').click();
  await page.waitForTimeout(1400);
  assert.equal(await host.locator('[data-ref="badge"]').innerText(), 'En pause');
  assert.equal(await overlayDisplay(), 'none');
  assert.equal((await messages('CC_READ_CHESSCOM')).length, pausedReadCount, 'pause must stop subsequent page-state RPC');
  assert.equal((await messages('CC_ANALYZE')).length, pausedAnalysisCount, 'pause must stop subsequent engine requests');
  steps.push('pause : aucune lecture RPC, aucun calcul et aucune flèche après changement du plateau');

  await host.locator('#cc-time').selectOption('400');
  await loadFen(obsoleteFen);
  count = (await messages('CC_ANALYZE')).length;
  await host.getByRole('button', { name: 'Démarrer', exact: true }).click();
  const mate = await expectReady(obsoleteFen, { after: count });
  assert.match(mate.move, /#$/, 'maximum strength without humanization must identify the forced mate');
  await page.screenshot({ path: path.join(resultsPath, 'CarlsenChess-chesscom-fixture.png'), fullPage: true });
  steps.push('mat en un à puissance maximale et capture identifiée comme fixture de test');
  await host.getByRole('button', { name: 'Mettre en pause', exact: true }).click();

  assert.deepEqual(failures, [], 'browser console and page errors');
  assert.equal(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'), productionManifest, 'the production manifest remains unchanged');
  const report = { ok: true, validation: 'Fixture locale interceptée sous origine Chess.com ; ce test ne valide pas une partie en ligne sur le site réel.', browser: context.browser()?.version(), routedRequests, steps };
  await writeFile(path.join(resultsPath, 'chesscom-e2e.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(resultsPath, 'chesscom-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(resultsPath, 'chesscom-e2e.json'), JSON.stringify({ ok: false, validation: 'Fixture locale Chess.com', steps, failures, error: error.message }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extensionPath, { recursive: true, force: true });
}
