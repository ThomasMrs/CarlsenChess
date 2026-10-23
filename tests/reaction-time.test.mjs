import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateReactionTime } from '../extension/content/reaction-time.js';
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FORCED='8/8/8/8/8/8/2k5/Kr6 w - - 0 1';
const TACTICAL='r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const pair=(first,second,gap=300,depth=18)=>[
  {move:first,multipv:1,depth,score:{type:'cp',value:40},pv:[first]},
  {move:second,multipv:2,depth,score:{type:'cp',value:40-gap},pv:[second]},
];

test('forced, obvious and tactically complex choices receive increasing bounded times',()=>{
  const forced=estimateReactionTime({fen:FORCED,uci:'a1a2'});
  const simple=estimateReactionTime({fen:START,uci:'e2e4',lines:pair('e2e4','d2d4')});
  const complex=estimateReactionTime({fen:TACTICAL,uci:'e2a6',lines:pair('e2a6','d5e6',5)});
  assert.deepEqual(forced,{targetMs:900,level:'Forcé',reason:'Seul coup légal'});
  assert.equal(simple.level,'Simple');
  assert.equal(complex.level,'Complexe');
  assert.ok(forced.targetMs < simple.targetMs);
  assert.ok(simple.targetMs < complex.targetMs);
  for(const result of [forced,simple,complex]){
    assert.ok(result.targetMs >= 900 && result.targetMs <= 10000);
    assert.equal(Number.isInteger(result.targetMs),true);
  }
});

test('comparable close scores, responses to check and promotions increase the heuristic cost',()=>{
  const obvious=estimateReactionTime({fen:START,uci:'e2e4',lines:pair('e2e4','d2d4',300)});
  const close=estimateReactionTime({fen:START,uci:'e2e4',lines:pair('e2e4','d2d4',10)});
  assert.ok(close.targetMs > obvious.targetMs);
  assert.equal(close.reason,'Meilleurs coups proches');
  const checked=estimateReactionTime({fen:'4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',uci:'e1d1',lines:pair('e1d1','e1f1',10)});
  assert.equal(checked.reason,'Réponses à un échec');
  assert.equal(checked.level,'Complexe');
  const promotion=estimateReactionTime({fen:'7k/P7/8/8/8/8/8/7K w - - 0 1',uci:'a7a8n',lines:pair('a7a8n','a7a8b',10)});
  assert.equal(promotion.reason,'Promotion à examiner');
  assert.ok(promotion.targetMs > obvious.targetMs);
  assert.equal(estimateReactionTime({fen:'7k/P7/8/8/8/8/8/7K w - - 0 1',uci:'a7a8',lines:[]}).level,'Neutre');
});

test('missing, partial-depth, unranked and mate evaluations use neutral pacing',()=>{
  const valid=pair('e2e4','d2d4',20);
  for(const lines of [undefined,[],[valid[0]],
    [valid[0],{...valid[1],depth:17}],
    [{...valid[0],multipv:2},{...valid[1],multipv:3}],
    valid.map(({multipv,...line})=>line),
    [{...valid[0],score:{type:'mate',value:3}},valid[1]],
    [valid[0],{...valid[1],score:{type:'mate',value:-3}}],
    [...valid,{...valid[0],depth:19}],
    [{...valid[0],score:{type:'cp',value:-50}},valid[1]],
  ]){
    assert.deepEqual(estimateReactionTime({fen:START,uci:'e2e4',lines}),
      {targetMs:3200,level:'Neutre',reason:'Analyses comparables insuffisantes'});
  }
});

test('illegal, duplicate, malformed and incomplete lines cannot create a comparison',()=>{
  const valid=pair('e2e4','d2d4',20);
  for(const line of [null,{}, {...valid[1],move:'d2d5'}, {...valid[1],move:'e2e4',pv:['e2e4']},
    {...valid[1],depth:0}, {...valid[1],depth:1.5}, {...valid[1],score:{type:'cp'}},
    {...valid[1],score:{type:'cp',value:NaN}}, {...valid[1],pv:[]},
    {...valid[1],pv:['d2d4','invalid']}, {...valid[1],pv:['d2d4','e7e4']}, {...valid[1],pv:['e2e4']},
  ]){
    assert.equal(estimateReactionTime({fen:START,uci:'e2e4',lines:[valid[0],line]}).level,'Neutre');
  }
  const ordinary=estimateReactionTime({fen:START,uci:'e2e4',lines:valid});
  assert.deepEqual(estimateReactionTime({fen:START,uci:'e2e4',lines:[null,{},...valid,...valid]}),ordinary);
});

test('invalid positions and illegal requested moves remain neutral; an actual immediate mate is short',()=>{
  for(const input of [null,{},{fen:'invalid',uci:'e2e4'}, {fen:START,uci:'e2e5'},
    {fen:START,uci:'e2e4\nisready'}, {fen:START.split(' ')[0],uci:'e2e4'},
    {fen:'8/8/8/8/8/8/4k3/4K3 w - - 0 1',uci:'e1e2'}]){
    assert.deepEqual(estimateReactionTime(input),{targetMs:3200,level:'Neutre',reason:'Position ou coup invalide'});
  }
  assert.deepEqual(estimateReactionTime({fen:'6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1',uci:'f3a8'}),
    {targetMs:1200,level:'Simple',reason:'Mat immédiat'});
});

test('the heuristic is deterministic, bounded and leaves input data intact',()=>{
  const lines=pair('e2a6','d5e6',0);
  const before=structuredClone(lines);
  const input={fen:TACTICAL,uci:'e2a6',lines};
  const first=estimateReactionTime(input);
  assert.deepEqual(estimateReactionTime(input),first);
  assert.deepEqual(lines,before);
  for(const gap of [0,1,20,21,60,61,120,121,199,200,1000000]){
    const result=estimateReactionTime({...input,lines:pair('e2a6','d5e6',gap)});
    assert.ok(result.targetMs >= 900 && result.targetMs <= 10000);
  }
});
