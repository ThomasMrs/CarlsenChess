import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readChessComPlacement, readChessComSnapshot } from '../extension/content/chesscom-bridge.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EP_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
let dom;

function page(html = '<wc-chess-board class="board" id="board-analysis-board"></wc-chess-board>', url = 'https://www.chess.com/analysis') {
  dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  return dom.window.document;
}

function board(document, selector = 'wc-chess-board', fen = START_FEN, width = 480, height = width) {
  const element = document.querySelector(selector);
  element.getBoundingClientRect = () => ({ width, height, left: 16, top: 24, right: 16 + width, bottom: 24 + height });
  element.game = { getFEN: () => fen };
  for (const [index, rank] of fen.split(' ')[0].split('/').entries()) {
    let file = 1;
    for (const character of rank) {
      if (/^[1-8]$/.test(character)) { file += Number(character); continue; }
      const piece = document.createElement('div');
      const color = character === character.toUpperCase() ? 'w' : 'b';
      piece.className = `piece ${color}${character.toLowerCase()} square-${file}${8 - index}`;
      element.append(piece);
      file += 1;
    }
  }
  return element;
}

// Execute the serialized function in the page realm, as scripting.executeScript does.
function snapshot(selector = '') {
  dom.window.__boardSelector = selector;
  return JSON.parse(JSON.stringify(dom.window.eval(`(${readChessComSnapshot.toString()})(__boardSelector)`)));
}

function animation(target, { playState = 'running', pending = false, duration = 180, property = 'transform' } = {}) {
  return {
    playState, pending,
    effect: {
      target,
      getComputedTiming: () => ({ activeDuration: duration }),
      getKeyframes: () => [{ [property]: 'start' }, { [property]: 'end' }],
    },
  };
}

afterEach(() => { dom?.window.close(); });

test('serialized MAIN-world reader returns a complete FEN with castling and en passant intact', () => {
  const document = page();
  board(document, 'wc-chess-board', EP_FEN);
  assert.deepEqual(snapshot(), {
    ok: true, fen: EP_FEN, orientation: 'white', boardId: 'board-analysis-board',
    placement: EP_FEN.split(' ')[0], error: null,
  });
});

test('flipped boards report black orientation without reversing the FEN', () => {
  const document = page();
  board(document).classList.add('flipped');
  assert.equal(snapshot().orientation, 'black');
  assert.equal(snapshot().fen, START_FEN);
});

test('explicit orientation attributes take precedence over a flipped ancestor', () => {
  const document = page('<section class="flipped"><chess-board id="board" orientation="white"></chess-board></section>');
  const element = board(document, 'chess-board');
  assert.equal(snapshot().orientation, 'white');
  element.removeAttribute('orientation');
  assert.equal(snapshot().orientation, 'black');
});

test('the largest visible square board supplies its own FEN', () => {
  const document = page('<wc-chess-board id="small"></wc-chess-board><chess-board id="large"></chess-board><wc-chess-board id="wide"></wc-chess-board>');
  board(document, '#small', START_FEN, 180);
  board(document, '#large', EP_FEN, 520);
  board(document, '#wide', START_FEN, 1100, 200);
  assert.equal(snapshot().boardId, 'large');
  assert.equal(snapshot().fen, EP_FEN);
});

test('hidden ancestors and transparent boards are excluded', () => {
  const document = page('<section hidden><wc-chess-board id="hidden"></wc-chess-board></section><chess-board id="transparent" style="opacity:0"></chess-board><wc-chess-board id="visible"></wc-chess-board>');
  board(document, '#hidden', START_FEN, 800);
  board(document, '#transparent', START_FEN, 700);
  board(document, '#visible', EP_FEN, 400);
  assert.equal(snapshot().boardId, 'visible');
});

test('an explicit selector is exclusive and can select a supported legacy wrapper', () => {
  const document = page('<wc-chess-board id="large"></wc-chess-board><div id="board-single"><div class="board" id="legacy"></div></div>');
  board(document, '#large', START_FEN, 600);
  board(document, '#legacy', EP_FEN, 300);
  assert.equal(snapshot('#legacy').boardId, 'legacy');
  assert.equal(snapshot('#missing').ok, false);
  assert.match(snapshot('[').error, /Sélecteur.*invalide/);
});

test('the CarlsenChess host is excluded even if an explicit selector matches it', () => {
  const document = page('<div id="carlsenchess-root"><wc-chess-board id="fake"></wc-chess-board></div><wc-chess-board id="real"></wc-chess-board>');
  board(document, '#fake', START_FEN, 900);
  board(document, '#real', EP_FEN, 400);
  assert.equal(snapshot().boardId, 'real');
  assert.equal(snapshot('#fake').ok, false);
});

test('only chess.com and its actual subdomains pass the hostname guard', () => {
  for (const hostname of ['chess.com', 'www.chess.com', 'play.chess.com']) {
    const document = page(undefined, `https://${hostname}/analysis`);
    board(document);
    assert.equal(snapshot().ok, true, hostname);
    dom.window.close();
  }
  const document = page(undefined, 'http://www.chess.com/analysis');
  board(document);
  assert.match(snapshot().error, /HTTPS/);
  for (const hostname of ['chess.com.example.org', 'fakechess.com', 'example.com']) {
    const document = page(undefined, `https://${hostname}/analysis`);
    const element = board(document);
    element.game.getFEN = () => { throw new Error('The domain guard must run first'); };
    assert.match(snapshot().error, /réservée.*chess.com/, hostname);
    dom.window.close();
  }
});

test('a full FEN attribute is a fallback when the game API is unavailable', () => {
  const document = page();
  const element = board(document, 'wc-chess-board', EP_FEN);
  delete element.game;
  element.setAttribute('data-fen', EP_FEN);
  assert.equal(snapshot().fen, EP_FEN);
});

test('a throwing game getter or getFEN method does not escape the reader', () => {
  const document = page();
  const element = board(document);
  Object.defineProperty(element, 'game', { configurable: true, get() { throw new Error('not ready'); } });
  assert.equal(snapshot().ok, false);
  assert.match(snapshot().error, /FEN complète/);
  element.setAttribute('fen', START_FEN);
  assert.equal(snapshot().ok, true);
  Object.defineProperty(element, 'game', { value: { getFEN() { throw new Error('not ready'); } } });
  element.removeAttribute('fen');
  assert.equal(snapshot().ok, false);
});

test('missing game state returns a French actionable error without inventing FEN fields', () => {
  const document = page();
  const element = board(document);
  delete element.game;
  const result = snapshot();
  assert.equal(result.fen, null);
  assert.equal(result.boardId, 'board-analysis-board');
  assert.match(result.error, /FEN complète Chess.com indisponible/);
});

test('piece-only, incomplete and malformed FEN values are rejected', () => {
  const document = page();
  const element = board(document);
  for (const fen of [START_FEN.split(' ')[0], `${START_FEN} extra`, '8/8/8/8/8/8/8/9 w - - 0 1',
    '8/8/8/8/8/8/8/8 x - - 0 1', '8/8/8/8/8/8/8/8 w qK - 0 1',
    '8/8/8/8/8/8/8/8 w - e4 0 1', '8/8/8/8/8/8/8/8 w - - -1 1',
    '8/8/8/8/8/8/8/8 w - - 0 0']) {
    element.game.getFEN = () => fen;
    assert.equal(snapshot().fen, null, fen);
  }
});

test('mismatching visible piece placement suppresses stale API positions', () => {
  const document = page();
  const element = board(document);
  element.querySelector('.wp.square-52').classList.replace('square-52', 'square-54');
  assert.equal(snapshot().ok, false);
  assert.match(snapshot().error, /cours de changement/);
});

test('visible duplicate pieces and promotion code ambiguity are transient errors', () => {
  const document = page();
  const element = board(document);
  const pawn = element.querySelector('.wp.square-52');
  const clone = pawn.cloneNode(true);
  element.append(clone);
  assert.equal(snapshot().ok, false);
  clone.remove();
  pawn.classList.add('wq');
  assert.equal(snapshot().ok, false);
});

test('hidden clone pieces do not corrupt a stable rendered placement', () => {
  const document = page();
  const element = board(document);
  const clone = element.querySelector('.piece').cloneNode(true);
  clone.style.display = 'none';
  element.append(clone);
  assert.equal(snapshot().ok, true);
});

test('missing square metadata and dragging pieces are rejected while changing', () => {
  const document = page();
  const element = board(document);
  const pawn = element.querySelector('.wp.square-52');
  pawn.classList.remove('square-52');
  assert.equal(snapshot().ok, false);
  pawn.classList.add('square-52', 'dragging');
  assert.equal(snapshot().ok, false);
});

test('an active finite piece movement delays the snapshot until it is finished', () => {
  const document = page();
  const element = board(document);
  const piece = element.querySelector('.piece');
  for (const property of ['transform', 'translate', 'left', 'top']) {
    element.getAnimations = () => [animation(piece, { property })];
    assert.equal(snapshot().ok, false, property);
    assert.equal(readChessComPlacement(element), null, property);
  }
  element.getAnimations = () => [animation(piece, { playState: 'finished' })];
  assert.equal(snapshot().ok, true);
});

test('cosmetic board and piece animations do not block a stable placement', () => {
  const document = page();
  const element = board(document);
  const piece = element.querySelector('.piece');
  element.getAnimations = () => [
    animation(element, { property: 'backgroundColor', duration: Number.POSITIVE_INFINITY }),
    animation(element, { property: 'transform' }),
    animation(piece, { property: 'opacity' }),
    animation(piece, { property: 'transform', duration: Number.POSITIVE_INFINITY }),
  ];
  assert.equal(snapshot().ok, true);
  assert.equal(readChessComPlacement(element), START_FEN.split(' ')[0]);
});

test('a complete API FEN without DOM pieces cannot pass the correlation guard', () => {
  const document = page();
  const element = board(document);
  element.replaceChildren();
  assert.equal(snapshot().ok, false);
  assert.match(snapshot().error, /cours de changement/);
  assert.equal(readChessComPlacement(element), null);
});

test('the exported DOM helper matches the self-contained MAIN-world placement guard', () => {
  const document = page();
  const element = board(document, 'wc-chess-board', EP_FEN);
  assert.equal(readChessComPlacement(element), snapshot().placement);
  element.querySelector('.wp.square-54').remove();
  assert.notEqual(readChessComPlacement(element), EP_FEN.split(' ')[0]);
  assert.equal(snapshot().ok, false);
  element.getAnimations = () => [animation(element.querySelector('.piece'))];
  assert.equal(readChessComPlacement(element), null);
});

test('reading leaves the DOM untouched and returns serializable data', () => {
  const document = page();
  board(document);
  const before = document.documentElement.outerHTML;
  const result = snapshot();
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal(JSON.parse(JSON.stringify(result)).fen, START_FEN);
});

test('no board and unexpected DOM getter errors return safe failures', () => {
  page('');
  assert.match(snapshot().error, /Aucun plateau/);
  dom.window.close();
  const document = page();
  const element = board(document);
  element.getBoundingClientRect = () => { throw new Error('unavailable'); };
  assert.equal(snapshot().ok, false);
  assert.match(snapshot().error, /temporairement indisponible/);
});
