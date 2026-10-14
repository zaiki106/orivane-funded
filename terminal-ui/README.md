# Orivane Terminal 2

Interface React / TypeScript du terminal personnel. Aucun jeu de données de démonstration n'est utilisé à l'exécution.

## Construire et tester

Avec Node 24 et npm :

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Le build publie uniquement `dist/assets` vers `../orivane-mobile-cloud/public/terminal-ui/assets` et remplace `../orivane-mobile-cloud/public/index.html`. L'ancien dossier d'assets générés est vérifié puis remplacé. Les sources des six anciens thèmes ne sont plus chargées.

```powershell
node scripts/preview.mjs
```

Le serveur de vérification écoute sur `127.0.0.1:4336`, sert les sources mobiles existantes et utilise les petites API publiques de production pour les données fournisseurs. Arrêter avec Ctrl+C.

## Contrats

- `/mobile-bridge.mjs?v=wallstreet12` expose `deviceApi` et `DeviceStateStream`.
- Les routes `/api/state`, `/api/model`, `/api/registry`, `/api/profile`, `/api/paper/open`, `/api/paper/close`, `/api/export` et `/api/import` sont traitées par le worker local du navigateur.
- BUY et SELL affichés exigent le contrat `tp_before_sl_probability`, un pourcentage strictement supérieur à 60, un flux actuel, une évaluation validée et un plan exécutable. L'ancien modèle directionnel reste distinct.
- Le journal et le profil restent sur l'appareil. L'import remplace les données privées après validation dans le moteur ; aucune clé privée n'est nécessaire dans le client.
- Les graphiques utilisent uniquement les OHLC reçus, avec agrégation visuelle indépendante du moteur 15m. Aucune interpolation de prix ni de bougies.
- Le carnet s'affiche uniquement lorsqu'un snapshot Kraken live a un checksum valide.
- La télémétrie décrit un écart d'horloges observé, avec P50/P95. Elle ne représente pas une garantie de latence réseau.

L'interface reste utilisable sans le service de recherche PC. Les sources brutes, expériences et entraînements lourds restent hors du déploiement mobile.
