import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { findBoard, readPosition, squareCenter } from '../extension/content/board-adapter.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SECOND_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
let dom;

function page(html, url) {
  dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url });
  globalThis.document = dom.window.document;
  return document;
}

function rectangle(element, width = 480, height = width, left = 16, top = 24) {
  element.getBoundingClientRect = () => ({ width, height, left, top, right: left + width, bottom: top + height, x: left, y: top });
  return element;
}

afterEach(() => { dom?.window.close(); delete globalThis.document; });

test('findBoard selects the largest visible square board', () => {
  const doc = page('<div class="board" id="small"></div><chess-board></chess-board><div class="board" id="wide"></div><div class="board" id="hidden" style="display:none"></div>');
  rectangle(doc.querySelector('#small'), 200);
  const large = rectangle(doc.querySelector('chess-board'), 500);
  rectangle(doc.querySelector('#wide'), 1100, 200);
  rectangle(doc.querySelector('#hidden'), 800);
  assert.equal(findBoard(), large);
});

test('Chess.com prefers its visible custom board over unrelated board class containers', () => {
  const doc = page('<div class="board" id="wrapper"></div><wc-chess-board id="board-analysis-board" orientation="black"></wc-chess-board>', 'https://www.chess.com/analysis');
  rectangle(doc.querySelector('#wrapper'), 800);
  const actual = rectangle(doc.querySelector('wc-chess-board'), 576);
  assert.equal(findBoard(), actual);
  assert.equal(readPosition().orientation, 'black');
});

test('a hidden Chess.com custom board does not hide a visible legacy board', () => {
  const doc = page('<wc-chess-board hidden></wc-chess-board><chess-board id="legacy"></chess-board>', 'https://www.chess.com/play/online');
  rectangle(doc.querySelector('wc-chess-board'), 800);
  const legacy = rectangle(doc.querySelector('chess-board'), 480);
  assert.equal(findBoard(), legacy);
});

test('an explicit selector is exclusive and safely handles invalid selectors', () => {
  const doc = page('<div class="board"></div><div id="custom"></div>');
  rectangle(doc.querySelector('.board'), 600);
  const custom = rectangle(doc.querySelector('#custom'), 400);
  assert.equal(findBoard({ boardSelector: '#custom' }), custom);
  assert.equal(findBoard({ boardSelector: '#missing' }), null);
  assert.equal(findBoard({ boardSelector: '[' }), null);
});

test('hidden ancestors exclude a board', () => {
  const doc = page('<div hidden><cg-board></cg-board></div>');
  rectangle(doc.querySelector('cg-board'));
  assert.equal(findBoard(), null);
});

test('transparent boards are excluded from detection', () => {
  const doc = page('<div style="opacity:0"><cg-board></cg-board></div>');
  rectangle(doc.querySelector('cg-board'));
  assert.equal(findBoard(), null);
});

test('readPosition returns explicit board FEN, preserving the six fields', () => {
  const doc = page(`<div id="board" data-carlsenchess-fen="${SECOND_FEN}"></div>`);
  const board = rectangle(doc.querySelector('#board'));
  assert.deepEqual(readPosition(), { board, fen: SECOND_FEN, orientation: 'white', source: 'data-carlsenchess-fen', error: null });
});

test('a nearest associated wrapper can expose FEN', () => {
  const doc = page(`<section data-fen="${START_FEN}"><div><cg-board></cg-board></div></section>`);
  rectangle(doc.querySelector('cg-board'));
  assert.equal(readPosition().fen, START_FEN);
});

test('nested marker elements for one board do not prevent wrapper FEN association', () => {
  const doc = page(`<section data-fen="${START_FEN}"><div class="chess-board"><cg-board></cg-board></div></section>`);
  rectangle(doc.querySelector('.chess-board'), 482);
  rectangle(doc.querySelector('cg-board'), 480);
  assert.equal(readPosition().fen, START_FEN);
});

test('shared container metadata is never borrowed across independent boards', () => {
  const doc = page(`<section data-fen="${START_FEN}"><div class="board" id="first"></div><div class="board" id="second"></div></section>`);
  rectangle(doc.querySelector('#first'), 480);
  rectangle(doc.querySelector('#second'), 240);
  assert.equal(readPosition().fen, null);
  assert.match(readPosition().error, /FEN complète/);
});

test('FEN on an unrelated page element is ignored', () => {
  const doc = page(`<aside data-fen="${SECOND_FEN}"></aside><div class="board"></div>`);
  rectangle(doc.querySelector('.board'));
  assert.equal(readPosition().fen, null);
});

test('FEN at body or html scope is ignored', () => {
  const doc = page('<div class="board"></div>');
  doc.body.setAttribute('data-fen', START_FEN);
  rectangle(doc.querySelector('.board'));
  assert.equal(readPosition().fen, null);
});

test('an explicit FEN selector reads input, text or FEN attributes', () => {
  const doc = page(`<div class="board"></div><input id="input" value="${SECOND_FEN}"><pre id="text">${START_FEN}</pre><output id="attribute" data-chess-fen="${SECOND_FEN}"></output>`);
  rectangle(doc.querySelector('.board'));
  assert.equal(readPosition({ fenSelector: '#input' }).fen, SECOND_FEN);
  assert.equal(readPosition({ fenSelector: '#text' }).fen, START_FEN);
  assert.equal(readPosition({ fenSelector: '#attribute' }).fen, SECOND_FEN);
  assert.equal(readPosition({ fenSelector: '[' }).fen, null);
});

test('manual FEN is a fallback and never replaces a live explicit board FEN', () => {
  const doc = page(`<div class="board" data-fen="${SECOND_FEN}"></div>`);
  const board = rectangle(doc.querySelector('.board'));
  assert.equal(readPosition({ manualFen: START_FEN }).fen, SECOND_FEN);
  board.removeAttribute('data-fen');
  assert.equal(readPosition({ manualFen: START_FEN }).source, 'manual');
  assert.equal(readPosition({ manualFen: START_FEN }).fen, START_FEN);
});

test('an incomplete or structurally malformed FEN is rejected without inferring any field', () => {
  const doc = page('<div class="board"></div>');
  const board = rectangle(doc.querySelector('.board'));
  for (const fen of [START_FEN.split(' ')[0], '8/8/8/8/8/8/8/9 w - - 0 1', '8/8/8/8/8/8/8/8 x - - 0 1', '8/8/8/8/8/8/8/8 w qK - 0 1', '8/8/8/8/8/8/8/8 w - e4 0 1', '8/8/8/8/8/8/8/8 w - - -1 1', '8/8/8/8/8/8/8/8 w - - 0 0']) {
    board.setAttribute('data-fen', fen);
    assert.equal(readPosition().fen, null, fen);
  }
});

test('an invalid primary attribute can fall through to another complete explicit attribute', () => {
  const doc = page(`<div class="board" data-carlsenchess-fen="invalid" data-chess-fen="${START_FEN}"></div>`);
  rectangle(doc.querySelector('.board'));
  assert.equal(readPosition().source, 'data-chess-fen');
});

test('orientation comes from the nearest board metadata or known ancestor class', () => {
  const doc = page(`<section class="flipped"><div class="board" data-orientation="white" data-fen="${START_FEN}"></div></section>`);
  const board = rectangle(doc.querySelector('.board'));
  assert.equal(readPosition().orientation, 'white');
  board.removeAttribute('data-orientation');
  assert.equal(readPosition().orientation, 'black');
  board.setAttribute('data-carlsenchess-orientation', 'black');
  assert.equal(readPosition().orientation, 'black');
});

test('missing board and position returns an actionable error', () => {
  page('');
  assert.equal(readPosition().board, null);
  assert.match(readPosition().error, /Aucun plateau/);
});

test('squareCenter maps viewport coordinates for both orientations', () => {
  const rect = { left: 100, top: 200, width: 400, height: 400 };
  assert.deepEqual(squareCenter('a8', rect), { x: 125, y: 225 });
  assert.deepEqual(squareCenter('h1', rect), { x: 475, y: 575 });
  assert.deepEqual(squareCenter('a8', rect, 'black'), { x: 475, y: 575 });
  assert.deepEqual(squareCenter('e4', rect), { x: 325, y: 425 });
  assert.deepEqual(squareCenter('e4', rect, 'black'), { x: 275, y: 375 });
});

test('squareCenter rejects invalid inputs', () => {
  const rect = { left: 0, top: 0, width: 400, height: 400 };
  for (const square of ['i1', 'A1', 'e9', '', null]) assert.equal(squareCenter(square, rect), null);
  assert.equal(squareCenter('a1', null), null);
  assert.equal(squareCenter('a1', { ...rect, width: 0 }), null);
  assert.equal(squareCenter('a1', { ...rect, left: Number.NaN }), null);
  assert.equal(squareCenter('a1', rect, 'sideways'), null);
});
