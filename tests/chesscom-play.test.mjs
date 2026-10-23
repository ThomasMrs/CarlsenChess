import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { Chess } from 'chess.js';
import { playChessComMove } from '../extension/content/chesscom-play.js';

const START = new Chess().fen();
let dom;

function fixture({ fen = START, orientation = 'white', url = 'https://www.chess.com/analysis',
  ignore = false, promotionChooser = true, autoQueen = false, wrongMove = false,
  opponentReplyDelay = null, immediateOpponentReply = false, movementAnimation = 0 } = {}) {
  dom = new JSDOM('<!doctype html><html><body><div id="carlsenchess-root" data-cc-play-token="test-token"></div><wc-chess-board id="board"></wc-chess-board></body></html>', {
    url, runScripts: 'outside-only',
  });
  const document = dom.window.document;
  dom.window.PointerEvent = dom.window.MouseEvent;
  const board = document.querySelector('#board');
  const host = document.querySelector('#carlsenchess-root');
  const game = new Chess(fen);
  const events = [];
  const clicks = [];
  let selected = null;
  let pending = null;
  let covered = false;
  let motionUntil = 0;
  let ownMoveFen = null;
  let rect = { left: 40, top: 50, width: 480, height: 480 };
  const rectangle = (r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });
  board.getBoundingClientRect = () => rectangle(rect);
  board.classList.toggle('flipped', orientation === 'black');
  board.game = { getFEN: () => game.fen() };
  board.getAnimations = () => Date.now() < motionUntil ? [{ playState: 'running', effect: {
    target: board.querySelector('.piece'), getComputedTiming: () => ({ activeDuration: movementAnimation }),
    getKeyframes: () => [{ transform: 'translate(0)' }],
  } }] : [];
  const flipped = () => board.classList.contains('flipped');
  const squareRect = (square) => {
    const file = square.charCodeAt(0) - 96; const rank = Number(square[1]);
    return rectangle({ left: rect.left + (flipped() ? 8 - file : file - 1) * rect.width / 8,
      top: rect.top + (flipped() ? rank - 1 : 8 - rank) * rect.height / 8,
      width: rect.width / 8, height: rect.height / 8 });
  };
  const squareAt = (x, y) => {
    const column = Math.floor((x - rect.left) / (rect.width / 8));
    const row = Math.floor((y - rect.top) / (rect.height / 8));
    if (column < 0 || column > 7 || row < 0 || row > 7) return null;
    return `${String.fromCharCode(97 + (flipped() ? 7 - column : column))}${flipped() ? row + 1 : 8 - row}`;
  };
  function render() {
    board.replaceChildren();
    for (const square of game.board().flat().filter(Boolean)) {
      const element = document.createElement('div');
      element.className = `piece ${square.color}${square.type} square-${square.square.charCodeAt(0) - 96}${square.square[1]}`;
      element.getBoundingClientRect = () => squareRect(square.square);
      board.append(element);
    }
  }
  function choosePromotion() {
    const chooser = document.createElement('div');
    chooser.className = 'promotion-window promotion-window--visible';
    for (const [index, type] of ['b', 'n', 'q', 'r'].entries()) {
      const choice = document.createElement('div');
      choice.className = `promotion-piece ${game.turn()}${type}`;
      choice.dataset.promotion = type;
      choice.getBoundingClientRect = () => rectangle({ left: rect.left + 1,
        top: rect.top + index * 60, width: 58, height: 58 });
      chooser.append(choice);
    }
    board.append(chooser);
  }
  document.elementFromPoint = (x, y) => {
    if (covered) return document.body;
    for (const choice of board.querySelectorAll('.promotion-piece')) {
      const r = choice.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return choice;
    }
    const square = squareAt(x, y);
    if (!square) return document.body;
    return board.querySelector(`.piece.square-${square.charCodeAt(0) - 96}${square[1]}`) || board;
  };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    board.addEventListener(type, (event) => events.push({ type, x: event.clientX, y: event.clientY }));
  }
  board.addEventListener('click', (event) => {
    clicks.push({ x: event.clientX, y: event.clientY });
    if (ignore) return;
    if (pending && event.target.dataset.promotion) {
      game.move({ ...pending, promotion: event.target.dataset.promotion });
      pending = null; selected = null; render(); return;
    }
    const square = squareAt(event.clientX, event.clientY);
    if (!selected) { selected = square; return; }
    const choices = game.moves({ square: selected, verbose: true }).filter((move) => move.to === square);
    if (choices.some((move) => move.promotion)) {
      pending = { from: selected, to: square };
      if (autoQueen) { game.move({ ...pending, promotion: 'q' }); render(); }
      else if (promotionChooser) choosePromotion();
      return;
    }
    if (!choices.length) return;
    game.move(wrongMove ? { from: 'd2', to: 'd4' } : { from: selected, to: square });
    selected = null; render();
    ownMoveFen = game.fen();
    motionUntil = Date.now() + movementAnimation;
    const reply = () => { game.move('e5'); render(); motionUntil = Date.now() + movementAnimation; };
    if (immediateOpponentReply) reply();
    else if (opponentReplyDelay !== null) dom.window.setTimeout(reply, opponentReplyDelay);
  });
  render();
  const request = { boardSelector: '#board', expectedFen: fen, uci: 'e2e4', color: game.turn(), orientation, token: 'test-token' };
  function play(overrides = {}) {
    dom.window.__request = { ...request, ...overrides };
    return dom.window.eval(`(${playChessComMove.toString()})(__request)`)
      .then((value) => JSON.parse(JSON.stringify(value)));
  }
  return { document, board, host, game, events, clicks, request, play,
    getOwnMoveFen: () => ownMoveFen,
    setRect(value) { rect = { ...rect, ...value }; }, cover() { covered = true; } };
}

afterEach(() => { dom?.window.close(); });

test('serialized MAIN-world action plays exactly one click-selected move and verifies its FEN', async () => {
  const f = fixture();
  const result = await f.play();
  assert.deepEqual(result, { ok: true, played: true, fen: f.game.fen(), error: null });
  assert.equal(f.game.get('e4')?.type, 'p');
  assert.equal(f.clicks.length, 2);
  assert.deepEqual(f.events.map(({ type }) => type), [
    'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
    'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
  ]);
  assert.deepEqual(f.clicks, [{ x: 310, y: 440 }, { x: 310, y: 320 }]);
});

test('black orientation uses the actual source piece center and correctly reversed target coordinates', async () => {
  const chess = new Chess(); chess.move('e4');
  const f = fixture({ fen: chess.fen(), orientation: 'black' });
  assert.equal((await f.play({ uci: 'e7e5' })).played, true);
  assert.equal(f.game.get('e5')?.color, 'b');
  assert.deepEqual(f.clicks, [{ x: 250, y: 440 }, { x: 250, y: 320 }]);
});

test('HTTPS chess.com and actual subdomains pass; lookalikes and HTTP cannot emit input', async () => {
  for (const url of ['https://chess.com/analysis', 'https://play.chess.com/analysis']) {
    const f = fixture({ url });
    assert.equal((await f.play()).played, true, url);
    dom.window.close();
  }
  for (const url of ['http://www.chess.com/analysis', 'https://fakechess.com/analysis', 'https://chess.com.example.com/analysis']) {
    const f = fixture({ url });
    assert.match((await f.play()).error, /HTTPS.*chess.com/);
    assert.equal(f.events.length, 0);
    dom.window.close();
  }
});

test('full initial FEN, chosen turn, UCI, and authorization are required before any input', async () => {
  const f = fixture();
  for (const change of [{ expectedFen: START.replace('0 1', '0 2') }, { color: 'b' },
    { expectedFen: START.split(' ')[0] }, { uci: 'e2e2' }, { uci: 'e2e9' }, { token: '' }, { token: 'wrong-token' }]) {
    assert.equal((await f.play(change)).played, false);
    assert.equal(f.events.length, 0);
  }
});

test('own source piece and rendered position must agree with the full FEN', async () => {
  const f = fixture();
  assert.match((await f.play({ uci: 'e7e5' })).error, /couleur choisie/);
  f.board.querySelector('.wp.square-52').remove();
  assert.match((await f.play()).error, /mouvement/);
  assert.equal(f.events.length, 0);
});

test('source geometry, viewport clipping, and overlaid boards cannot emit input', async () => {
  const f = fixture();
  f.setRect({ left: -10 });
  assert.match((await f.play()).error, /plateau entier/);
  f.setRect({ left: 40 }); f.cover();
  assert.match((await f.play()).error, /masqué ou coupé/);
  assert.equal(f.events.length, 0);
});

test('incorrect orientation and a source piece still animating are blocked', async () => {
  const f = fixture();
  assert.match((await f.play({ orientation: 'black' })).error, /orientation/);
  f.board.getAnimations = () => [{ playState: 'running', effect: {
    target: f.board.querySelector('.piece'), getComputedTiming: () => ({ activeDuration: 180 }),
    getKeyframes: () => [{ transform: 'translate(0)' }],
  } }];
  assert.match((await f.play()).error, /mouvement/);
  assert.equal(f.events.length, 0);
});

test('cancellation triggered by source selection prevents the destination click', async () => {
  const f = fixture();
  f.board.addEventListener('click', () => f.host.removeAttribute('data-cc-play-token'), { once: true });
  const result = await f.play();
  assert.equal(result.played, false);
  assert.equal(f.game.fen(), START);
  assert.equal(f.clicks.length, 1);
});

test('revoking authorization on pointerdown prevents later synthetic input events', async () => {
  const f = fixture();
  f.board.addEventListener('pointerdown', () => f.host.removeAttribute('data-cc-play-token'), { once: true });
  assert.equal((await f.play()).played, false);
  assert.deepEqual(f.events.map(({ type }) => type), ['pointerdown']);
  assert.equal(f.game.fen(), START);
});

test('a hidden document with an otherwise valid authorization token cannot emit input', async () => {
  const f = fixture();
  Object.defineProperty(f.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  const result = await f.play();
  assert.match(result.error, /onglet.*masqué/);
  assert.equal(result.played, false);
  assert.equal(f.host.getAttribute('data-cc-play-token'), 'test-token');
  assert.equal(f.events.length, 0);
  assert.equal(f.game.fen(), START);
});

test('hiding the document after any source event prevents every later event and destination input', async () => {
  const sequence = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (const [index, type] of sequence.entries()) {
    const f = fixture();
    let hidden = false;
    Object.defineProperty(f.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    f.board.addEventListener(type, () => { hidden = true; }, { once: true });
    assert.equal((await f.play()).played, false, type);
    assert.deepEqual(f.events.map((event) => event.type), sequence.slice(0, index + 1), type);
    assert.equal(f.host.getAttribute('data-cc-play-token'), 'test-token');
    assert.equal(f.game.fen(), START);
    dom.window.close();
  }
});

test('hiding the document when the promotion chooser opens prevents the promotion click', async () => {
  const f = fixture({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' });
  let hidden = false;
  Object.defineProperty(f.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  f.board.addEventListener('click', () => { if (f.clicks.length === 2) hidden = true; });
  assert.equal((await f.play({ uci: 'a7a8n' })).played, false);
  assert.equal(f.clicks.length, 2);
  assert.equal(f.game.fen(), f.request.expectedFen);
});

test('a flip or resize triggered by source selection prevents a stale-coordinate destination click', async () => {
  for (const change of [(f) => f.board.classList.add('flipped'), (f) => f.setRect({ left: 60 })]) {
    const f = fixture();
    f.board.addEventListener('click', () => change(f), { once: true });
    assert.equal((await f.play()).played, false);
    assert.equal(f.clicks.length, 1);
    assert.equal(f.game.fen(), START);
    dom.window.close();
  }
});

test('duplicate and overlapping requests never send a second move or retry refused input', async () => {
  const f = fixture({ ignore: true });
  const first = f.play();
  const second = await f.play();
  assert.match(second.error, /déjà été tenté/);
  const result = await first;
  assert.match(result.error, /clics synthétiques peuvent être refusés/);
  assert.equal(f.clicks.length, 2);
  assert.match((await f.play()).error, /déjà été tenté/);
  assert.equal(f.clicks.length, 2);
});

test('exact queen, rook, bishop, and knight promotion choices use the observed board-local chooser', async () => {
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const f = fixture({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' });
    const result = await f.play({ uci: `a7a8${promotion}` });
    assert.equal(result.played, true, `${promotion}: ${result.error}`);
    assert.equal(f.game.get('a8')?.type, promotion);
    assert.equal(f.clicks.length, 3);
    dom.window.close();
  }
});

test('black underpromotion retains the exact requested color and type', async () => {
  const f = fixture({ fen: '7k/8/8/8/8/8/p7/7K b - - 0 1', orientation: 'black' });
  const result = await f.play({ uci: 'a2a1n' });
  assert.equal(result.played, true, result.error);
  assert.deepEqual(f.game.get('a1'), { type: 'n', color: 'b' });
});

test('missing and inappropriate promotion suffixes fail before selecting any piece', async () => {
  const f = fixture({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' });
  assert.match((await f.play({ uci: 'a7a8' })).error, /promotion.*invalide/);
  assert.equal(f.events.length, 0);
});

test('auto-queen cannot silently substitute a requested underpromotion', async () => {
  const f = fixture({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1', autoQueen: true });
  const result = await f.play({ uci: 'a7a8n' });
  assert.equal(result.played, false);
  assert.match(result.error, /ne correspond pas/);
  assert.equal(f.clicks.length, 2);
});

test('an absent promotion chooser fails clearly instead of choosing another type', async () => {
  const f = fixture({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1', promotionChooser: false });
  const result = await f.play({ uci: 'a7a8r' });
  assert.equal(result.played, false);
  assert.match(result.error, /promotion.*pas été confirmée/);
  assert.equal(f.game.fen(), f.request.expectedFen);
  assert.equal(f.clicks.length, 2);
});

test('castling and en passant are verified against all affected piece squares', async () => {
  for (const [fen, uci] of [['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'],
    ['7k/8/8/3pP3/8/8/8/7K w - d6 0 1', 'e5d6']]) {
    const f = fixture({ fen });
    const result = await f.play({ uci });
    assert.equal(result.played, true, result.error);
    assert.equal(f.clicks.length, 2);
    dom.window.close();
  }
});

test('unexpected state changes and unavailable game FEN never claim a confirmed move', async () => {
  const f = fixture({ wrongMove: true });
  assert.match((await f.play()).error, /ne correspond pas/);
  assert.equal(f.clicks.length, 2);
  f.board.game.getFEN = () => { throw new Error('not ready'); };
  assert.equal((await f.play({ expectedFen: f.game.fen(), uci: 'd7d5', color: 'b' })).played, false);
  assert.equal(f.clicks.length, 2);
});

test('an observed API confirmation survives an opponent premove during piece animation', async () => {
  const f = fixture({ opponentReplyDelay: 10, movementAnimation: 180 });
  const result = await f.play();
  assert.equal(result.played, true, result.error);
  assert.equal(result.fen, f.getOwnMoveFen());
  assert.notEqual(result.fen, f.game.fen());
  assert.equal(f.game.get('e5')?.color, 'b');
  assert.equal(f.clicks.length, 2);
});

test('an unexpected position cannot pass when the requested API result was never observed', async () => {
  const f = fixture({ immediateOpponentReply: true, movementAnimation: 180 });
  const result = await f.play();
  assert.equal(result.played, false);
  assert.match(result.error, /ne correspond pas/);
  assert.notEqual(result.fen, f.getOwnMoveFen());
  assert.equal(result.fen, f.game.fen());
  assert.equal(f.clicks.length, 2);
});
