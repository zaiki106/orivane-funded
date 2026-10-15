# Orivane Intelligence — stratégies, IA et risque

Cette extension ajoute des capacités exécutables au projet existant. Elle ne crée pas de site, ne télécharge pas de gros corpus et n'installe aucune bibliothèque supplémentaire. Le code s'exécute avec Node.js 24.

## Capacités livrées

| Composant | Fonction réelle | Point d'entrée |
|---|---|---|
| Stratégies | Six variantes de recherche : Donchian 55, reprise Keltner 20, libération de compression Bollinger, fausse cassure 20, contraction inside bar, momentum filtré par efficacité | `src/intelligence-strategies.mjs` |
| Régimes | K-means déterministe sur variables standardisées uniquement sur le développement ; inférence sans réajustement | `src/intelligence-ai.mjs` |
| Apprentissage | Trois logistiques régularisées et un modèle de résultats par stratégie/régime avec rétrécissement vers la fréquence d'entraînement | `src/intelligence-learning.mjs` |
| Ensemble | Pondération inverse du Brier historique avec décroissance temporelle ; résultats strictement antérieurs à la date de décision | `adaptiveEnsemble` |
| Dérive | PSI par variable, bornes apprises sur la référence et compartiments pour les valeurs hors plage | `distributionDrift` |
| Incertitude | Ensembles de prédiction binaires avec quantile conformal fini sur une partition distincte | `calibratePredictionSets`, `predictionSet` |
| Portefeuille | Risque brut aux stops, limites globales/par symbole, corrélations synchronisées, scénarios de pertes et Expected Shortfall historique 95 % | `src/intelligence-risk.mjs` |
| Allocation | Inverse volatilité, poids plafonnés, refus des concentrations et budget restant explicite | `allocateResearchRisk` |
| Expériences | Labels et frais du cœur existant, séparation chronologique, comparaison des modèles, propositions d'investigation, artefacts SHA256 immuables | `src/intelligence-research.mjs`, `src/intelligence-cli.mjs` |
| Traitements parallèles | Jusqu'à quatre workers Node isolés, délai maximal par traitement, erreurs isolées et résultats dans l'ordre des entrées | `src/intelligence-jobs.mjs` |

Les six recettes sont des variantes de familles déjà présentes dans le projet. Leur ajout ne prouve ni innovation, ni diversification, ni rentabilité. Les 66 stratégies du routeur et les 72 règles du rapport historique conservent leur identité. Aucun résultat historique des anciennes règles n'est attribué aux variantes.

## Utilisation immédiate

Depuis la racine du dépôt :

Si `npm` n'est pas disponible, remplacer `npm run intelligence --` par `node src/intelligence-cli.mjs`. Le lanceur Windows `LANCER-INTELLIGENCE.cmd` affiche le catalogue par défaut et accepte les mêmes arguments.

```powershell
npm run intelligence -- catalog
npm run intelligence -- audit
npm run intelligence -- audit --output orivane-data/intelligence/audits
```

`audit` vérifie les SHA256 du rapport livré et des modèles référencés. Il distingue résultats négatifs, preuves absentes et modèles non promus. Cette commande fonctionne avec les fichiers déjà présents ; elle n'entraîne rien et ne fabrique pas d'historique.

Lancer une expérience sur un historique réellement disponible :

```powershell
npm run intelligence -- research --input CHEMIN/HISTORIQUE.json --as-of 2026-10-15T00:00:00Z --output orivane-data/intelligence/experiments
```

Le JSON d'entrée doit contenir `symbol`, `source`, `timeframe: 15` et `bars` avec `time`, `open`, `high`, `low`, `close`, `volume`. Instruments acceptés : BTC/USD, EUR/USD, GBP/USD, XAU/USD, NDX, sans substitution de fournisseur ou de contrat. Limites explicites : 32 Mo par fichier et 20 000 bougies par jeu. Les données incomplètes restent incomplètes. Les stratégies exigent ici un volume positif identifié ; l'absence de volume rend le contexte indisponible plutôt que de créer des valeurs.

Pour tester le risque indépendamment du moteur :

```powershell
npm run intelligence -- risk --input CHEMIN/PORTEFEUILLE.json --output orivane-data/intelligence/risk
```

Structure de ce fichier : `equity`, `positions`, `returns` et éventuellement `candidates`, `settings`, `allocationSettings`. Une position contient `id`, `symbol`, `side`, `entry`, `stop`, `quantity` et éventuellement `contractMultiplier`. `returns` associe chaque symbole à une série chronologique `{timeMs,value}` de rendements périodiques en fractions. L'alignement repose sur les mêmes horodatages et unités ; des séries manquantes ne prouvent pas une diversification.

Diagnostics d'IA séparés :

```powershell
npm run intelligence -- diagnose --input CHEMIN/DIAGNOSTICS.json --as-of 2026-10-15T00:00:00Z
```

Entrée : matrices numériques `reference` et `current`, lignes `calibration` contenant `probability`, `y`, `timeMs`, éventuellement `features`, `probability` et `history` de modèles contenant `model`, `probability`, `y`, `labelEndTimeMs`. Les résultats de calibration doivent être strictement antérieurs à `--as-of`. Les résultats futurs sont exclus de la pondération adaptative.

Les artefacts sont identifiés par leur contenu et incluent l'empreinte du code, la configuration et le rapport. Répéter exactement une expérience retrouve le même fichier ; un fichier existant altéré bloque l'écriture. Les chemins temporaires ne remplacent jamais une preuve existante.

Plusieurs expériences indépendantes peuvent s'exécuter en parallèle :

```powershell
npm run intelligence -- batch --input CHEMIN/LOT.json --workers 2 --as-of 2026-10-15T00:00:00Z --output orivane-data/intelligence/batches
```

`LOT.json` contient `{ "datasets": [...] }`. Maximum huit jeux, 50 000 bougies cumulées et quatre workers. Chaque worker est arrêté avant de libérer sa place ; son délai inclut le démarrage. Une entrée invalide n'efface pas les résultats des autres. Le processus CLI retourne le code 2 si au moins un travail échoue. Un travail terminé peut produire un rapport `insufficient` : terminer le calcul ne valide pas le modèle.

## Méthode et limites

L'expérience réserve 50 % des bougies au développement, 20 % à la comparaison, 15 % à la calibration conformale et 15 % au test final. Les labels touchant les frontières sont purgés ; un embargo de quatre heures sépare les partitions. Les modèles, variables standardisées, régimes et poids sont figés avant le test. Le comparateur utilise uniquement la partition de sélection. Les stratégies restent évaluées séparément, sans chevauchement des trades pour une même règle ; des règles différentes peuvent partager un événement et ne sont pas des observations indépendantes.

Le signal est calculé sur les bougies clôturées avant l'entrée. L'entrée simulée utilise l'ouverture suivante, avec les niveaux figés et le contrat `next-closed-bar-boundary-v1` du cœur. Expiration : 16 bougies de 15 minutes ; le stop est prioritaire si une bougie touche les deux niveaux. Les coûts sont explicitement hypothétiques et partagés avec les labels. Les taux des modèles de recherche n'alimentent pas la confiance officielle.

Le Brier, la log loss et les courbes de fiabilité mesurent la qualité probabiliste. Le test d'un ensemble probabiliste ne constitue pas le backtest d'un portefeuille ni celui d'une politique de trading. Le taux de couverture conformale observé est un diagnostic : la dépendance temporelle et la dérive empêchent d'affirmer la garantie usuelle d'échangeabilité. Le PSI ne constitue ni un test statistique ni une cause démontrée.

Un stress des coûts ×1, ×1,5 et ×2 rejoue les configurations de base du test avec niveaux figés. Les plans devenus inexécutables sont comptés ; aucune nouvelle sélection n'est faite après leur retrait. Il s'agit du stress d'un ensemble de configurations figé, pas d'un reroutage ni d'un portefeuille reconstruit.

Le risque aux stops reste brut : deux positions opposées ne l'annulent pas. Les scénarios historiques utilisent des notionnels fixes, sans exécution des stops, frais, gaps ni capitalisation. Les poids proposés n'autorisent aucun ordre. Pour un seul symbole, le plafond individuel laisse volontairement une partie du budget inutilisée ; départager plusieurs variantes du même symbole par identifiant ne démontre pas leur supériorité.

Un rapport `insufficient` est un résultat attendu si les partitions manquent d'observations. Aucun entraînement réel n'est annoncé sans historique adéquat. Les tests synthétiques ne sont jamais présentés comme une preuve de performance. Toute modification motivée par le test final exige une nouvelle période réservée avant une future promotion.

## Intégration et vérification

Le serveur local existant expose deux routes GET en lecture seule : `/research/intelligence/catalog` et `/research/intelligence/audit`. Le calcul lourd est réservé à la ligne de commande et ne s'exécute pas à chaque actualisation du terminal. Aucune nouvelle interface web ni publication externe n'est requise.

```powershell
node --test test/intelligence-*.test.mjs
npm test
```

Sources méthodologiques : [k-means, documentation officielle scikit-learn](https://scikit-learn.org/stable/modules/clustering.html#k-means) ; [Angelopoulos et Bates, introduction à la prédiction conformale](https://arxiv.org/abs/2107.07511). Implémentations locales indépendantes, sans copie de code tiers.

### Vérifications exécutées le 15 octobre 2026

- Projet principal : 620 tests réussis, dont 78 tests ajoutés pour l'extension ; aucun test ignoré ou annulé.
- Version mobile : 139 tests réussis ; aucun test ignoré ou annulé.
- Routes HTTP du terminal, refus d'origine externe, CLI, empreintes des modèles livrés, expériences immuables, traitement parallèle et arrêt des workers vérifiés.
- Vérification réelle sur 712 bougies BTC/USD Kraken : 54 configurations évaluables, 11 lignes d'entraînement, 16 de sélection, 10 de calibration et 9 de test après purge. Résultat : `insufficient`, aucun modèle entraîné ou promu. Le dernier élément en formation est retiré ; huit autres observations postérieures à l'horloge locale sont écartées sans déplacer leurs horodatages.
- Le parcours complet avec entraînement de quatre modèles est vérifié sur des fixtures synthétiques explicitement marquées ; ses scores ne sont pas des résultats de marché.

Artefacts conservés : [audit des preuves livrées](intelligence-evidence/6bce392b2133d938d3395f69.json) et [vérification Kraken réelle](intelligence-evidence/8053cb367c859e52e601f1a9.json). Chacun contient les SHA256 de ses modules et sa configuration. Les données brutes et journaux privés ne sont pas publiés.

## Bibliothèque mobile · intelligence-mobile2

L'interface mobile expose 80 règles implémentées : les 66 règles du moteur, les six recettes OHLCV et huit nouvelles recettes de recherche utilisant uniquement les prix. Le rapport historique des 72 stratégies reste inchangé : il ne valide pas les huit ajouts. La commande de recherche supervisée conserve son périmètre des six recettes OHLCV ; les huit ajouts sont évalués dans `price-research.mjs` et intégrés aux diagnostics mobiles.

Les nouveaux calculs sont RSI Wilder 2, retournement Heikin Ashi, réintégration des pivots glissants S1/R1, Dual Thrust quatre bougies, expansion sur trois bougies, étoile trois bougies sans gap, reprise du rang percentile et épuisement sur neuf clôtures. Chaque règle a des critères BUY/SELL consultables et des niveaux ancrés sur la clôture (stop 1,5 ATR, objectif 2R). Ils ne reçoivent aucune probabilité de réussite ni autorisation d'ordre.

Le catalogue mobile conserve les règles en attente et distingue les données manquantes. Les règles exigeant du volume restent bloquées si ce volume est absent ; les huit recettes de prix ne fabriquent aucun volume. Les données futures, non clôturées, discontinues ou OHLC invalides n'autorisent aucun déclencheur.

Vérification du 15 octobre 2026 : 644 tests cœur, 156 tests mobile, 42 tests interface ; TypeScript et compilation Vite réussis. Les tests dédiés vérifient BUY et SELL sur des géométries synthétiques explicites, ainsi que l'absence de déclencheur sur un prix plat. Ces fixtures restent réservées aux tests. Vue locale 390×844 vérifiée : 80 règles, recherche Dual Thrust, critères et niveaux SELL sur les données du fournisseur reçues pendant l'essai, aucun débordement horizontal ni erreur console observée. La production Vercel n'a pas été mise à jour par cette livraison.

## Analyse approfondie · intelligence-mobile3

La bibliothèque mobile passe à 88 règles (66 moteur + 6 OHLCV + 16 prix). Les nouveaux calculs descriptifs sont dans `src/market-analysis.mjs` et le composant `MarketAnalysis.tsx`. Ils regroupent uniquement les blocs UTC complets et conservent la dernière séquence de prix continue quand une coupure ancienne est détectée. Cette décision sert l'analyse descriptive et ne détend pas les prérequis des signaux du moteur.

Le bilan déduplique les identifiants, isole les règles bloquées, expose les sens opposés et conserve les conditions manquantes pour au plus six configurations partielles. Aucun vote n'est converti en probabilité. Les unités insuffisantes restent explicites. `mobile-cloud/VERIFICATION-MOBILE.md` contient le résultat des vérifications et les limites de la production publique.
