# Orivane — terminal et laboratoire, version 12

## Extension Intelligence locale

`npm run intelligence -- catalog` décrit les capacités ajoutées : six variantes de stratégies de recherche, régimes k-means, quatre modèles probabilistes comparés chronologiquement, ensemble adaptatif, dérive, incertitude conformale et risque de portefeuille. `npm run intelligence -- audit` examine les preuves déjà livrées. Les expériences restent en recherche et ne promeuvent aucun signal. Utilisation, contrats et limites : [research/INTELLIGENCE.md](research/INTELLIGENCE.md).

Terminal personnel de recherche et de paper trading. Les cinq marchés sont BTC/USD, EUR/USD, GBP/USD, XAU/USD et l’indice NDX. Le terminal ne transmet aucun ordre réel.

## Téléphone et ordinateur

Ouvrir [orivane-funded-mobile.vercel.app](https://orivane-funded-mobile.vercel.app/). Le téléphone calcule dans des Web Workers et charge les modèles compacts publiés : le PC peut être éteint. L’application ouverte reçoit automatiquement les cotations. iOS peut suspendre une page en arrière-plan ; le journal ne prétend pas observer les prix pendant cette interruption.

Pour une copie locale, installer Node.js 24, puis double-cliquer `LANCER.cmd` ou exécuter `npm start`. Le nouveau terminal écoute sur `http://127.0.0.1:4328`. La commande `npm run start:legacy` conserve l’ancien serveur uniquement comme référence de recherche. Les sources de la nouvelle interface sont dans `terminal-ui/` ; les fichiers prêts à servir dans `mobile-cloud/public/terminal-ui/`.

Navigation : **Terminal**, **Recherche**, **Journal**, **Données**. Motion respecte les animations réduites du système et peut être activé explicitement. Les bougies, prix et volumes manquants ne sont jamais interpolés. NDX reste un indice en snapshot, distinct d’un future, CFD ou ETF.

## Données et stockage privé

Le corpus officiel Kraken comprend 14 parties, **28 516 267 234 octets**. Chaque partie et la concaténation virtuelle sont vérifiées par SHA256. Les archives restent hors Git et Vercel, sans copie assemblée supplémentaire. La conversion lit par lots, préserve les horodatages à la nanoseconde et produit du Parquet par fournisseur, instrument et jour UTC. DuckDB interroge ces partitions.

Le laboratoire est dans `lab/` dans le dépôt, ou `../orivane-lab/` dans cette livraison locale. Suivre son `README.md` et `run-lab.ps1` pour bootstrap, téléchargement reprenable, normalisation, entraînement, API et vérification. Le stockage privé est `orivane-data/`, plafonné à 100 Go ; un dépassement arrête l’opération et conserve les sources. Aucun remplissage ni copie temporaire ne compte comme données nouvelles.

Kraken fournit trades, ticker et carnet L2 contrôlé par CRC32. Forex et gold sont des prix Deriv identifiés, avec cache expirant sous 24 heures. Ils ne sont pas assimilés aux cotations The5ers. MT5 est facultatif et en lecture seule. Twelve Data et Alpha Vantage restent secondaires, sous quota et sans clé inventée. Les mesures de délai incluent la différence entre les horloges ; elles ne prouvent pas une latence réseau synchronisée.

## Stratégies et confiance

Le registre versionné documente les 66 règles, leur famille, warm-up, conditions, paramètres, provenance et politique H1. Un routeur déterministe sélectionne un plan ; aucun vote ne combine les stratégies. Les règles restent en recherche tant que leur validation ne permet pas une publication paper. Événements, microstructure et relations entre marchés sont des familles de recherche réservées aux données compatibles.

La confiance officielle est `tp_before_sl_probability` : probabilité d’atteindre l’objectif avant le stop **dans 16 bougies de 15 minutes, soit 4 heures**. Les niveaux, coûts et expiration du plan sont figés et partagés entre labeling, replay et paper. Les cotations bid/ask sont utilisées lorsqu’elles existent ; les coûts hypothétiques sont identifiés. Une archive de trades seule ne fournit pas les bid/ask historiques.

Le contrat `next-closed-bar-boundary-v1` fixe l’expiration depuis la clôture de référence, avec une fenêtre d’entrée maximale de 60 secondes. Le journal distingue cette référence de l’heure de cotation réellement exécutée. Une entrée tardive reste HOLD avec « fenêtre d’entrée terminée » ; les plans déjà ouverts continuent leur suivi. Une bougie OHLC entière ne permet pas de labelliser une entrée physique retardée : le replay exige alors des ticks. Les anciens modèles sans ce contrat restent en observation.

Expiration sans TP = échec de cet événement, même avec une clôture profitable. Historique incomplet = censuré. Si un OHLC touche TP et SL dans la même bougie, le stop passe en premier et cette convention figure dans le rapport. Le paper traite les événements reçus dans leur ordre, sans attendre l’actualisation de l’écran.

**BUY/SELL exigent un pourcentage affiché strictement supérieur à 60 %.** 60,0 % reste HOLD. Le modèle directionnel historique à une heure est conservé comme contexte séparé ; il ne remplace jamais cette probabilité. Un modèle absent, incompatible, périmé ou non promu laisse les niveaux officiels indisponibles et affiche la raison du contrôle.

Le laboratoire compare une logistique et LightGBM, puis calibre sur une partition chronologique distincte. Développement, calibration et test sont purgés des labels chevauchants. Le test ne choisit pas les paramètres. Promotion paper : 200 observations OOS sans chevauchement, 40 de chaque résultat, 30 estimations >60 %, Brier meilleur que la référence et espérance nette sélectionnée positive avec borne bootstrap par blocs à 95 % positive. Les seuils sont une politique de publication. Les résultats d’observation restent consultables même si cette politique refuse la promotion.

## Journal, import et récupération

Journal et réglages sont locaux à chaque navigateur. Dans Journal ou Réglages : exporter une sauvegarde JSON avant de changer d’appareil, puis importer sur l’autre. L’import valide les niveaux, quantités, coûts, expiration, identifiants et calculs du résultat. Un journal invalide est bloqué sans écraser l’original ; une copie de récupération est conservée lorsque le stockage le permet. Aucun journal ni identifiant privé n’est envoyé dans le dépôt public.

## Publication et retour arrière

Les modèles compacts portent une version, la source, le registre, les caractéristiques, la calibration et le rapport de publication. `mobile-cloud/public/models/index.json` associe chaque modèle à son SHA256. Un modèle en observation peut être chargé pour ses diagnostics ; seul `publication.passed=true` autorise son usage paper, avec les autres contrôles d’entrée.

Rebâtir l’interface : `cd terminal-ui`, `npm ci`, `npm run build`. Exécuter les tests du cœur, du worker, du bridge, de l’interface et du laboratoire avant publication. Publier uniquement `mobile-cloud/` vers le projet Vercel existant. Le commit GitHub et l’identifiant de déploiement figurent dans le rapport de livraison. Pour revenir en arrière, promouvoir le déploiement précédent ou restaurer le manifeste de modèles antérieur, sans toucher aux sources privées.

Les licences, versions et décisions prendre/adapter/écarter sont documentées dans `research/SOURCES.md` et `lab/THIRD-PARTY-NOTICES.md`. Les environnements lourds, données brutes, bases, clés et journaux sont exclus du dépôt public.
