import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPlayer } from '../extension/content/autoplay.js';
const FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const wait=()=>new Promise(resolve=>setTimeout(resolve,15));

function harness() {
  const board={isConnected:true};
  const state={enabled:true,visible:true,manual:false,board,fen:FEN,playerColor:'w',orientation:'white'};
  const calls=[],tokens=[],errors=[];
  let pendingResolve;
  const player=createAutoPlayer({getState:()=>state,authorize:t=>tokens.push(t),onError:e=>errors.push(e),
    play:request=>{calls.push(request);return new Promise(resolve=>{pendingResolve=resolve;});},
    delay:1,makeToken:()=> 'test-token' });
  return{player,state,calls,tokens,errors,resolve:r=>pendingResolve(r),schedule:()=>player.schedule({fen:FEN,uci:'e2e4',board})};
}

test('one opted-in action is bound to FEN, board, color and live authorization',async()=>{
  const h=harness();try{
    assert.equal(h.schedule(),true);await wait();
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].playerColor,'w');
    assert.equal(h.calls[0].fen,FEN);assert.equal(h.calls[0].token,'test-token');
    assert.equal(h.schedule(),false);
    h.resolve({ok:true,played:true});await wait();
    assert.equal(h.tokens.at(-1),null);assert.equal(h.schedule(),false);
  }finally{h.player.destroy();}
});

test('disabled, hidden, manual and opponent states never queue an input',()=>{
  for(const patch of [{enabled:false},{visible:false},{manual:true},{playerColor:'b'}]){
    const h=harness();try{Object.assign(h.state,patch);assert.equal(h.schedule(),false);assert.equal(h.calls.length,0);}
    finally{h.player.destroy();}
  }
});

test('pause, color change, board replacement and FEN update cancel pending inputs',async()=>{
  for(const change of [h=>{h.state.enabled=false;},h=>{h.state.playerColor='b';},h=>{h.state.board={isConnected:true};},h=>{h.state.fen=FEN.replace(' w ',' b ');}]){
    const h=harness();try{h.schedule();change(h);await wait();assert.equal(h.calls.length,0);assert.equal(h.tokens.at(-1),null);}
    finally{h.player.destroy();}
  }
});

test('immediate cancel removes live authorization and ignores late failures',async()=>{
  const h=harness();try{
    h.schedule();await wait();assert.equal(h.tokens.at(-1),'test-token');
    h.player.cancel();assert.equal(h.tokens.at(-1),null);
    h.resolve({ok:false,error:'late'});await wait();assert.equal(h.errors.length,0);
  }finally{h.player.destroy();}
});

test('failed site input reports the error once without an automatic retry',async()=>{
  const h=harness();try{
    h.schedule();await wait();h.resolve({ok:false,played:false,error:'Refus du site'});await wait();
    assert.deepEqual(h.errors,['Refus du site']);assert.equal(h.schedule(),false);assert.equal(h.calls.length,1);
  }finally{h.player.destroy();}
});

test('promotion transients keep an issued immutable move authorized; pause still revokes it',async()=>{
  const h=harness();try{
    h.schedule();await wait();assert.equal(h.player.isExecuting(),true);
    h.player.observe(null,h.state.board);assert.equal(h.tokens.at(-1),'test-token');
    h.player.cancel();assert.equal(h.tokens.at(-1),null);assert.equal(h.player.isExecuting(),false);
    h.resolve({ok:false,error:'Cancelled'});await wait();assert.deepEqual(h.errors,[]);
  }finally{h.player.destroy();}
});

test('observing another full position allows the next own-turn action',async()=>{
  const h=harness();try{
    h.schedule();await wait();h.resolve({ok:true,played:true});await wait();
    h.player.observe(FEN.replace(' w ',' b '),h.state.board);
    assert.equal(h.schedule(),true);h.player.cancel();
  }finally{h.player.destroy();}
});
