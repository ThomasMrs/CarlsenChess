import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, parseInfo, validatePosition, selectMove, isLegalUci } from '../extension/core/analysis.js';
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
  assert.deepEqual(normalizeSettings({elo:99999,movetime:99999}),{elo:3190,movetime:10000,humanize:false});
});
