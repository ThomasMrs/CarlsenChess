// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { readChessComSnapshot } from './content/chesscom-bridge.js';
import { playChessComMove } from './content/chesscom-play.js';
import { validatePosition, isLegalUci } from './core/analysis.js';
let creatingOffscreen;
const tabGenerations = new Map();
const activePlays = new Set();

async function ensureOffscreen() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Exécuter le moteur Stockfish WebAssembly dans un Worker local.',
      });
    }
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = undefined; }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/bootstrap.js'] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Ouvrir CarlsenChess' });
  } catch {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#a64332' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Ouvrez votre jeu sur une page HTTP/HTTPS, puis cliquez à nouveau.' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['CC_ANALYZE', 'CC_STOP', 'CC_READ_CHESSCOM', 'CC_PLAY_CHESSCOM'].includes(message?.type)) return false;
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) {
    reply({ ok: false, error: 'Onglet source invalide.' });
    return false;
  }
  if (message.type === 'CC_READ_CHESSCOM' || message.type === 'CC_PLAY_CHESSCOM') {
    let validOrigin = false;
    try {
      const url = new URL(sender.url);
      validOrigin = url.protocol === 'https:' && (url.hostname === 'chess.com' || url.hostname.endsWith('.chess.com'));
    } catch { /* Only a real Chess.com document may ask for a MAIN-world read. */ }
    if (!validOrigin || sender.frameId !== 0 || typeof sender.documentId !== 'string') {
      reply({ ok: false, error: 'Cette lecture est réservée au plateau Chess.com de l’onglet courant.' });
      return false;
    }
    if (message.type === 'CC_PLAY_CHESSCOM') {
      try {
        const board = validatePosition(message.fen);
        if (!['w', 'b'].includes(message.playerColor) || board.turn() !== message.playerColor
          || board.isGameOver() || !isLegalUci(board, message.uci)
          || !['white', 'black'].includes(message.orientation)
          || typeof message.token !== 'string' || !message.token || message.token.length > 128) {
          throw new Error('Coup automatique invalide ou position terminée.');
        }
        if (activePlays.has(sender.documentId)) throw new Error('Un coup automatique est déjà en cours.');
        activePlays.add(sender.documentId);
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
          world: 'MAIN', func: playChessComMove,
          args: [{ expectedFen: message.fen, uci: message.uci, color: message.playerColor,
            orientation: message.orientation, token: message.token,
            boardSelector: typeof message.boardSelector === 'string' ? message.boardSelector.slice(0, 1000) : '' }],
        }).then(results => reply(results[0]?.result || { ok: false, played: false, error: 'Le coup n’a pas été confirmé.' }))
          .catch(() => reply({ ok: false, played: false, error: 'Le coup automatique a été interrompu. Vérifiez le plateau.' }))
          .finally(() => activePlays.delete(sender.documentId));
        return true;
      } catch (error) {
        reply({ ok: false, played: false, error: error.message });
        return false;
      }
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      world: 'MAIN', func: readChessComSnapshot,
      args: [typeof message.boardSelector === 'string' ? message.boardSelector.slice(0, 1000) : ''],
    }).then((results) => reply(results[0]?.result || { ok: false, error: 'Position Chess.com indisponible.' }))
      .catch(() => reply({ ok: false, error: 'Lecture Chess.com interrompue. Rechargez la page puis ouvrez l’extension.' }));
    return true;
  }
  const tabId = sender.tab.id;
  const generation = (tabGenerations.get(tabId) || 0) + 1;
  tabGenerations.set(tabId, generation);
  (async () => {
    if (message.type === 'CC_STOP') {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (!contexts.length) return { ok: true };
    } else {
      await ensureOffscreen();
      if (tabGenerations.get(tabId) !== generation) return { ok: false, cancelled: true, error: 'Analyse remplacée.' };
    }
    return chrome.runtime.sendMessage({
      type: message.type === 'CC_STOP' ? 'CC_ENGINE_STOP' : 'CC_ENGINE_ANALYZE',
      tabId, requestId: message.requestId,
      fen: message.fen, settings: message.settings,
    });
  })().then(reply).catch((error) => reply({ ok: false, error: error.message || 'Moteur indisponible.' }));
  return true;
});

function stopTab(tabId) {
  tabGenerations.set(tabId, (tabGenerations.get(tabId) || 0) + 1);
  chrome.runtime.sendMessage({ type: 'CC_ENGINE_STOP', tabId }).catch(() => {});
}
chrome.tabs.onRemoved.addListener(stopTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') stopTab(tabId);
});
