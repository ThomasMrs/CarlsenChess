import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Chess } from '../extension/vendor/chess.js';

const root = path.resolve(import.meta.dirname, '..');
const resultsPath = path.join(root, 'test-results');
const extensionPath = path.join(resultsPath, 'autoplay-extension-fixture');
const fixtureUrl = 'https://www.chess.com/__carlsenchess_test_fixture/';
const profile = await mkdtemp(path.join(tmpdir(), 'carlsenchess-autoplay-test-'));
const productionManifest = await readFile(path.join(root, 'extension/manifest.json'), 'utf8');
const steps = [];
const failures = [];
const routedRequests = [];
const reactionTimings = [];
let context;
let page;
let background;
let host;
let tabId;

await mkdir(resultsPath, { recursive: true });
await rm(extensionPath, { recursive: true, force: true });
await cp(path.join(root, 'extension'), extensionPath, { recursive: true });
// Only the disposable fixture copy receives this host grant. All Chess.com
// requests are intercepted below and served from local files.
const manifest = JSON.parse(productionManifest);
manifest.host_permissions = ['https://www.chess.com/*'];
await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));

async function messages(type) {
  return background.evaluate((type) => globalThis.__ccAutoplayMessages.filter((message) => message.type === type), type);
}

async function currentFen() {
  return page.locator('#board-analysis-board').evaluate((board) => board.game.getFEN());
}

async function waitFor(check, description, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await page.waitForTimeout(60);
  }
  throw new Error(`Timed out: ${description}`);
}

async function waitForAnalysis(fen, after = 0) {
  return waitFor(async () => (await messages('CC_ANALYZE')).slice(after).find((message) => message.fen === fen), `analysis for ${fen}`);
}

async function waitForPlays(count) {
  return waitFor(async () => {
    const plays = await messages('CC_PLAY_CHESSCOM');
    return plays.length >= count && plays;
  }, `${count} autoplay requests`, 60000);
}

async function setStrength(elo) {
  await host.locator('#cc-strength-mode').selectOption('target');
  await host.locator('#cc-strength').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, elo);
}

async function pause() {
  const button = host.getByRole('button', { name: 'Mettre en pause', exact: true });
  if (await button.count()) await button.click();
}

async function start() {
  await host.getByRole('button', { name: 'Démarrer', exact: true }).click();
}

async function mountPanel() {
  await background.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['content/bootstrap.js'] }), tabId);
  host = page.locator('#carlsenchess-root');
  await host.getByRole('button', { name: 'Démarrer', exact: true }).waitFor();
  await page.evaluate(() => {
    window.__ccReactionStatuses = [];
    const status = document.querySelector('#carlsenchess-root').shadowRoot.querySelector('[data-ref="status"]');
    const observer = new MutationObserver(() => {
      const waitMs = Number(status.dataset.reactionWaitMs);
      if (!status.dataset.reactionWaitMs || !Number.isFinite(waitMs)) return;
      const record = { at: Date.now(), waitMs, targetMs: Number(status.dataset.reactionTargetMs),
        level: status.dataset.reactionLevel, text: status.textContent };
      window.__ccReactionStatuses.push(record);
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true, attributes: true });
  });
}

async function reactionStatuses() {
  return page.evaluate(() => window.__ccReactionStatuses);
}

async function waitForReaction(after = 0) {
  return waitFor(async () => (await reactionStatuses()).slice(after).find((record) => record.waitMs >= 0), 'a displayed reaction delay');
}

async function expectReactionSaved(value) {
  await waitFor(() => background.evaluate(async (value) => (await chrome.storage.local.get('ccSettings')).ccSettings?.reactionTiming === value, value), `persisted reactionTiming=${value}`);
}

async function loadFen(fen) {
  await page.locator('#fen-input').fill(fen);
  await page.locator('#load-fen').click();
  assert.equal(await page.locator('#fixture-error').innerText(), '', 'fixture FEN loading succeeds');
  assert.equal(await currentFen(), fen);
}

async function playFirstLegalMove() {
  const fen = await currentFen();
  const game = new Chess(fen);
  const move = game.moves({ verbose: true }).find((candidate) => !candidate.promotion);
  assert.ok(move, 'the fixture has a legal ordinary move');
  game.move(move);
  await page.locator(`[data-square="${move.from}"]`).click();
  await page.locator(`[data-square="${move.to}"]`).click();
  assert.equal(await currentFen(), game.fen(), 'manual fixture clicks execute exactly one legal move');
  return game.fen();
}

async function expectNoExtraPlays(count, duration = 1400) {
  await page.waitForTimeout(duration);
  assert.equal((await messages('CC_PLAY_CHESSCOM')).length, count, 'autoplay emits no duplicate or opponent action');
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1200 },
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
    globalThis.__ccAutoplayMessages = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (['CC_READ_CHESSCOM', 'CC_ANALYZE', 'CC_STOP', 'CC_PLAY_CHESSCOM'].includes(message?.type)) {
        globalThis.__ccAutoplayMessages.push({ type: message.type, fen: message.fen, uci: message.uci, playerColor: message.playerColor, settings: message.settings, at: Date.now() });
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
  tabId = await background.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/__carlsenchess_test_fixture/'))?.id);
  assert.ok(Number.isInteger(tabId));
  await mountPanel();
  const initialFen = await currentFen();
  assert.equal(initialFen, new Chess().fen());
  assert.equal(await host.locator('#cc-autoplay').isChecked(), false, 'automatic play is an explicit per-load opt-in');
  assert.equal(await host.locator('#cc-reaction-timing').isChecked(), true, 'adaptive reaction is enabled by default');
  await host.locator('#cc-reaction-timing').uncheck();
  await expectReactionSaved(false);
  assert.equal(await host.locator('#cc-player-color').inputValue(), 'w');
  assert.deepEqual(await host.locator('#cc-strength').evaluate((input) => ({ min: input.min, max: input.max, step: input.step })), { min: '500', max: '3000', step: '500' });
  await host.locator('#cc-humanize').uncheck();
  await host.locator('#cc-time').selectOption('400');
  await setStrength(500);
  await start();
  const lowRequest = await waitForAnalysis(initialFen);
  assert.equal(lowRequest.settings.elo, 500, '500 Elo is passed as requested instead of clamping the UI to the engine minimum');
  await host.locator('[data-ref="badge"][data-state="ready"]').waitFor({ timeout: 60000 });
  await expectNoExtraPlays(0, 500);
  assert.equal(await currentFen(), initialFen);
  let count = (await messages('CC_ANALYZE')).length;
  await setStrength(1000);
  const nextRequest = await waitForAnalysis(initialFen, count);
  assert.equal(nextRequest.settings.elo, 1000, '1000 Elo reaches the analysis settings');
  await host.locator('[data-ref="badge"][data-state="ready"]').waitFor();
  steps.push('Elo 500 et 1000 sélectionnables par pas de 500, transmis au moteur ; jeu automatique désactivé par défaut');

  const fastStatusCount = (await reactionStatuses()).length;
  await host.locator('#cc-autoplay').check();
  const fastReaction = await waitForReaction(fastStatusCount);
  let plays = await waitForPlays(1);
  const fastObservedWait = plays[0].at - fastReaction.at;
  assert.equal(fastReaction.waitMs, 400, 'disabling adaptive reaction retains the 400 ms post-calculation delay');
  assert.ok(fastObservedWait >= 300 && fastObservedWait <= 1600, `quick mode really waits about 400 ms after the calculation (observed ${fastObservedWait} ms)`);
  reactionTimings.push({ mode: 'fast', ...fastReaction, observedWaitMs: fastObservedWait });
  await waitFor(async () => (await currentFen()).split(' ')[1] === 'b', 'the first automatic white move is reflected by the board');
  const afterWhite = await currentFen();
  assert.equal(plays[0].fen, initialFen);
  assert.equal(plays[0].playerColor, 'w');
  const expected = new Chess(initialFen);
  expected.move({ from: plays[0].uci.slice(0, 2), to: plays[0].uci.slice(2, 4), ...(plays[0].uci[4] ? { promotion: plays[0].uci[4] } : {}) });
  assert.equal(afterWhite, expected.fen(), 'the full source FEN and legal UCI produce the exact fixture result');
  await expectNoExtraPlays(1);
  const afterManualBlack = await playFirstLegalMove();
  plays = await waitForPlays(2);
  await waitFor(async () => (await currentFen()).split(' ')[1] === 'b', 'white responds to the manually played black move');
  assert.equal(plays[1].fen, afterManualBlack);
  await expectNoExtraPlays(2);
  steps.push('une seule action des Blancs, attente des Noirs, puis reprise après un coup adverse manuel');

  await pause();
  await page.locator('#reset-game').click();
  await host.locator('#cc-strength-mode').selectOption('max');
  await host.locator('#cc-time').selectOption('2500');
  count = (await messages('CC_ANALYZE')).length;
  await start();
  await waitForAnalysis(initialFen, count);
  await host.locator('#cc-player-color').selectOption('b');
  await expectNoExtraPlays(2, 3300);
  assert.equal(await currentFen(), initialFen, 'changing selected side invalidates a pending white action');
  const afterManualWhite = await playFirstLegalMove();
  plays = await waitForPlays(3);
  await waitFor(async () => (await currentFen()).split(' ')[1] === 'w', 'selected black side executes its move');
  assert.equal(plays[2].fen, afterManualWhite);
  assert.equal(plays[2].playerColor, 'b');
  await expectNoExtraPlays(3);
  steps.push('changement de camp pendant le calcul : ancienne action annulée, seul le camp choisi est joué');

  await pause();
  await page.locator('#reset-game').click();
  await host.locator('#cc-player-color').selectOption('w');
  count = (await messages('CC_ANALYZE')).length;
  await start();
  await waitForAnalysis(initialFen, count);
  await pause();
  await expectNoExtraPlays(3, 3300);
  assert.equal(await currentFen(), initialFen, 'pause cancels automatic moves while a real engine calculation is pending');
  steps.push('pause pendant un calcul Stockfish réel : aucun clic différé');

  // Visibility is a browser state input. Override the fixture document only so
  // this remains reproducible in headless Chromium where background tabs may
  // remain visible to the Page Visibility API.
  count = (await messages('CC_ANALYZE')).length;
  await start();
  await waitForAnalysis(initialFen, count);
  await background.evaluate((tabId) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    },
  }), tabId);
  await expectNoExtraPlays(3, 3300);
  assert.equal(await currentFen(), initialFen, 'hidden fixture state prevents an automatic move');
  await background.evaluate((tabId) => chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', func: () => {
      delete document.visibilityState;
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  }), tabId);
  await pause();
  steps.push('document masqué pendant un calcul : aucun coup automatique');

  await page.reload();
  await page.locator('#board-analysis-board .piece').first().waitFor();
  await mountPanel();
  assert.equal(await host.locator('#cc-autoplay').isChecked(), false, 'autoplay must not survive a page reload');
  assert.equal(await host.locator('#cc-reaction-timing').isChecked(), false, 'the reaction preference survives a page reload');
  await host.locator('#cc-time').selectOption('400');
  await start();
  await host.locator('[data-ref="badge"][data-state="ready"]').waitFor({ timeout: 60000 });
  await expectNoExtraPlays(3, 700);
  assert.equal(await currentFen(), initialFen);
  await pause();
  steps.push('rechargement : activation automatique oubliée, démarrage de l’analyse sans jouer');

  await host.locator('#cc-reaction-timing').check();
  await expectReactionSaved(true);
  await host.locator('#cc-strength-mode').selectOption('max');
  await host.locator('#cc-player-color').selectOption('w');
  await host.locator('#cc-autoplay').check();
  const complexFen = 'r3k2r/p1ppqpb1/bn2pnp1/2pP4/1p2P3/2N2N2/PPQBBPPP/R3K2R w KQkq - 0 1';
  await loadFen(complexFen);
  let statusCount = (await reactionStatuses()).length;
  await start();
  let adaptiveReaction = await waitForReaction(statusCount);
  assert.match(adaptiveReaction.text, /attente de \d+[,.]\d\s*s/i, 'the estimated remaining wait is visible');
  assert.ok(adaptiveReaction.targetMs >= 3000, `the complex position has a meaningful reaction target (${adaptiveReaction.targetMs} ms)`);
  assert.ok(adaptiveReaction.waitMs > 800, `complex positions wait after analysis (${adaptiveReaction.waitMs} ms)`);
  await expectNoExtraPlays(3, 650);
  assert.equal(await currentFen(), complexFen, 'no move occurs immediately after the complex calculation finishes');
  await pause();
  await expectNoExtraPlays(3, 250);
  assert.equal(await host.locator('[data-ref="status"]').getAttribute('data-reaction-wait-ms'), null, 'pause clears the displayed pending delay');
  reactionTimings.push({ mode: 'adaptive-paused', ...adaptiveReaction });

  statusCount = (await reactionStatuses()).length;
  await start();
  adaptiveReaction = await waitForReaction(statusCount);
  await expectNoExtraPlays(3, 650);
  await host.locator('#cc-player-color').selectOption('b');
  await expectNoExtraPlays(3, 800);
  assert.equal(await currentFen(), complexFen, 'changing camp cancels the pending adaptive move');
  await pause();
  reactionTimings.push({ mode: 'adaptive-side-changed', ...adaptiveReaction });

  await host.locator('#cc-player-color').selectOption('w');
  statusCount = (await reactionStatuses()).length;
  await start();
  adaptiveReaction = await waitForReaction(statusCount);
  const adaptiveAnalysis = (await messages('CC_ANALYZE')).at(-1);
  plays = await waitForPlays(4);
  const adaptivePlay = plays[3];
  const adaptiveObservedWait = adaptivePlay.at - adaptiveReaction.at;
  assert.equal(adaptivePlay.fen, complexFen);
  assert.ok(adaptiveObservedWait >= adaptiveReaction.waitMs - 100, `adaptive play respects its displayed post-calculation delay (${adaptiveObservedWait} ms)`);
  assert.ok(adaptiveObservedWait <= adaptiveReaction.waitMs + 1800, 'the displayed reaction delay stays consistent with execution');
  assert.ok(adaptivePlay.at - adaptiveAnalysis.at >= adaptiveReaction.targetMs - 250, 'the reaction target includes engine computation time');
  await waitFor(async () => (await currentFen()).split(' ')[1] === 'b', 'the adaptive move is reflected by the fixture');
  await expectNoExtraPlays(4, 500);
  await pause();
  reactionTimings.push({ mode: 'adaptive-executed', ...adaptiveReaction, observedWaitMs: adaptiveObservedWait, analysisToPlayMs: adaptivePlay.at - adaptiveAnalysis.at });
  steps.push('réaction adaptative activée par défaut et enregistrée ; attente complexe affichée et respectée, annulée par pause et changement de camp ; mode rapide à 400 ms');

  await page.screenshot({ path: path.join(resultsPath, 'CarlsenChess-autoplay-fixture.png'), fullPage: true });
  assert.deepEqual(failures, [], 'browser console and page errors');
  assert.equal(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'), productionManifest, 'the production manifest remains unchanged');
  const report = { ok: true, validation: 'Fixture locale interceptée sous origine Chess.com ; ne valide ni une partie en ligne réelle ni une indétectabilité.', browser: context.browser()?.version(), routedRequests, steps, reactionTimings, playRequests: await messages('CC_PLAY_CHESSCOM') };
  await writeFile(path.join(resultsPath, 'autoplay-e2e.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(resultsPath, 'autoplay-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(resultsPath, 'autoplay-e2e.json'), JSON.stringify({ ok: false, validation: 'Fixture locale Chess.com', steps, failures, error: error.message }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extensionPath, { recursive: true, force: true });
}
