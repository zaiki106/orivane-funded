# Correction du modèle — 14 octobre 2026

Le défaut signalé par l’utilisateur est l’absence de BUY/SELL valides. Cette livraison améliore l’entraînement ; elle ne résout pas encore ce résultat produit.

## Changements vérifiables

- 116 variables causales au lieu de 34 : identité des 66 stratégies, interactions avec le sens du trade et cycles UTC connus à l’entrée. Aucun résultat futur parmi les variables.
- Cinq variantes fixées avant évaluation. Sélection Brier sur la dernière partie du développement, avec purge des labels, embargo de quatre heures et observations sans chevauchement. Puis réentraînement de la variante choisie sur le développement complet et calibration séparée.
- Les anciens modèles restent compatibles ; aucun changement des niveaux, coûts, expirations, règles du routeur ou seuil strict de 60 %.
- Les exports déjà évalués sont marqués comme réévaluation historique. Ils ne peuvent pas promouvoir un modèle, même avec des métriques favorables ; une nouvelle période réservée est nécessaire.

La séparation des données suit le principe décrit dans la [documentation de calibration scikit-learn](https://scikit-learn.org/stable/modules/calibration.html). Le choix du modèle ne mesure plus sa performance sur les données qui viennent d’ajuster sa calibration.

## Résultat réel BTC

Source : Kraken public spot. 70 119 bougies, 28 609 configurations détectées ; 1 561 configurations de test historique sans chevauchement. Aucun prix synthétique ajouté.

| Mesure sur la même période historique | Modèle précédent | Modèle v2 |
|---|---:|---:|
| Brier (plus bas préférable) | 0,1869995474 | 0,1844170696 |
| Brier de référence | 0,1969644543 | 0,1969644543 |
| Probabilité maximale estimée | 47,1411 % | 56,7402 % |
| Estimations affichées > 60 % | 0 | 0 |
| Autorisation paper | Non | Non |

Les 56,7402 % sont une estimation maximale, pas un taux de réussite observé. Les huit observations entre 50 et 60 % ont réalisé quatre TP. Sur tout le test : 421 TP, 757 SL, 383 expirations ; l’espérance de tous les plans vaut −0,4371 R. Ces plans ne sont pas autorisés par le modèle.

Modèle : `81742cb69251ce1d`, LightGBM shallow (120 arbres). Coûts BTC conservés à leurs hypothèses déclarées ; ils ne sont pas présentés comme des coûts vérifiés du compte The5ers. Les résultats réutilisent une période déjà consultée et ne constituent pas une validation indépendante nouvelle.

Le problème restant est l’absence d’un avantage de stratégie validé au seuil demandé, ainsi que l’historique encore trop court des modèles forex et l’absence de modèle gold. Ajouter des variables ou forcer les pourcentages n’établit pas cet avantage. La prochaine publication paper exige des résultats réels sur une période réservée, avec les mêmes barrières, coûts et conditions de déploiement.

## Vérifications de cette livraison

533 tests du moteur, 129 tests du portable, 20 tests Python. Les nouveaux tests vérifient l’identité de stratégie, les variables connues à l’entrée, la conservation des plans et labels, la compatibilité des anciens modèles et le refus de promotion d’un modèle de recherche. Parité Python/JavaScript : 50 prédictions réelles, erreur maximale de probabilité 1,12 × 10⁻¹⁶.
