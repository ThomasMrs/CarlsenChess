# CarlsenChess

Extension Google Chrome Manifest V3 créée par **Thomas Marsa**, avec un panneau compact à droite et des indications directement sur le plateau. Stockfish 19 analyse les positions localement ; une flèche indique la pièce à déplacer et sa case d’arrivée. L’extension ne joue aucun coup à votre place.

Le mode **Puissance maximale** utilise la force disponible du moteur. Le réglage **Elo cible** propose une force réduite entre 1320 et 3190. Cette valeur est un réglage indicatif de Stockfish, pas un classement humain garanti. Le mode **Humaniser** varie la suggestion parmi des candidats plausibles évalués par le moteur ; il ne simule ni clics ni délais de jeu.

![CarlsenChess en fonctionnement : panneau droit et flèche sur le plateau](.github/assets/preview.png)

## Installer la V1

Prérequis : Google Chrome 116 ou version ultérieure. Node.js 20.19 ou version ultérieure est nécessaire uniquement pour reconstruire le projet depuis ses sources.

```sh
git clone https://github.com/ThomasMrs/CarlsenChess.git
cd CarlsenChess
npm ci
npm run build
```

1. Ouvrir `chrome://extensions` et activer le **Mode développeur**.
2. Cliquer sur **Charger l’extension non empaquetée**.
3. Sélectionner le dossier `dist/CarlsenChess`.
4. Épingler CarlsenChess dans la barre d’outils de Chrome.
5. Ouvrir le jeu, puis cliquer sur l’icône CarlsenChess pour afficher le panneau.

Le build produit aussi `dist/CarlsenChess-v1.0.0.zip` et l’archive complète de sources `dist/CarlsenChess-v1.0.0-source.zip`. Si vous avez téléchargé l’archive de l’extension déjà construite, la décompresser puis charger le dossier qui contient `manifest.json`.

Après une modification du code, relancer `npm run build`, recharger l’extension dans `chrome://extensions`, puis recharger la page du jeu et cliquer sur l’icône.

## Utiliser le panneau

Choisir la force souhaitée et l’option d’humanisation, puis cliquer sur **Démarrer**. Dès qu’une position complète est disponible, le panneau affiche une suggestion pour le camp au trait et la flèche apparaît sur le plateau. Dans **Connexion au plateau**, l’orientation peut être ajustée pour correspondre au plateau retourné. Les réglages sont enregistrés localement.

La position est réanalysée lorsque le jeu met à jour sa FEN. Une FEN saisie manuellement reste la position saisie : mettre en pause, la remplacer après chaque coup puis redémarrer pour analyser la nouvelle position.

## Relier votre jeu en ligne

La V1 prend en charge les jeux qui exposent une **FEN complète de six champs** dans le document principal de la page. L’URL et le code de votre jeu n’ont pas encore été fournis : la compatibilité avec ce jeu précis reste donc à valider. La détection d’un dessin de plateau ne suffit pas à déterminer les droits de roque, la prise en passant ou le camp au trait.

La meilleure intégration consiste à ajouter ces attributs au conteneur exact du plateau :

```html
<div
  id="board"
  data-carlsenchess-board
  data-carlsenchess-orientation="white"
  data-carlsenchess-fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
></div>
```

Après **chaque coup**, mettre à jour la FEN depuis l’état réel du jeu. Avec chess.js, par exemple :

```js
const boardElement = document.querySelector('[data-carlsenchess-board]');

function syncCarlsenChess(game, orientation = 'white') {
  boardElement.dataset.carlsenchessFen = game.fen();
  boardElement.dataset.carlsenchessOrientation = orientation;
}
```

Utiliser `black` pour l’orientation lorsque les pièces noires sont en bas. La FEN doit inclure le placement, le camp au trait, les droits de roque, la case de prise en passant, le compteur de demi-coups et le numéro du coup. Ne pas reconstruire ces informations à partir des seules pièces visibles.

Le détecteur cherche le plus grand plateau visible parmi les sélecteurs suivants :

```css
[data-carlsenchess-board], cg-board, chess-board, .chess-board, #board, .board
```

Il lit `data-carlsenchess-fen`, `data-fen` ou `data-chess-fen` sur le plateau ou un conteneur propre à ce plateau. Le panneau permet de préciser un sélecteur CSS du plateau, un sélecteur de source FEN ou une FEN manuelle. Un champ de texte ciblé par le sélecteur FEN peut aussi fournir la FEN complète. Si plusieurs plateaux sont présents, renseigner leur sélecteur exact.

Les plateaux enfermés dans une iframe ou une racine Shadow DOM ne font pas partie de la détection générique de cette V1. Ils nécessitent un adaptateur adapté au jeu.

## Essayer et vérifier

```sh
npm test
npm run demo
```

Ouvrir ensuite [la démonstration locale](http://127.0.0.1:8787/demo/), puis cliquer sur l’icône de l’extension. La démo expose une FEN complète et permet de vérifier le positionnement des indications. Cliquer sur **Démarrer** dans le panneau pour lancer le moteur.

```sh
npm run test:e2e
```

La vérification de navigateur utilise Playwright et Chromium en mode sans interface. Selon l’environnement, installer d’abord le navigateur avec `npx playwright install chromium`.

Le test charge une copie provisoire de l’extension avec un accès limité à `http://127.0.0.1/*`, car Playwright ne peut pas cliquer sur le bouton de la barre d’outils pour accorder `activeTab` dans ce mode. Le manifeste distribué reste inchangé. L’injection, l’interface, les échanges entre composants et le véritable moteur WebAssembly utilisent les fichiers de production. Ce test couvre les suggestions, le changement de position et d’orientation, les réglages, l’arrêt de l’analyse et la saisie FEN ; l’octroi manuel de `activeTab` reste à vérifier dans Chrome avec le bouton de l’extension.

La CI GitHub exécute les tests Node.js sur Node 22, y compris les vérifications du manifeste et du moteur Stockfish réel. Les tests de navigateur se lancent localement.

## Fonctionnement et permissions

Le clic sur l’icône accorde l’accès à l’onglet courant avec `activeTab`. `scripting` insère l’interface, `storage` conserve les réglages et `offscreen` héberge le moteur dans un document de l’extension. Le moteur WebAssembly fonctionne dans un Worker local de ce document, indépendamment de la politique CSP du jeu. Aucun accès permanent à l’ensemble des sites n’est demandé.

Stockfish.js **19.0.1**, variante complète à un seul thread, est embarqué dans l’extension. Une fois l’extension construite, l’analyse ne nécessite aucun service distant ni clé API. La force maximale et le temps de calcul réel dépendent de la machine et du budget d’analyse choisi.

## Organisation du code

| Dossier ou fichier | Rôle |
| --- | --- |
| `extension/background.js` | Activation depuis la barre d’outils et relais des demandes d’analyse. |
| `extension/content/` | Panneau, lecture de la FEN et indications sur le plateau. |
| `extension/offscreen.html` et `extension/offscreen.js` | Document persistant du moteur et file d’analyses. |
| `extension/core/` | Protocole UCI, validation et sélection des suggestions. |
| `extension/engine/` et `extension/vendor/` | Stockfish local et règles chess.js. |
| `demo/` | Plateau d’essai jouable avec une FEN à jour. |
| `vendor-source/` | Sources exactes du moteur, réseau NNUE et instructions de compilation. |
| `scripts/` | Préparation, icônes, serveur de démo et archives de distribution. |
| `tests/` | Tests Node.js et vérification de navigateur. |

## Crédit et licence

**CarlsenChess — © 2026 Thomas Marsa.** Le code du projet est distribué sous [GPL-3.0-only](LICENSE).

Stockfish, Stockfish.js et chess.js conservent leurs auteurs, leurs droits d’auteur et leurs licences. Le crédit du projet ne transfère pas les droits sur ces composants. Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour les versions, licences et sources correspondantes.
