# Orivane — laboratoire privé sur PC

Le laboratoire utilise Python 3.12 et un stockage privé plafonné à **100 Go**. Aucune carte bancaire n'est requise. Le terminal iPhone fonctionne sur Vercel avec des Web Workers et les modèles publiés ; le PC sert à la collecte lourde et à l'entraînement.

## Lancer

Ouvrir PowerShell dans ce dossier :

```powershell
./run-lab.ps1 -Mode bootstrap
./run-lab.ps1 -Mode download
./run-lab.ps1 -Mode normalize -Instrument BTC/USD -Since 2024-09-30
./run-lab.ps1 -Mode status
./run-lab.ps1 -Mode verify
./run-lab.ps1 -Mode api
```

`Telecharger-donnees.cmd` reprend les 14 parties officielles. `Lancer-laboratoire.cmd` ouvre l'API locale. Les bibliothèques sont installées dans `.venv` et `.qlib-venv`, jamais globalement.

Les archives Kraken sont conservées une seule fois dans `../orivane-data/raw/kraken` ; leur concaténation est virtuelle. Les SHA256 des 14 parties et de l'ensemble sont vérifiés avant lecture du ZIP. L'import inspecte le manifeste et la taille des membres, lit le CSV par blocs de 16 Mo, produit du Parquet par jour puis agrège les bougies avec DuckDB. Aucun grand CSV ou ZIP assemblé n'est recopié.

Le corpus brut, les bases, les modèles et les expériences restent dans `../orivane-data`, hors Git et hors Vercel. **Ne pas publier ce dossier.** Le plafond de 100 Go arrête une opération avant dépassement et conserve les sources. Un import interrompu peut reprendre ; les partitions terminées sont réutilisées après validation du flux source. Les trous restent des trous, sans bougies inventées.

## Entraînement

Exporter les configurations avec le cœur JavaScript partagé :

```powershell
node ../orivane-funded/src/export-trade-examples.mjs --input ../orivane-data/experiments/BTC_USD-15m.json --output ../orivane-data/experiments/BTC_USD-trades.json --strategies routed
./run-lab.ps1 -Mode train -InputFile ../orivane-data/experiments/BTC_USD-trades.json
```

La cible est **TP avant SL dans 16 bougies de 15 minutes**. L'expiration sans TP reste un échec de cet événement, même avec un PnL positif. Un horizon incomplet est censuré. Les niveaux et coûts proviennent du même cœur que le replay et le paper.

Le vecteur v2 comprend 116 variables : les 34 variables d’origine, leurs interactions avec le sens du trade, les cycles horaires UTC et l’identité des 66 stratégies. Les plans, labels et coûts restent inchangés. Les anciens modèles à 34 variables restent compatibles.

Cinq variantes fixes de logistique et LightGBM sont comparées sur une validation chronologique interne au développement, avec purge des labels et embargo de quatre heures. La variante choisie est réentraînée sur le développement complet. La calibration Platt utilise ensuite uniquement la partition de calibration ; celle-ci ne choisit plus le modèle. Les frontières du cœur sont reprises, avec purge des fins de labels et embargo de quatre heures. Le test final ne choisit pas le modèle et ses observations ne se chevauchent pas.

Un modèle insuffisamment validé reste en **observation**. Seuls les modèles ayant 200 observations OOS sans chevauchement, 40 de chaque résultat, 30 estimations affichées strictement supérieures à 60 %, un Brier meilleur que la référence et une borne bootstrap à 95 % positive de l'espérance nette passent dans `models/published-*.json`. Les fixtures ne sont jamais publiées. Les expériences, variantes et oracles Python/JavaScript sont conservés.

Le rapport d'audit fournit les déclenchements, TP, SL, expirations, labels censurés et résultats nets par stratégie effectivement choisie par le routeur. Ses taux historiques ne remplacent pas la probabilité calibrée. Les rejets globaux sont conservés, sans leur inventer une attribution par stratégie.

```powershell
./.venv/Scripts/python.exe -m orivane_lab.report --input ../orivane-data/experiments/BTC_USD-trades.json --model ../orivane-data/models/IDENTIFIANT.json
```

## Collecteur et replay du carnet

```powershell
./.venv/Scripts/python.exe -m orivane_lab.collector --seconds 120
./.venv/Scripts/python.exe -m orivane_lab.replay --live-capture
```

La collecte s'arrête après la durée demandée. `--seconds 0` active une collecte continue explicite ; Ctrl+C l'arrête. Les trades et le carnet L2 BTC/USD viennent du WebSocket public Kraken. Chaque carnet est vérifié avec le CRC32 officiel en préservant les décimales. Une erreur ou reconnexion produit un marqueur de trou et impose un nouveau snapshot.

Les événements conservent l'heure de réception, l'heure fournisseur, sa précision, le numéro local de réception et la session. Aucun numéro de séquence de marché n'étant fourni ici, le numéro local ne prouve pas l'absence de tout trade manquant. JSONL et Parquet sont partitionnés par jour UTC. Les quantiles de délai mesurent les deux horloges ; leur synchronisation n'est pas présumée vérifiée.

## Sources secondaires et MT5

```powershell
./.venv/Scripts/python.exe -m orivane_lab.providers twelve --symbol EUR/USD
./.venv/Scripts/python.exe -m orivane_lab.providers alpha --symbol EUR/USD
./.venv/Scripts/python.exe -m pip install -r requirements-mt5.txt
./.venv/Scripts/python.exe -m orivane_lab.providers mt5 --mt5-connect
```

Les clés sont lues uniquement dans `TWELVE_DATA_API_KEY` et `ALPHA_VANTAGE_API_KEY` de l'environnement et ne sont pas écrites dans les rapports. Le registre persistant plafonne les tentatives : 8 par minute / 800 par jour pour Twelve Data, 25 par jour pour Alpha Vantage. Une clé absente donne `not_configured`.

Twelve Data fournit un snapshot 15 minutes, sans promettre un streaming gratuit. Alpha Vantage sert à la vérification quotidienne EUR/USD et GBP/USD. Ces données ne deviennent pas des cotations exécutables et aucun proxy Nasdaq n'est choisi silencieusement.

Le connecteur MT5 facultatif lit un terminal déjà configuré. Il accepte `ORIVANE_MT5_TERMINAL_PATH` dans l'environnement. Aucun login, envoi d'ordre ou export d'identifiant de compte n'est effectué. Les contrats du broker sont distingués de l'indice NDX, les snapshots frais des snapshots périmés, les ticks du volume réel. Les données du broker restent privées.

## API et récupération

Adresse : `http://127.0.0.1:8765`, liée uniquement au loopback. Chaque requête requiert `Authorization: Bearer <token>` ; le token privé est dans `../orivane-data/registry/api-token.json`. Host non local et origine externe sont refusés. Aucun CORS permissif, SQL libre ou shell arbitraire n'est exposé.

- `GET /api/status`, `/api/datasets`, `/api/models`, `/api/experiments`, `/api/tasks`
- `POST /api/tasks` : `{"kind":"download|normalize|train","options":{...}}`

Un verrou du système d'exploitation empêche deux processus lourds d'écrire ensemble. Les tâches survivent au redémarrage sous forme de descripteurs ; une tâche interrompue doit être relancée. Les téléchargements reprennent au dernier octet reçu. Un checksum incorrect conserve le fichier et exige une investigation. Aucun nettoyage destructif n'est automatique.

L'API locale n'est pas un serveur cloud toujours actif. Le terminal iPhone reste indépendant lorsque le PC est éteint.

## Dépendances et preuves

NautilusTrader 1.231.0 rejoue les trades en ordre causal. L'archive ne contient pas les bid/ask historiques : son rapport l'indique sans prétendre connaître une exécution. hftbacktest 2.4.4 rejoue le L2 disponible avec latence et file d'attente explicitement supposées. TA-Lib 0.8.2 fournit une référence arithmétique indépendante.

Qlib 0.9.8 amont n'a pas de wheel PyPI disponible ici ; son build Windows demande MSVC. L'adaptation transparente **0.9.8+orivane.1** utilise le code Python de la révision `54355232463878d2eebb91fe0ee5fa7fa1f5976c` et les deux extensions Windows du wheel officiel 0.9.7, après vérification que tous leurs sources natifs sont strictement identiques. Provenance, SHA256, archives amont et licence MIT sont conservés. La construction est refusée si ce contrôle échoue. `.qlib-venv` isole son PyArrow <24 du PyArrow ≥25 requis par Nautilus.

```powershell
./.qlib-venv/Scripts/python.exe -m orivane_lab.qlib_factors --input ../orivane-data/experiments/BTC_USD-15m.json
./run-lab.ps1 -Mode test
```

Licences et versions figurent dans `THIRD-PARTY-NOTICES.md`, `dependency-manifest.json` et les lockfiles. Les sources du laboratoire peuvent être publiées ; les deux venv et `orivane-data` sont exclus du déploiement.

## Reprendre un export causal existant

```powershell
node ../orivane-funded/src/upgrade-trade-features.mjs ../orivane-data/experiments/BTC_USD-trades.json ../orivane-data/experiments/BTC_USD-trades-v2.json
./run-lab.ps1 -Mode train -InputFile ../orivane-data/experiments/BTC_USD-trades-v2.json
```

La migration utilise uniquement les variables originales, la stratégie et l’heure d’entrée connues à la clôture. Elle conserve les labels et partitions, écrit un nouveau fichier et enregistre le SHA256 parent. Les scores sur une période déjà évaluée sont des résultats de réévaluation historique ; ils ne constituent pas une nouvelle période indépendante.
