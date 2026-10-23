import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EngineClient } from '../extension/core/engine-client.js';
import { Chess } from '../extension/vendor/chess.js';

class NodeUciWorker {
  constructor() {
    // npm's package is CommonJS; the copied extension runs as a browser Worker.
    this.process = spawn(process.execPath,[fileURLToPath(new URL('../node_modules/stockfish/bin/stockfish-19-single.js',import.meta.url))]);
    let buffer='';
    this.process.stdout.on('data',data=>{
      buffer+=data.toString();
      const lines=buffer.split('\n'); buffer=lines.pop();
      for(const line of lines) this.onmessage?.({data:line});
    });
    this.process.on('error', error=>this.onerror?.(error));
  }
  postMessage(command) { this.process.stdin.write(`${command}\n`); }
  terminate() { this.process.kill(); }
}

test('actual full Stockfish finds mate, supports target strength, cancels cleanly', {timeout:60000}, async () => {
  const client = new EngineClient(()=>new NodeUciWorker(),()=>0);
  try {
    await client.ready;
    assert.match(client.name,/Stockfish/);
    const fen='6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1';
    const result=await client.analyze(fen,{elo:'max',movetime:400});
    const board=new Chess(fen);
    board.move({from:result.bestMove.slice(0,2),to:result.bestMove.slice(2,4)});
    assert.equal(board.isCheckmate(),true);
    assert.equal(result.selectedMove,result.bestMove);
    assert.equal(result.strengthMode,'max');
    assert.equal(result.targetElo,'max');
    const limited=await client.analyze(new Chess().fen(),{elo:1600,movetime:200,humanize:true});
    assert.equal(limited.eloLimited,true);
    assert.equal(limited.strengthMode,'native');
    assert.equal(limited.targetElo,1500);
    assert.doesNotThrow(()=>new Chess().move({from:limited.selectedMove.slice(0,2),to:limited.selectedMove.slice(2,4)}));
    for (const elo of [500,1000]) {
      const beginner=await client.analyze(new Chess().fen(),{elo,movetime:200,humanize:false});
      assert.equal(beginner.strengthMode,'approximate');
      assert.equal(beginner.targetElo,elo);
      assert.equal(beginner.eloLimited,true);
      assert.notEqual(beginner.selectedMove,beginner.bestMove);
      assert.doesNotThrow(()=>new Chess().move({from:beginner.selectedMove.slice(0,2),to:beginner.selectedMove.slice(2,4)}));
    }
    const cancelled=client.analyze(new Chess().fen(),{movetime:2500});
    await new Promise(resolve=>setTimeout(resolve,100));
    client.stop();
    assert.equal((await cancelled).cancelled,true);
    const next=await client.analyze(fen,{movetime:200});
    assert.ok(next.bestMove);
    const restored=new Chess(fen);
    restored.move({from:next.selectedMove.slice(0,2),to:next.selectedMove.slice(2,4)});
    assert.equal(restored.isCheckmate(),true);
    assert.equal(client.current,null);
  } finally {client.dispose();}
});

class FakeUciWorker {
  commands=[];
  lines=[
    'info depth 3 multipv 1 score cp 30 pv e2e4 e7e5',
    'info depth 3 multipv 2 score cp -30 pv d2d4 d7d5',
  ];
  postMessage(command) {
    this.commands.push(command);
    queueMicrotask(()=>{
      const emit=line=>this.onmessage?.({data:line});
      if (command === 'uci') {
        emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
        emit('uciok');
      } else if (command === 'isready') emit('readyok');
      else if (command.startsWith('go ')) {
        for (const line of this.lines) emit(line);
        emit('bestmove e2e4');
      }
    });
  }
  terminate() {}
}

test('engine applies separate beginner, native and maximum settings and restores full skill', async () => {
  const worker=new FakeUciWorker();
  const client=new EngineClient(()=>worker,()=>.99);
  try {
    await client.ready;
    for (const [elo,mode,skill,go] of [[500,'approximate',0,'go movetime 200 depth 3'],
      [1000,'approximate',4,'go movetime 350 depth 6'],[1500,'native',20,'go movetime 1200'],
      [3000,'native',20,'go movetime 1200'],['max','max',20,'go movetime 1200']]) {
      const offset=worker.commands.length;
      const result=await client.analyze(new Chess().fen(),{elo,movetime:1200,humanize:false});
      const commands=worker.commands.slice(offset);
      assert.equal(result.strengthMode,mode);
      assert.equal(result.targetElo,elo);
      assert.ok(commands.includes(`setoption name Skill Level value ${skill}`));
      assert.ok(commands.includes(`setoption name UCI_LimitStrength value ${mode === 'native'}`));
      assert.ok(commands.includes(go));
      if (mode === 'native') assert.ok(commands.includes(`setoption name UCI_Elo value ${elo}`));
      else assert.equal(commands.some(command=>command.startsWith('setoption name UCI_Elo')),false);
      assert.equal(result.selectedMove,mode === 'approximate' ? 'd2d4' : 'e2e4');
    }
  } finally {client.dispose();}
});

test('timing lines retain the latest complete common depth while ordinary lines keep the partial final iteration', async () => {
  const worker=new FakeUciWorker();
  worker.lines=[
    'info depth 8 multipv 1 score cp 40 pv e2e4 e7e5',
    'info depth 8 multipv 2 score cp 25 pv d2d4 d7d5',
    'info depth 9 multipv 1 score cp 45 pv e2e4 e7e5',
    'info depth 9 multipv 2 score cp 20 pv d2d4 d7d5',
    'info depth 9 multipv 3 score cp 10 pv g1f3 g8f6',
    'info depth 10 multipv 1 score cp 70 pv e2e4 e7e5',
  ];
  const client=new EngineClient(()=>worker,()=>0);
  try {
    const result=await client.analyze(new Chess().fen(),{elo:'max',humanize:false});
    assert.deepEqual(result.lines.map(line=>[line.multipv,line.depth,line.score.value]),[[1,10,70],[2,9,20],[3,9,10]]);
    assert.deepEqual(result.timingLines.map(line=>[line.multipv,line.depth,line.score.value]),[[1,9,45],[2,9,20],[3,9,10]]);
    assert.equal(result.bestMove,'e2e4');
    assert.equal(result.selectedMove,'e2e4');
    for (const line of result.timingLines) assert.doesNotThrow(()=>new Chess().move({from:line.move.slice(0,2),to:line.move.slice(2,4)}));
    worker.lines=[
      'info depth 3 multipv 1 score cp 40 pv e2e4 e7e5',
      'info depth 4 multipv 2 score cp 20 pv d2d4 d7d5',
    ];
    const next=await client.analyze(new Chess().fen(),{elo:'max',humanize:false});
    assert.deepEqual(next.timingLines,[]);
    assert.deepEqual(next.lines.map(line=>line.depth),[3,4]);
  } finally {client.dispose();}
});

test('an illegal root move cannot complete a timing pair or enter its optional extra lines', async () => {
  const worker=new FakeUciWorker();
  worker.lines=[
    'info depth 7 multipv 1 score cp 40 pv e2e4 e7e5',
    'info depth 7 multipv 2 score cp 25 pv d2d4 d7d5',
    'info depth 7 multipv 3 score cp 10 pv e2e5',
    'info depth 8 multipv 1 score cp 50 pv e2e4 e7e5',
    'info depth 8 multipv 2 score cp 30 pv d2d5',
  ];
  const client=new EngineClient(()=>worker);
  try {
    const result=await client.analyze(new Chess().fen(),{elo:'max'});
    assert.deepEqual(result.timingLines.map(line=>[line.multipv,line.depth]),[[1,7],[2,7]]);
    assert.deepEqual(result.lines.map(line=>[line.multipv,line.depth]),[[1,8]]);
  } finally {client.dispose();}
});
