# Vérification Orivane mobile · intelligence-mobile3

Vérification effectuée le 15 octobre 2026, dans l'environnement de développement et sur les réponses des fournisseurs accessibles depuis le site public. Cette livraison n'a pas été publiée sur Vercel.

| Contrôle | Résultat et limite |
|---|---|
| Cœur analytique et régressions | 659 tests réussis, zéro échec |
| Mobile et reprise des workers | 156 tests réussis, zéro échec |
| Interface React | 47 tests réussis, zéro échec |
| TypeScript et compilation Vite | Réussis ; avertissement existant sur la taille du module de graphiques |
| Données Bitcoin réellement reçues | Le défaut de l'ancien moteur est reproduit : historique rejeté pour dates futures. Le normaliseur corrigé conserve les bougies passées et signale l'écart d'horloge. Aucun horodatage n'est déplacé. |
| Navigateur local, largeur 390 px | Bitcoin, EUR/USD, GBP/USD, or et Nasdaq consultés ; graphiques et 88 règles accessibles ; aucune erreur console observée ni débordement horizontal |
| Coupures historiques | Seule la dernière séquence continue alimente la nouvelle analyse multi-unité. Les anciens segments écartés sont comptés ; les bougies manquantes ne sont pas inventées. |
| Production publique | Ancien moteur encore présent ; /intelligence-release.json répond 404. La publication précédente a été refusée avec une erreur Vercel 403. |

## Périmètre réellement ajouté

88 règles : 66 du moteur existant, six recettes OHLCV et seize recettes basées sur les prix. Les huit derniers ajouts sont réintégration du canal médian/MAD, Balance of Power, RVI simplifié, croisement DI Wilder, comblement de gap observé, retest de déséquilibre trois bougies, Hikkake et divergence RSI avec pivots confirmés. Chaque recette de prix est testée sur une géométrie BUY et sa symétrie SELL. Un marché plat ne fabrique aucun signal.

L'analyse descriptive affiche EMA 9/21, ATR Wilder 14, canal des vingt bougies antérieures, position de la clôture et rang de l'amplitude sur les observations précédentes. Les regroupements UTC complets 1 h et 4 h sont testés sur des valeurs OHLC attendues indépendantes. Une unité ayant moins de 22 bougies reste indisponible.

Le bilan des stratégies distingue BUY, SELL, attente de conditions et blocage par les données. Les règles dupliquées ne gonflent pas le bilan. Les règles bloquées n'ajoutent aucune voix directionnelle. Les six configurations partielles affichées sont classées selon les conditions remplies ; ce classement ne prédit ni le prochain signal ni sa réussite. Les règles peuvent être corrélées.

## Limites observées

- Le Forex ne fournit pas de volume réel sur le flux utilisé : les règles qui en ont besoin restent bloquées. Les recettes de prix ne fabriquent pas ce volume.
- L'or et le Nasdaq présentent des coupures de séance. Selon l'heure et le nombre de bougies continues disponibles, certaines unités et certaines stratégies restent indisponibles. Leur affichage en attente ou bloqué est attendu.
- Les modèles publiés restent en observation : leur validation et leur rentabilité ne sont pas démontrées par ces tests de logiciel. Les seuils d'autorisation du paper trading restent inchangés.
- La vue mobile a été testée dans un navigateur à 390×844 ; aucun test sur un appareil iOS physique n'a été effectué. Le navigateur peut suspendre les calculs en arrière-plan.
- Le ZIP et les fichiers corrigés ne mettent pas à jour le site tant qu'un déploiement autorisé n'a pas abouti. Le PC peut être éteint après un déploiement réussi ; Internet et une page active restent nécessaires.

## Retrouver les preuves dans le projet complet

Tests : test/market-analysis.test.mjs, test/price-research.test.mjs, mobile-cloud/test/mobile-intelligence.test.mjs et terminal-ui/src/MarketAnalysis.test.ts. Les suites générales s'exécutent depuis les dossiers correspondants avec node --test test/*.test.mjs ; les tests d'interface utilisent Vitest. Les données synthétiques sont réservées aux tests et ne constituent pas des performances de marché.
