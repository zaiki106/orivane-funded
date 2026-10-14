# Références indépendantes Orivane

## Résultat réellement exécuté

Les classes officielles `SimpleMovingAverage(20)` et `StandardDeviation(20)` de **QuantConnect.Indicators 2.5.18164** ont été chargées et exécutées, sans modification, sur les **720 bougies BTC/USD réelles de Kraken** capturées du 6 au 13 octobre 2026 dans un fichier privé du projet. Ce corpus n'est pas publié dans GitHub.

Les 661 préfixes disposant du warm-up Orivane de 60 bougies concordent avec `indicators().mean` et `indicators().sd` :

| Mesure | Écart absolu maximal |
|---|---:|
| SMA 20 | 2,9103830456733704 × 10⁻¹¹ |
| Écart type population 20 | 2,8421709430404007 × 10⁻¹² |

Tolérance fixée : 10⁻⁷. Les valeurs exactes, dates, nombre d'observations et SHA256 du corpus figurent dans `comparison-real.json`. `lean-output.json` contient les 701 observations prêtes de l'oracle, avant la limite de warm-up Orivane.

Cette vérification porte sur deux indicateurs. Elle ne constitue pas un lancement complet du moteur de backtest LEAN, ni une validation du taux de réussite des stratégies. Aucune donnée synthétique et aucun ordre n'ont été utilisés.

## Environnement utilisé

- `dotnet --info` : runtime 8.0.6 présent, **aucun SDK installé** ; preuve enregistrée dans `dotnet-info.txt`.
- PowerShell 7.6.5 contient déjà le runtime **.NET 10.0.11**, compatible avec les assemblies NuGet `net10.0` retenues.
- Aucun SDK, runtime global, Docker ou compte cloud n'a été installé.
- Les assemblies officielles sont extraites dans le seul sous-dossier `runtime/`. Les packages nécessaires à ces deux indicateurs sont conservés dans `packages/`.
- Source LEAN figée : `ea3d5159152530d58f3afe2feced990a0bf64b96`, révision déclarée par les nuspec de la version officielle retenue.

## Reproduire

Dans ce dossier, avec PowerShell 7.6 et Node 24, fournir explicitement une capture privée réelle normalisée :

```powershell
node fetch-references.mjs
./run-lean.ps1 -InputFile ../orivane-data/experiments/BTC_USD-15m.json -Limit 720
node compare-lean.mjs --input ../orivane-data/experiments/BTC_USD-15m.json --limit 720
node finalize-report.mjs
```

Les scripts limitent le calcul aux 720 dernières bougies. Le fichier peut contenir un objet normalisé BTC/USD ou un tableau de captures ; la source doit être `Kraken public · spot`, en 15 minutes. Le comparateur refuse une source différente et échoue si une valeur manque ou si la tolérance est dépassée. Les classes LEAN calculent sur les observations reçues successivement ; le comparateur Orivane ne transmet que le préfixe disponible à chaque date.

Deux organisations sont prises en charge :

- Livraison locale : `outputs/orivane-reference-lab/` et cœur `outputs/orivane-funded/src/engine.mjs`.
- Dépôt GitHub : `reference-lab/` et cœur `src/engine.mjs`.

Le cœur est découvert dans cet ordre : `../src/engine.mjs`, puis `../orivane-funded/src/engine.mjs`. `--core` permet un chemin explicite. Les chemins fournis par options sont relatifs au dossier courant ; les valeurs par défaut sont relatives au script.

Pour une archive privée située ailleurs, choisir aussi les sorties privées :

```powershell
./run-lean.ps1 -InputFile C:/mes-donnees/BTC_USD-15m.json -OutputFile C:/mes-donnees/oracle-lean.json -Limit 720
node compare-lean.mjs --input C:/mes-donnees/BTC_USD-15m.json --oracle C:/mes-donnees/oracle-lean.json --output C:/mes-donnees/comparison.json --limit 720
```

Ne pas ajouter les prix source, `lean-output.json`, `runtime/` ou `packages/` au dépôt. La comparaison agrégée et les décisions de source peuvent être publiées. `node finalize-report.mjs --inventory-only` renouvelle les SHA des fichiers sans relancer l'oracle, modifier sa preuve ou télécharger de source.

## Sources et décisions

[LEAN](https://github.com/QuantConnect/Lean) est retenu comme oracle indépendant. Les classes sources et la [licence Apache 2.0](https://github.com/QuantConnect/Lean/blob/ea3d5159152530d58f3afe2feced990a0bf64b96/LICENSE) restent intactes dans `sources/lean/`. Les packages sont téléchargés depuis le registre NuGet officiel ; URL, taille et SHA256 sont enregistrés dans `manifest.json`.

[Freqtrade 2026.9](https://github.com/freqtrade/freqtrade/tree/1f394eaebc2f46a83d26971388628707802f8602) reste un **laboratoire de référence isolé** : licence GPLv3 conservée, interface de stratégie et documentation d'analyse du biais futur inspectées. Sa méthode de comparaison entre backtests complets et tronqués fournit une référence pour les tests causaux. Aucun code GPL n'est importé dans le cœur portable Orivane ; le bot Freqtrade n'a pas été exécuté.

`source-decisions.json` décrit les fonctions, données requises, limites, droits, essais et décisions. `artifact-checksums.json` inventorie les fichiers de ce laboratoire. Le budget est limité à **200 Mio**, sans remplissage ; le corpus original n'est pas dupliqué.
