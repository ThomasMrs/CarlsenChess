import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChessComReader, isChessComPage } from '../extension/content/chesscom-client.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EP = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function makeBoard(document, fen = START) {
  const board = document.createElement('wc-chess-board');
  board.id = 'board-analysis-board';
  for (const [index, row] of fen.split(' ')[0].split('/').entries()) {
    let file = 1;
    for (const code of row) {
      if (/\d/.test(code)) { file += Number(code); continue; }
      const element = document.createElement('div');
      element.className = `piece ${code === code.toUpperCase() ? 'w' : 'b'}${code.toLowerCase()} square-${file}${8-index}`;
      board.append(element);
      file += 1;
    }
  }
  document.body.append(board);
  return board;
}

function harness(fen = START) {
  const dom = new JSDOM('<!doctype html><body></body>', { url:'https://www.chess.com/analysis' });
  let board = makeBoard(dom.window.document, fen);
  let selector = '';
  let url = 'https://www.chess.com/analysis';
  let timestamp = 100;
  let notifications = 0;
  const calls = [];
  const pending = [];
  const reader = createChessComReader({
    getBoard: () => board, getSelector: () => selector, getUrl: () => url, now: () => timestamp,
    interval:100000, onChange: () => { notifications += 1; },
    send: (message) => { const request = deferred(); pending.push(request); calls.push(message); return request.promise; },
  });
  const response = () => ({ ok:true, fen, boardId:'board-analysis-board' });
  return { dom, reader, calls, pending, response, read:()=>reader.read({board,orientation:'white'}),
    get notifications(){return notifications;}, get board(){return board;},
    setBoard(next){board=next;}, setSelector(next){selector=next;}, setUrl(next){url=next;}, setTime(next){timestamp=next;},
    close(){reader.destroy();dom.window.close();} };
}

test('Chess.com recognition excludes HTTP and lookalike hosts',()=>{
  assert.equal(isChessComPage(new URL('https://www.chess.com/play/online')),true);
  assert.equal(isChessComPage(new URL('https://chess.com/analysis')),true);
  for(const url of ['http://www.chess.com','https://chess.com.evil.example','https://fakechess.com']) {
    assert.equal(isChessComPage(new URL(url)),false,url);
  }
});

test('fresh cache preserves complete FEN rights and expires rather than drawing stale moves',async()=>{
  const h=harness(EP);
  try{
    h.reader.setActive(true); await nextTurn();
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].type,'CC_READ_CHESSCOM');
    h.pending[0].resolve(h.response()); await nextTurn();
    assert.equal(h.read().fen,EP);
    assert.match(h.read().source,/Chess.com/);
    h.setTime(1700);
    assert.equal(h.read().fen,null);
  }finally{h.close();}
});

test('visible pieces changing invalidate a cached FEN immediately',async()=>{
  const h=harness();
  try{
    h.reader.setActive(true);await nextTurn();h.pending[0].resolve(h.response());await nextTurn();
    assert.equal(h.read().fen,START);
    h.board.querySelector('.wp.square-52').classList.replace('square-52','square-54');
    assert.equal(h.read().fen,null);
  }finally{h.close();}
});

test('pause ignores a response already in flight and sends no further read',async()=>{
  const h=harness();
  try{
    h.reader.setActive(true);await nextTurn();h.reader.setActive(false);
    h.pending[0].resolve(h.response());await nextTurn();
    assert.equal(h.notifications,0);assert.equal(h.read().fen,null);assert.equal(h.calls.length,1);
  }finally{h.close();}
});

test('a replaced board with identical FEN cannot receive an earlier board response',async()=>{
  const h=harness();
  try{
    h.reader.setActive(true);await nextTurn();
    h.board.remove();h.setBoard(makeBoard(h.dom.window.document));
    h.pending[0].resolve(h.response());await nextTurn();
    assert.equal(h.read().fen,null);assert.equal(h.notifications,0);
  }finally{h.close();}
});

test('navigation, selector changes and destroy reject late responses',async()=>{
  for(const change of [h=>h.setUrl('https://www.chess.com/play/online'),h=>{h.setSelector('#other');h.reader.refresh();},h=>h.reader.destroy()]){
    const h=harness();
    try{
      h.reader.setActive(true);await nextTurn();change(h);
      h.pending[0].resolve(h.response());await nextTurn();
      assert.equal(h.read().fen,null);assert.equal(h.notifications,0);
    }finally{h.close();}
  }
});

test('an API failure or wrong board identity cannot become a trusted FEN',async()=>{
  for(const response of [{ok:false,error:'Chargement en cours'},{ok:true,fen:START,boardId:'other-board'},{ok:true,fen:EP,boardId:'board-analysis-board'}]){
    const h=harness();
    try{
      h.reader.setActive(true);await nextTurn();h.pending[0].resolve(response);await nextTurn();
      assert.equal(h.read().fen,null);
    }finally{h.close();}
  }
});

test('readNow refreshes an expired snapshot before a delayed action can use it', async () => {
  const h = harness();
  try {
    h.reader.setActive(true); await nextTurn();
    h.pending[0].resolve(h.response()); await nextTurn();
    h.setTime(10000);
    assert.equal(h.read().fen, null);
    const fresh = h.reader.readNow();
    assert.equal(h.calls.length, 2);
    h.pending[1].resolve(h.response());
    await fresh;
    assert.equal(h.read().fen, START);
  } finally { h.close(); }
});

test('pausing while readNow awaits an existing read prevents another request', async () => {
  const h = harness();
  try {
    h.reader.setActive(true); await nextTurn();
    const fresh = h.reader.readNow();
    assert.equal(h.calls.length, 1);
    h.reader.setActive(false);
    h.pending[0].resolve(h.response());
    await fresh;
    assert.equal(h.calls.length, 1);
    assert.equal(h.read().fen, null);
  } finally { h.close(); }
});

test('concurrent readNow callers share a single fresh MAIN request', async () => {
  const h = harness();
  try {
    h.reader.setActive(true); await nextTurn();
    h.pending[0].resolve(h.response()); await nextTurn();
    const first = h.reader.readNow();
    const second = h.reader.readNow();
    assert.equal(first, second);
    assert.equal(h.calls.length, 2);
    h.pending[1].resolve(h.response());
    await Promise.all([first, second]);
    assert.equal(h.calls.length, 2);
    assert.equal(h.read().fen, START);
  } finally { h.close(); }
});
