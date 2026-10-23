// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
const KNIGHT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 4 6-2 1 4 4 5-2 5H9l-2 4h12v2H5v-3l5-8-4 2-3-2 5-7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 7h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export function createPanel(root) {
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = chrome.runtime.getURL('content/panel.css');
  root.append(sheet);
  const container = document.createElement('div');
  container.innerHTML = `
    <button class="cc-reopen" type="button" aria-label="Ouvrir CarlsenChess" title="Ouvrir CarlsenChess" hidden>${KNIGHT}</button>
    <section class="cc-panel" role="region" aria-label="CarlsenChess — assistant d’échecs">
      <header class="cc-header">
        <div class="cc-brand-icon">${KNIGHT}</div>
        <div class="cc-brand"><span class="cc-eyebrow">VOTRE PROCHAIN COUP</span><h2>CarlsenChess</h2></div>
        <div class="cc-window-actions"><button type="button" class="cc-icon-button" data-action="collapse" aria-label="Réduire le panneau" title="Réduire">−</button><button type="button" class="cc-icon-button" data-action="close" aria-label="Fermer et arrêter l’analyse" title="Fermer">×</button></div>
      </header>
      <div class="cc-body">
        <div class="cc-state-row"><span class="cc-badge" data-ref="badge">En pause</span><span class="cc-source" data-ref="source">Détection auto</span></div>
        <section class="cc-suggestion" aria-label="Coup proposé" aria-busy="false" data-ref="suggestion">
          <div class="cc-move-row"><span class="cc-move" data-ref="move">—</span><span class="cc-eval" data-ref="evaluation" title="Évaluation pour les Blancs">—</span></div>
          <p class="cc-coordinates" data-ref="coordinates">Le plateau attend votre prochain coup.</p>
          <p class="cc-status" data-ref="status" role="status" aria-live="polite">Démarrez pour analyser la position.</p>
        </section>
        <div class="cc-actions"><button type="button" class="cc-primary" data-action="start">Démarrer</button><button type="button" class="cc-secondary" data-action="refresh" disabled aria-label="Réanalyser la position" title="Réanalyser la position"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16 8a6 6 0 1 0-.5 5M16 3v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
        <div class="cc-divider"></div>
        <div class="cc-field"><label for="cc-strength-mode">Force du moteur</label><select id="cc-strength-mode" data-setting="strengthMode"><option value="max">Puissance maximale</option><option value="target">Elo cible</option></select></div>
        <div class="cc-elo-field" data-ref="eloField" hidden><div class="cc-range-label"><label for="cc-strength">Elo cible</label><output for="cc-strength" data-ref="eloValue">2000</output></div><input id="cc-strength" data-setting="strength" type="range" min="1320" max="3190" step="10" value="2000"><div class="cc-range-ends"><span>1320</span><span>3190</span></div><p class="cc-help">Niveau indicatif : le classement réel varie.</p></div>
        <label class="cc-toggle" for="cc-humanize"><span><span class="cc-toggle-title">Humaniser les choix</span><span class="cc-help">Varie parmi les bons coups proches.</span></span><input id="cc-humanize" data-setting="humanize" type="checkbox"><span class="cc-switch" aria-hidden="true"></span></label>
        <div class="cc-field cc-inline-field"><label for="cc-time">Temps d’analyse</label><select id="cc-time" data-setting="movetime"><option value="400">Rapide · 0,4 s</option><option value="1200">Équilibré · 1,2 s</option><option value="2500">Approfondi · 2,5 s</option></select></div>
        <details class="cc-advanced" data-ref="advanced"><summary>Connexion au plateau<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 6 3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></summary><div class="cc-advanced-body">
          <div class="cc-field"><label for="cc-orientation">Orientation du plateau</label><select id="cc-orientation" data-setting="orientation"><option value="auto">Automatique</option><option value="white">Blancs en bas</option><option value="black">Noirs en bas</option></select></div>
          <div class="cc-field"><label for="cc-board-selector">Sélecteur CSS du plateau</label><input id="cc-board-selector" data-setting="boardSelector" type="text" spellcheck="false" placeholder="Détection automatique" autocomplete="off"><p class="cc-help">Facultatif, pour un plateau personnalisé.</p></div>
          <div class="cc-field"><label for="cc-fen-selector">Sélecteur CSS du FEN</label><input id="cc-fen-selector" data-setting="fenSelector" type="text" spellcheck="false" placeholder="Ex. #game-fen" autocomplete="off"><p class="cc-help">FEN complet à 6 champs, attribut ou texte.</p></div>
          <label class="cc-manual-label"><input type="checkbox" data-setting="manualMode">Utiliser un FEN manuel</label>
          <div class="cc-field" data-ref="manualField" hidden><label for="cc-manual-fen">Position FEN</label><textarea id="cc-manual-fen" data-setting="manualFen" rows="4" spellcheck="false" placeholder="Collez les 6 champs du FEN complet"></textarea><p class="cc-help">Mettez en pause pour changer de position, puis démarrez.</p></div>
        </div></details>
        <div class="cc-engine" data-ref="engine">Stockfish · calcul sur cet appareil</div>
      </div>
      <footer class="cc-footer"><span>© 2026 Thomas Marsa</span><span>v1.1</span></footer>
    </section>`;
  root.append(container);
  const refs = Object.fromEntries([...container.querySelectorAll('[data-ref]')].map(el => [el.dataset.ref, el]));
  const controls = Object.fromEntries([...container.querySelectorAll('[data-setting]')].map(el => [el.dataset.setting, el]));
  const actions = Object.fromEntries([...container.querySelectorAll('[data-action]')].map(el => [el.dataset.action, el]));
  const panel = container.querySelector('.cc-panel');
  const reopen = container.querySelector('.cc-reopen');
  return { container, panel, reopen, refs, controls, actions };
}

export function syncSettings(ui, settings) {
  const c = ui.controls;
  c.strengthMode.value = settings.strength === 'max' ? 'max' : 'target';
  c.strength.value = settings.strength === 'max' ? '2000' : String(settings.strength);
  c.humanize.checked = settings.humanize;
  c.movetime.value = String(settings.movetime);
  c.orientation.value = settings.orientation;
  c.boardSelector.value = settings.boardSelector;
  c.fenSelector.value = settings.fenSelector;
  c.manualMode.checked = settings.manualMode;
  c.manualFen.value = settings.manualFen;
  ui.refs.eloField.hidden = settings.strength === 'max';
  ui.refs.eloValue.value = c.strength.value;
  ui.refs.manualField.hidden = !settings.manualMode;
}

export function setRunning(ui, running) {
  ui.actions.start.textContent = running ? 'Mettre en pause' : 'Démarrer';
  ui.actions.start.classList.toggle('is-running', running);
  ui.actions.refresh.disabled = !running;
  ui.controls.manualFen.disabled = running && ui.controls.manualMode.checked;
}

export function setStatus(ui, message, kind = 'idle') {
  ui.refs.status.textContent = message;
  ui.refs.badge.textContent = { idle: 'En pause', loading: 'Analyse…', ready: 'Coup trouvé', error: 'À vérifier', waiting: 'En attente', complete: 'Terminée' }[kind] || 'En attente';
  ui.refs.badge.dataset.state = kind;
  ui.refs.suggestion.setAttribute('aria-busy', String(kind === 'loading'));
}

export function clearSuggestion(ui) {
  ui.refs.move.textContent = '—';
  ui.refs.evaluation.textContent = '—';
  ui.refs.coordinates.textContent = 'Aucun coup affiché sur le plateau.';
}
