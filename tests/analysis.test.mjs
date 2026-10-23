import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, strengthProfile, parseInfo, validatePosition, selectMove, isLegalUci } from '../extension/core/analysis.js';
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('complete FEN and legality of ordinary, castling and promotion moves', () => {
  assert.throws(() => validatePosition(start.split(' ')[0]));
  assert.throws(() => validatePosition('8/8/8/8/8/8/4k3/4K3 w - - 0 1'));
  const board = validatePosition(start);
  assert.equal(isLegalUci(board,'e2e4'), true);
  assert.equal(isLegalUci(board,'e2e5'), false);
  assert.equal(isLegalUci(board,'e2e4\nisready'), false);
  assert.equal(isLegalUci(validatePosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1g1'),true);
  assert.equal(isLegalUci(validatePosition('7k/P7/8/8/8/8/8/7K w - - 0 1'),'a7a8q'),true);
  assert.equal(isLegalUci(validatePosition('7k/P7/8/8/8/8/8/7K w - - 0 1'),'a7a8'),false);
});

test('UCI info parsing ignores bounded evaluations and non-PV output', () => {
  assert.deepEqual(parseInfo('info depth 18 multipv 2 score cp -12 nodes 25 pv e2e4 e7e5'), {
    move:'e2e4',pv:['e2e4','e7e5'],score:{type:'cp',value:-12},depth:18,multipv:2 });
  assert.equal(parseInfo('info depth 18 score cp 35 lowerbound pv e2e4'),null);
  assert.equal(parseInfo('info string hello'),null);
});

test('humanization retains forced mates and never invents a move', () => {
  const lines = [
    {move:'e2e4',score:{type:'cp',value:40}},
    {move:'d2d4',score:{type:'cp',value:30}},
    {move:'g2g4',score:{type:'cp',value:-400}},
  ];
  assert.equal(selectMove(lines,'e2e4',{elo:'max',humanize:false},()=>.99),'e2e4');
  assert.equal(selectMove(lines,'e2e4',{elo:'max',humanize:true},()=>.99),'d2d4');
  assert.equal(selectMove(lines,'a2a3',{elo:1400,humanize:true},()=>.99),'a2a3');
  assert.equal(selectMove([{move:'e2e4',score:{type:'mate',value:2}},...lines.slice(1)],'e2e4',{elo:1400,humanize:true},()=>.99),'e2e4');
  assert.deepEqual(normalizeSettings({elo:99999,movetime:99999}),{elo:3000,movetime:10000,humanize:false});
});

test('strength targets snap old values to 500-point steps and default to full strength', () => {
  for (const value of [undefined, null, '', 'max', 'unknown', Infinity]) {
    assert.equal(normalizeSettings({elo:value}).elo, 'max');
  }
  for (const [value, expected] of [[-10,500],[500,500],[749,500],[750,1000],[1000,1000],
    [1320,1500],[1600,1500],[1750,2000],[2500,2500],[3190,3000],['2000',2000]]) {
    assert.equal(normalizeSettings({elo:value}).elo,expected);
  }
  assert.equal(normalizeSettings().elo,'max');
});

test('beginner targets have different approximate profiles; native and max retain normal search', () => {
  const beginner=strengthProfile({elo:500,movetime:10000});
  const novice=strengthProfile({elo:1000,movetime:10000});
  assert.equal(beginner.strengthMode,'approximate');
  assert.equal(novice.strengthMode,'approximate');
  assert.equal(beginner.engineElo,null);
  assert.equal(novice.engineElo,null);
  assert.ok(beginner.skillLevel < novice.skillLevel);
  assert.ok(beginner.searchDepth < novice.searchDepth);
  assert.ok(beginner.movetime < novice.movetime);
  const native=strengthProfile({elo:1600,movetime:1200});
  assert.equal(native.targetElo,1500);
  assert.equal(native.engineElo,1500);
  assert.equal(native.strengthMode,'native');
  assert.equal(native.searchDepth,null);
  assert.equal(native.movetime,1200);
  assert.equal(strengthProfile({elo:3000},{min:1320,max:2900}).engineElo,2900);
  assert.deepEqual(strengthProfile({elo:'max',movetime:1200}), {
    targetElo:'max',strengthMode:'max',engineElo:null,skillLevel:20,searchDepth:null,movetime:1200,multiPv:3,
  });
});

test('500 and 1000 strengths vary legal candidates even with humanization disabled', () => {
  const board=validatePosition(start);
  const lines=[
    {move:'e2e4',score:{type:'cp',value:40}},
    {move:'a2a5',score:{type:'cp',value:35}}, // Never accept an illegal engine candidate.
    {move:'d2d4',score:{type:'cp',value:-80}},
    {move:'g2g4',score:{type:'cp',value:-200}},
  ];
  assert.equal(selectMove(lines,'e2e4',{elo:500,humanize:false},()=>.99,board),'g2g4');
  assert.equal(selectMove(lines,'e2e4',{elo:1000,humanize:false},()=>.99,board),'d2d4');
  assert.equal(selectMove(lines,'e2e4',{elo:1500,humanize:false},()=>.99,board),'e2e4');
  assert.equal(selectMove(lines,'e2e4',{elo:'max',humanize:false},()=>0,board),'e2e4');
});

test('humanization adds beginner variation within the same legal pool and preserves mate handling', () => {
  const board=validatePosition(start);
  const lines=[
    {move:'e2e4',score:{type:'cp',value:40}},
    {move:'d2d4',score:{type:'cp',value:-20}},
  ];
  for (const [elo, draw] of [[500,.58],[1000,.67]]) {
    const select=humanize=>{
      const draws=[.99,draw]; // Skip the independent beginner-error branch.
      return selectMove(lines,'e2e4',{elo,humanize},()=>draws.shift(),board);
    };
    assert.equal(select(false),'e2e4');
    assert.equal(select(true),'d2d4');
    assert.equal(isLegalUci(board,select(true)),true);
    const mateLines=[{...lines[0],score:{type:'mate',value:2}},lines[1]];
    for (const humanize of [false,true]) {
      assert.equal(selectMove(mateLines,'e2e4',{elo,humanize},()=>.99,board),'e2e4');
    }
  }
});

test('bounded beginner fallback works without enough MultiPV candidates and samples only legal moves', () => {
  const board=validatePosition(start);
  const lines=[{move:'e2e4',score:{type:'cp',value:40}}];
  let draws=[.2,.99];
  const weaker=selectMove(lines,'e2e4',{elo:500,humanize:false},()=>draws.shift(),board);
  assert.notEqual(weaker,'e2e4');
  assert.equal(isLegalUci(board,weaker),true);
  assert.equal(selectMove(lines,'e2e4',{elo:1000,humanize:false},()=>.2,board),'e2e4');
  assert.equal(selectMove(lines,'e2e4',{elo:500,humanize:false},()=>.4,board),'e2e4');
  for (const fen of [start,'7k/P7/8/8/8/8/8/7K w - - 0 1','r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1']) {
    const position=validatePosition(fen);
    const first=position.moves({verbose:true})[0];
    const best=`${first.from}${first.to}${first.promotion || ''}`;
    for (const elo of [500,1000]) {
      for (const sample of [0,.25,.5,.75,.999]) {
        let draw=0;
        const selected=selectMove([],best,{elo,humanize:false},()=>draw++ ? sample : 0,position);
        assert.equal(isLegalUci(position,selected),true,`${elo}: ${selected}`);
      }
    }
  }
});
