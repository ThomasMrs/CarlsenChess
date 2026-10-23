# Sources du moteur livré

Le moteur Stockfish.js 19.0.1 est livré sans modification. Sources exactes :
`stockfish-19.0.1-source.tar.gz`, tag `v19.0.1`, commit
`0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6` du dépôt
https://github.com/nmrugg/stockfish.js.

Le réseau original `nn-1a298aa575a0.nnue` est inclus dans ce dossier.
Son SHA-256 commence par `1a298aa575a0`. Il est intégré au WASM complet.
Les scripts et sources C++ se trouvent dans l’archive, avec leur licence GPLv3.

Pour recompiler, installer Node.js, GNU make, un compilateur C++ et Emscripten
**6.0.9**, puis activer son environnement. Extraire l’archive, placer le réseau
dans son dossier `src/`, puis depuis la racine extraite :

```sh
npm install
node build.js --single-threaded -f
```

Le script amont contient les paramètres de compilation, la génération des
réseaux intégrés et le post-traitement JavaScript. La commande reconstruit la
même variante complète mono-thread ; la reproductibilité binaire bit à bit
n’est pas garantie entre machines.

`SHA256SUMS` identifie les fichiers d’exécution que `npm run vendor` copie
depuis les paquets npm épinglés dans `package-lock.json`. Le code de CarlsenChess
et celui de chess.js sont livrés dans l’archive source de la version.
