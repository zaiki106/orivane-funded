# Composants tiers

Les bibliothèques sont installées séparément, hors déploiement mobile. Les versions transitives figurent dans les lockfiles et `dependency-manifest.json` ; les licences originales restent dans les distributions installées.

| Composant | Version | Licence et source | Usage |
|---|---|---|---|
| NautilusTrader | 1.231.0 | LGPL-3.0, https://github.com/nautechsystems/nautilus_trader | Replay ; aucune modification amont |
| DuckDB | 1.5.6 | MIT, https://github.com/duckdb/duckdb | Requêtes Parquet |
| PyArrow | 26.0.0 cœur / 23.0.1 Qlib | Apache-2.0, https://github.com/apache/arrow | CSV par blocs et Parquet |
| NumPy | 2.2.6 | BSD-3-Clause, https://github.com/numpy/numpy | Calcul |
| pandas | 2.3.3 | BSD-3-Clause, https://github.com/pandas-dev/pandas | Facteurs |
| scikit-learn | 1.7.2 | BSD-3-Clause, https://github.com/scikit-learn/scikit-learn | Logistique et calibration |
| LightGBM | 4.7.0 | MIT, https://github.com/microsoft/LightGBM | Arbres |
| TA-Lib wrapper | 0.8.2 | BSD-2-Clause, https://github.com/TA-Lib/ta-lib-python | Référence indépendante |
| hftbacktest | 2.4.4 | MIT, https://github.com/nkaz001/hftbacktest | Carnet, latence et files |
| Qlib | 0.9.8+orivane.1 adaptée | MIT, https://github.com/microsoft/qlib/tree/54355232463878d2eebb91fe0ee5fa7fa1f5976c | Facteurs ; provenance conservée |
| websockets | 17.2 | BSD-3-Clause, https://github.com/python-websockets/websockets | Collecteur Kraken |
| MetaTrader5 | 5.0.6231 facultatif | Distribution MetaQuotes, https://www.mql5.com/en/docs/python_metatrader5 | Lecture du terminal |

Les archives Kraken sont des données de marché selon les conditions Kraken, pas du code sous MIT. Usage privé, source : https://support.kraken.com/articles/360047543791-downloadable-historical-market-data-time-and-sales- . Aucun historique brut n'est republié.
