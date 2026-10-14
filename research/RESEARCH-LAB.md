# Laboratoire indépendant — 72 règles, octobre 2026

Cette livraison ajoute six recettes de recherche aux 66 stratégies existantes, leur évaluation indépendante, trois fenêtres chronologiques, trois hypothèses de coûts et une recherche exhaustive reproductible avec Optuna. Elle ne publie aucun nouveau signal de trading.

## Composants GitHub examinés

| Source officielle | Version / licence | Décision et essai |
|---|---|---|
| [Optuna](https://github.com/optuna/optuna/tree/v4.5.0) | 4.5.0, MIT ; commit `d7e1c1b306b995aa53719ed6ab18e871ae0d52a5` | **Intégré** comme dépendance PC isolée ; GridSampler déterministe, 432 essais effectivement exécutés et consignés dans SQLite et JSON. Version conservatrice compatible avec le laboratoire existant. Licence conservée dans `OPTUNA-LICENSE.txt`. |
| [Documentation GridSampler](https://optuna.readthedocs.io/en/v4.5.0/reference/samplers/generated/optuna.samplers.GridSampler.html) | Documentation de la version figée | **Adaptée** à une grille stratégie/H1 et une sélection sur le rendement net minimal des trois coûts, exclusivement dans les fenêtres d’entraînement. Aucun exemple de bot recopié. |
| [VectorBT](https://github.com/polakowo/vectorbt/blob/master/LICENSE.md) | Apache 2.0 avec Commons Clause, branche consultée le 14 octobre 2026 | **Non intégré** : moteur supplémentaire non nécessaire pour cette tranche ; ne pas le présenter comme une licence Apache simple. Aucun code téléchargé ni exécuté. |
| [MlFinLab](https://hudsonthames.org/mlfinlab/) | Offre commerciale annoncée par l’auteur | **Non intégré** dans le budget 0 €. Aucun ancien script sans droits vérifiés réutilisé. |
| [Backtrader](https://github.com/mementum/backtrader) | GPLv3 ; documentation officielle consultée | **Non intégré** : le laboratoire dispose déjà de Nautilus et du replay portable. Aucune copie d’un bot non audité. |
| [TA-Lib](https://github.com/TA-Lib/ta-lib) | Dépendance de référence déjà isolée | Les formules EMA et RSI sont réimplémentées dans le module portable ; aucune bougie ou confiance générée. Les nouvelles recettes sont des assemblages originaux explicitement décrits ci-dessous. |

## Six recettes nouvelles, toutes en recherche

| Recette | Déclencheur BUY / SELL | Stop / objectif |
|---|---|---|
| RSI 2 · tendance longue | RSI Wilder 2 franchit 10 vers le haut / 90 vers le bas, clôture du bon côté d’EMA 200 et corps du même sens | 1,4 ATR / 1 R |
| EMA 200 · engulfing | Engulfing strict du corps précédent, EMA 200 inclinée et clôture du même côté | 1,4 ATR / 1,5 R |
| Expansion ATR · canal 20 | Corps >1,5 ATR, première clôture au-delà du canal des 20 bougies précédentes, alignée avec EMA 50 | 1,4 ATR / 1,5 R |
| Range UTC 00–07 | 28 bougies complètes de 00:00 à 06:45 UTC ; premier franchissement clôturé entre 07:00 et 10:00 UTC | 1,4 ATR / 1,5 R |
| VWAP quotidien · réintégration | Prix précédent à plus de 2 ATR du VWAP UTC ; retour à moins de 1,5 ATR avec corps directionnel | 1,4 ATR / 1 R |
| Régression 40 · réintégration | Résidu précédent au-delà de ±2 écarts-types ; retour sous ±1,5, pente absolue <0,1 ATR par bougie | 1,4 ATR / 1 R |

Le prix d’entrée de référence est la clôture du setup. L’exécution testée reste l’ouverture suivante dans le contrat de clôture existant, sans déplacer stop et objectif. Expiration : 16 bougies de 15 minutes. Les six recettes demandent 220 bougies continues, avec contexte borné à 240 ; VWAP exige du volume réel. La session est explicitement UTC, sans l’assimiler à une ouverture locale soumise au changement d’heure. Ces recettes sont des variantes de recherche, pas six méthodes prétendument inédites ou garanties meilleures.

Les deux sens et l’ordre des niveaux sont testés. EMA 200 est vérifiée sur une série linéaire à solution analytique ; RSI 2 vaut 100 sur une série strictement croissante. Les bougies en formation et les trous sont exclus. Un changement dans la moitié finale des prix laisse les événements de développement strictement identiques.

## Recherche et stockage

L’export balaie uniquement la première moitié du corpus BTC original : 35 059 bougies au maximum, contexte et échauffement inclus. Il produit **248 140 évaluations** (trois coûts inclus), soit **53 246 975 octets**, dans un NDJSON privé. Ce nombre n’est pas un nombre de trades simultanés ni de signaux publiés. Le fichier est haché, puis normalisé en Parquet avec DuckDB. Les prix bruts, événements détaillés et études SQLite restent hors du site et de GitHub.

L’export plafonne sa sortie à 1 Go et conserve un fichier partiel en cas d’interruption. Le lanceur Python réserve 1,1 Go sous le budget privé de 100 Go, utilise le verrou partagé des tâches lourdes et refuse d’écraser un export existant. Les archives sources ne sont jamais supprimées. L’analyse se reprend avec `--events` ; les essais Optuna terminés sont réutilisés et ne sont pas recomp­tés comme nouveaux essais.

```powershell
# Depuis le laboratoire PC : nouvelle collecte d’événements + analyse
./run-lab.ps1 -Mode research -InputFile ../orivane-data/experiments/BTC_USD-15m.json

# Réanalyser un export existant sans le recopier
./run-lab.ps1 -Mode research -InputFile ../orivane-data/experiments/BTC_USD-independent-events.ndjson
```

## Méthode et résultats

Chaque règle est testée indépendamment avec H1 aligné si disponible puis H1 en contexte seul, soit **144 variantes**. Trois fenêtres croissantes d’entraînement/évaluation utilisent une purge des fins de labels et un embargo de quatre heures. La calibration et le test final réservés du modèle ne sont pas utilisés par cette recherche.

Les frais et le glissement sont multipliés par 1, 1,5 et 2. Entrée et résultat sont recalculés avec ces coûts, les mêmes niveaux et les conventions conservatrices du cœur. Certains plans deviennent inexécutables avec des coûts supérieurs : comparer les effectifs, pas seulement les pourcentages. Les coûts BTC The5ers restent des hypothèses déclarées, pas des tarifs vérifiés du compte.

L’incertitude est évaluée par bootstrap circulaire de blocs de huit trades, avec 4 999 répétitions. Les p-values de moyenne nette sont corrigées par Holm sur les 144 variantes. Ce sont des diagnostics historiques, distincts de la confiance TP avant SL. Les variantes n’ayant pas 30 observations n’ont pas d’intervalle exploitable.

Rapport reproductible : `6376df8c8dfe30a3`. Source Kraken spot, 2 octobre 2024 → 30 septembre 2025. Aucun des 72 profils H1 alignés ne montre une espérance nette positive aux coûts de base sur ces fenêtres ; aucune variante ne passe le test corrigé de Holm. Les meilleurs candidats d’entraînement des trois fenêtres ont eux-mêmes une espérance négative : le sélecteur ne les autorise pas comme stratégies actives. Ces résultats empêchent de transformer une comparaison de recherche en BUY/SELL trompeur.

Les modèles actifs de production, le routeur des 66 règles et le seuil strictement supérieur à 60 % restent soumis à leur validation existante. Le nouveau tableau du site est informatif ; aucune de ses commandes ne place d’ordre. Le modèle BTC v2 reste en observation.

## Préparer une nouvelle publication locale

Depuis le dossier `lab`, la commande suivante copie uniquement le rapport agrégé dans le site et met à jour son SHA256 dans `platform.json` :

```powershell
./.venv/Scripts/python.exe -m orivane_lab.publish_research --report ../orivane-data/experiments/strategy-lab-6376df8c8dfe30a3.json --public ../mobile-cloud/public
```

Dans l’arborescence de travail initiale où le dossier est nommé `orivane-mobile-cloud`, utiliser `--public ../orivane-mobile-cloud/public`. Le script refuse les événements bruts, les champs privés et les fixtures synthétiques. Il ne déploie rien et ne modifie aucun modèle. Publier ensuite les fichiers vérifiés avec le circuit GitHub/Vercel existant ; le déploiement Vercel contient seulement le site, les petites API, modèles et rapports agrégés. Le journal reste sur l’appareil.

## Vérification indépendante des agrégats

Le programme `src/verify-strategy-lab.mjs` relit les événements en streaming, vérifie les SHA256, reconstruit les 432 profils stratégie/H1/coûts et compare leurs effectifs, TP, SL, expirations, rendements moyens, profit factors et drawdowns au rapport Python. La vérification a réussi sur les 248 140 événements réels. Il ne charge pas de modèle et ne produit aucun signal.

```powershell
node src/verify-strategy-lab.mjs orivane-data/experiments/BTC_USD-independent-events.ndjson orivane-data/experiments/strategy-lab-6376df8c8dfe30a3.json
```
