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

test('disabled, manual and opponent states never queue an input',()=>{
  for(const patch of [{enabled:false},{manual:true},{playerColor:'b'}]){
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

function timedHarness() {
  const board = { isConnected: true };
  const state = { enabled: true, visible: true, manual: false, board, fen: FEN, playerColor: 'w' };
  const calls = [], tokens = [];
  let scheduled;
  let latest;
  const player = createAutoPlayer({ getState: () => state, authorize: t => tokens.push(t),
    play: async request => { calls.push(request); return { ok: true, played: true }; },
    makeToken: () => 'timed-token',
    setTimer: (callback, ms) => { latest = { callback, ms }; scheduled = latest; return latest; },
    clearTimer: handle => { if (scheduled === handle) scheduled = null; },
  });
  return { player, state, calls, tokens, get latest() { return latest; },
    get scheduled() { return scheduled; },
    schedule: delayMs => player.schedule({ fen: FEN, uci: 'e2e4', board, delayMs }) };
}

test('a difficulty delay waits without authorizing input, then plays only the scheduled position', async () => {
  const h = timedHarness();
  try {
    assert.equal(h.schedule(6200), true);
    assert.equal(h.scheduled.ms, 6200);
    assert.deepEqual(h.calls, []);
    assert.equal(h.tokens.at(-1), null);
    assert.equal(h.schedule(400), false, 'a second proposal cannot shorten an already queued move');
    await h.scheduled.callback();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].fen, FEN);
    assert.equal(h.tokens.at(-1), null);
  } finally { h.player.destroy(); }
});

test('pause removes a long reaction timer and a late timer callback cannot send input', async () => {
  const h = timedHarness();
  try {
    h.schedule(10000);
    const lateCallback = h.scheduled.callback;
    h.player.cancel();
    assert.equal(h.scheduled, null);
    await lateCallback();
    assert.deepEqual(h.calls, []);
    assert.equal(h.tokens.at(-1), null);
  } finally { h.player.destroy(); }
});

test('reaction timers use the fixed fallback and reject unbounded timer values', () => {
  for (const [requested, expected] of [[undefined, 400], [NaN, 400], [Infinity, 400], [20000, 10000], [1550.6, 1551]]) {
    const h = timedHarness();
    try { h.schedule(requested); assert.equal(h.scheduled.ms, expected); }
    finally { h.player.destroy(); }
  }
});

function deferred() {
  let resolve, reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}

function freshHarness() {
  let time=0, serial=0, tokenSerial=0;
  const timers=new Map();
  const board={isConnected:true};
  const state={enabled:true,visible:true,manual:false,board,fen:FEN,playerColor:'w',orientation:'white'};
  const h={state,calls:[],tokens:[],errors:[],retries:[],stales:0,refreshes:0,
    refresh:async()=>{},play:async()=>({ok:true,played:true})};
  const player=createAutoPlayer({
    getState:()=>state,authorize:token=>h.tokens.push(token),
    refresh:()=>{h.refreshes+=1;return h.refresh();},
    play:request=>{h.calls.push(request);return h.play(request);},
    onError:(error,response,ticket)=>h.errors.push({error,response,ticket}),
    onStale:()=>{h.stales+=1;},onRetry:error=>h.retries.push(error),
    makeToken:()=>`fresh-token-${++tokenSerial}`,
    setTimer:(callback,ms)=>{const id=++serial;timers.set(id,{id,callback,ms,due:time+ms});return id;},
    clearTimer:id=>timers.delete(id),
  });
  const first=()=>[...timers.values()].sort((a,b)=>a.due-b.due || a.id-b.id)[0];
  h.player=player;
  h.clock={get next(){return first();},get size(){return timers.size;},
    fire(){const job=first();assert.ok(job,'a timer is queued');time=job.due;timers.delete(job.id);return job.callback();}};
  h.schedule=delayMs=>player.schedule({fen:FEN,uci:'e2e4',board,delayMs});
  return h;
}

test('an explicitly enabled hidden tab refreshes and plays without a visibility gate',async()=>{
  const h=freshHarness();try{
    h.state.visible=false;
    assert.equal(h.schedule(500),true);
    await h.clock.fire();
    assert.equal(h.refreshes,1);
    assert.equal(h.calls.length,1);
    assert.deepEqual(h.errors,[]);
  }finally{h.player.destroy();}
});

test('cache expiry during a queued reaction preserves its deadline and fresh preflight restores the same FEN',async()=>{
  const h=freshHarness();try{
    h.schedule(6200);
    const deadline=h.clock.next;
    h.state.fen=null;
    h.player.observe(null,h.state.board);
    assert.equal(h.player.isPending(),true);
    assert.equal(h.player.isPreparing(),false);
    assert.equal(h.clock.next,deadline);
    h.refresh=async()=>{h.state.fen=FEN;h.player.observe(FEN,h.state.board);};
    await h.clock.fire();
    assert.equal(h.calls.length,1);
    assert.equal(h.stales,0);
  }finally{h.player.destroy();}
});

test('fresh preflight awaits the reader without authorizing input and tolerates a temporary null FEN',async()=>{
  const h=freshHarness(),gate=deferred();try{
    h.refresh=()=>gate.promise;
    h.schedule(400);
    const waking=h.clock.fire();
    assert.equal(h.player.isPreparing(),true);
    assert.equal(h.player.isPending(),true);
    assert.equal(h.player.isExecuting(),false);
    assert.equal(h.calls.length,0);
    assert.equal(h.tokens.at(-1),null);
    h.state.fen=null;h.player.observe(null,h.state.board);
    assert.equal(h.player.isPreparing(),true);
    h.state.fen=FEN;gate.resolve();await waking;
    assert.equal(h.calls.length,1);
    assert.equal(h.player.isPending(),false);
  }finally{h.player.destroy();}
});

test('pause, side, known FEN and board changes during fresh preflight prevent an action',async()=>{
  for(const change of [
    h=>{h.state.enabled=false;h.player.cancel();},
    h=>{h.state.playerColor='b';},
    h=>{h.state.fen=FEN.replace(' w ',' b ');h.player.observe(h.state.fen,h.state.board);},
    h=>{h.state.board={isConnected:true};h.player.observe(null,h.state.board);},
  ]){
    const h=freshHarness(),gate=deferred();try{
      h.refresh=()=>gate.promise;h.schedule(400);
      const waking=h.clock.fire();assert.equal(h.player.isPreparing(),true);
      change(h);gate.resolve();await waking;
      assert.equal(h.calls.length,0);
      assert.equal(h.player.isPending(),false);
      assert.equal(h.tokens.at(-1),null);
      assert.deepEqual(h.errors,[]);
    }finally{h.player.destroy();}
  }
});

test('a failed refresh or unavailable fresh FEN reports stale and permits the next observation to replan',async()=>{
  for(const refresh of [async()=>{throw new Error('Lecture temporaire');},async()=>false,async()=>({ok:false})]){
    const h=freshHarness();try{
      h.refresh=refresh;h.schedule(400);await h.clock.fire();
      assert.equal(h.calls.length,0);assert.equal(h.stales,1);
      assert.equal(h.player.isPending(),false);assert.deepEqual(h.errors,[]);
      h.refresh=async()=>{};
      assert.equal(h.schedule(400),true);await h.clock.fire();
      assert.equal(h.calls.length,1);
    }finally{h.player.destroy();}
  }
  const h=freshHarness();try{
    h.schedule(400);h.state.fen=null;await h.clock.fire();
    assert.equal(h.stales,1);assert.equal(h.calls.length,0);
    h.state.fen=FEN;assert.equal(h.schedule(400),true);await h.clock.fire();
    assert.equal(h.calls.length,1);
  }finally{h.player.destroy();}
});

test('known pre-input transient failures retry at most twice, after 1000ms and another fresh read',async()=>{
  const h=freshHarness();try{
    h.play=async()=>({ok:false,retryable:true,inputSent:false,error:'Animation en cours'});
    h.schedule(400);
    for(let attempt=1;attempt<=3;attempt+=1){
      await h.clock.fire();
      assert.equal(h.calls.length,attempt);
      assert.equal(h.refreshes,attempt);
      assert.equal(h.player.isExecuting(),false);
      assert.equal(h.tokens.at(-1),null);
      assert.equal(h.schedule(0),false,'duplicate proposals cannot bypass the retry budget');
      if(attempt<3){
        assert.equal(h.clock.next.ms,1000);
        assert.equal(h.player.isPending(),true);
        assert.equal(h.retries.length,attempt);
      }
    }
    assert.equal(new Set(h.calls.map(call=>call.token)).size,3);
    assert.equal(h.clock.size,0);assert.equal(h.player.isPending(),false);
    assert.equal(h.errors.length,1);assert.equal(h.retries.length,2);
    assert.equal(h.errors[0].response.inputSent,false);
    assert.equal(h.errors[0].ticket.fen,FEN);
  }finally{h.player.destroy();}
});

test('a stale preflight during a known-safe retry can replan without resetting the bounded attempt count',async()=>{
  const h=freshHarness();try{
    h.play=async()=>({ok:false,retryable:true,inputSent:false,error:'Attente'});
    h.schedule(400);await h.clock.fire();
    h.refresh=async()=>false;await h.clock.fire();
    assert.equal(h.stales,1);assert.equal(h.calls.length,1);
    h.refresh=async()=>{};
    assert.equal(h.schedule(0),true);
    assert.equal(h.clock.next.ms,1000);
    await h.clock.fire();await h.clock.fire();
    assert.equal(h.calls.length,3);
    assert.equal(h.errors.length,1);assert.equal(h.schedule(0),false);
  }finally{h.player.destroy();}
});

test('sent, unknown and nonretryable failures are never retried and preserve duplicate protection',async()=>{
  for(const response of [
    {ok:false,retryable:true,inputSent:true,error:'Entrée envoyée'},
    {ok:false,retryable:true,error:'État inconnu'},
    {ok:false,retryable:false,inputSent:false,error:'Refus permanent'},
  ]){
    const h=freshHarness();try{
      h.play=async()=>response;h.schedule(400);await h.clock.fire();
      assert.equal(h.calls.length,1);assert.equal(h.clock.size,0);
      assert.equal(h.errors.length,1);assert.equal(h.errors[0].response,response);
      assert.equal(h.retries.length,0);assert.equal(h.schedule(400),false);
    }finally{h.player.destroy();}
  }
});

test('pause while waiting for a safe retry cancels it and an old timer callback stays inert',async()=>{
  const h=freshHarness();try{
    h.play=async()=>({ok:false,retryable:true,inputSent:false,error:'Attente'});
    h.schedule(400);await h.clock.fire();
    const late=h.clock.next.callback;
    h.player.cancel();assert.equal(h.clock.size,0);
    await late();assert.equal(h.calls.length,1);assert.equal(h.refreshes,1);
    assert.equal(h.player.isPending(),false);assert.deepEqual(h.errors,[]);
  }finally{h.player.destroy();}
});
