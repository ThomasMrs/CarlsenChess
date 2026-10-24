import test from 'node:test';
import assert from 'node:assert/strict';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let importId = 0;
async function harness(getContexts) {
  const previous = globalThis.chrome;
  let listener;
  const calls = [];
  const event = { addListener() {} };
  globalThis.chrome = {
    action: { onClicked: event }, tabs: { onRemoved: event, onUpdated: event },
    runtime: { id: 'unit-extension', getURL: value => `chrome-extension://unit-extension/${value}`,
      onMessage: { addListener(fn) { listener = fn; } }, getContexts,
      sendMessage: async message => { calls.push(message); return { ok: true }; } },
    offscreen: { createDocument: async () => {} },
  };
  await import(`../extension/background.js?unit=${++importId}`);
  return { calls,
    send: message => new Promise(resolve => {
      assert.equal(listener(message, { id: 'unit-extension', tab: { id: 7 } }, resolve), true);
    }),
    close() { globalThis.chrome = previous; },
  };
}

test('a delayed STOP cannot cancel a newer analysis for the same tab', async () => {
  const oldStop = deferred();
  let contextReads = 0;
  const h = await harness(() => ++contextReads === 1 ? oldStop.promise : Promise.resolve([{}]));
  try {
    const stop = h.send({ type: 'CC_STOP' });
    assert.deepEqual(await h.send({ type: 'CC_ANALYZE', requestId: 'new-analysis' }), { ok: true });
    oldStop.resolve([{}]);
    assert.equal((await stop).cancelled, true);
    assert.deepEqual(h.calls.map(message => message.type), ['CC_ENGINE_ANALYZE']);
    assert.equal(h.calls[0].requestId, 'new-analysis');
  } finally { h.close(); }
});

test('the current STOP is still relayed to cancel its tab analysis', async () => {
  const h = await harness(async () => [{}]);
  try {
    await h.send({ type: 'CC_ANALYZE', requestId: 'analysis' });
    await h.send({ type: 'CC_STOP' });
    assert.deepEqual(h.calls.map(message => message.type), ['CC_ENGINE_ANALYZE', 'CC_ENGINE_STOP']);
    assert.ok(h.calls.every(message => message.tabId === 7));
  } finally { h.close(); }
});
