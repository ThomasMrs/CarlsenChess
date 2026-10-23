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
  const client = new EngineClient(()=>new NodeUciWorker());
  try {
    await client.ready;
    assert.match(client.name,/Stockfish/);
    const fen='6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1';
    const result=await client.analyze(fen,{elo:'max',movetime:400});
    const board=new Chess(fen);
    board.move({from:result.bestMove.slice(0,2),to:result.bestMove.slice(2,4)});
    assert.equal(board.isCheckmate(),true);
    const limited=await client.analyze(new Chess().fen(),{elo:1600,movetime:200,humanize:true});
    assert.equal(limited.eloLimited,true);
    assert.doesNotThrow(()=>new Chess().move({from:limited.selectedMove.slice(0,2),to:limited.selectedMove.slice(2,4)}));
    const cancelled=client.analyze(new Chess().fen(),{movetime:2500});
    await new Promise(resolve=>setTimeout(resolve,100));
    client.stop();
    assert.equal((await cancelled).cancelled,true);
    const next=await client.analyze(fen,{movetime:200});
    assert.ok(next.bestMove);
    assert.equal(client.current,null);
  } finally {client.dispose();}
});
