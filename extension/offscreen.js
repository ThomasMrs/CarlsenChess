// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { EngineClient } from './core/engine-client.js';

let engine;
let active;
let queue = Promise.resolve();
let idleTimer;
const generations = new Map();
const advance = (tabId) => {
  const generation = (generations.get(tabId) || 0) + 1;
  generations.set(tabId, generation);
  if (active?.tabId === tabId) engine?.stop();
  return generation;
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !Number.isInteger(message?.tabId)) return false;
  if (message.type === 'CC_ENGINE_STOP') {
    advance(message.tabId);
    reply({ ok: true });
    return false;
  }
  if (message.type !== 'CC_ENGINE_ANALYZE') return false;
  const generation = advance(message.tabId);
  const isCancelled = () => generations.get(message.tabId) !== generation;
  const run = async () => {
    if (isCancelled()) return { ok: false, cancelled: true, error: 'Analyse remplacée.' };
    clearTimeout(idleTimer);
    active = { tabId: message.tabId, generation };
    try {
      if (!engine || engine.dead) engine = new EngineClient(() => new Worker(chrome.runtime.getURL('engine/stockfish-19-single.js')));
      const result = await engine.analyze(message.fen, message.settings, isCancelled);
      return result.cancelled ? { ok: false, cancelled: true, error: 'Analyse remplacée.' } : { ok: true, result };
    } catch (error) {
      return { ok: false, error: error.message || 'Échec du moteur local.' };
    } finally {
      active = null;
      idleTimer = setTimeout(() => { engine?.dispose(); engine = undefined; }, 90000);
    }
  };
  const task = queue.then(run, run);
  queue = task.then(() => {}, () => {});
  task.then(reply);
  return true;
});
