# Composants tiers

CarlsenChess — © 2026 Thomas Marsa. Le code propre au projet est distribué sous GPL-3.0-only. Les crédits ci-dessous s’ajoutent à ce crédit ; ils ne sont pas remplacés par lui.

## Stockfish.js 19.0.1 et Stockfish 19

- Paquet npm : `stockfish@19.0.1`.
- Variante livrée : `stockfish-19-single.js` et `stockfish-19-single.wasm`, moteur complet à un seul thread.
- Projet du portage : [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js).
- Moteur d’origine : [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish).
- Licence : GNU General Public License, version 3. La licence complète est fournie avec la distribution.

Le fichier JavaScript du moteur porte les mentions suivantes :

```text
Stockfish.js 19 (c) 2026, Chess.com, LLC
https://github.com/nmrugg/stockfish.js
License: GPLv3

Based on Stockfish (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and other contributors.
https://github.com/official-stockfish/Stockfish
```

Les fichiers du moteur sont distribués sans modification. Les sources correspondantes sont épinglées au tag `v19.0.1`, commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6` du portage Stockfish.js. Elles sont conservées dans `vendor-source/stockfish-19.0.1-source.tar.gz`. Le réseau neuronal `vendor-source/nn-1a298aa575a0.nnue` et les instructions `vendor-source/BUILD.md` accompagnent ces sources ; ces instructions indiquent la chaîne de compilation et la commande de reconstruction.

L’archive `CarlsenChess-v1.4.0-source.zip` contient les sources du projet, celles du moteur et ses fichiers nécessaires à la reconstruction. Lors d’une redistribution de l’archive installable, fournir aussi cette archive de sources et les licences, ou un accès équivalent aux sources correspondantes conformément à la GPL. Le paquet npm épinglé et `package-lock.json` identifient les binaires utilisés par le build. Le jeu automatique et les paliers de force de CarlsenChess 1.4.0 ne modifient ni ces fichiers du moteur ni la version Stockfish.js 19.0.1 embarquée.

## chess.js 1.4.0

- Paquet npm : `chess.js@1.4.0`.
- Projet : [jhlywa/chess.js](https://github.com/jhlywa/chess.js).
- Usage : validation de positions, génération et vérification des coups légaux et notation des coups.
- Licence : BSD 2-Clause.

```text
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## Outils de développement

Playwright et jsdom servent aux vérifications et ne sont pas embarqués dans l’extension. Leurs versions exactes et leurs dépendances sont consignées dans `package-lock.json`. Les licences originales restent présentes dans les paquets installés par `npm ci`.
