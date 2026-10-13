# Verification and provenance

The live application uses real provider candles. Test fixtures in test/helpers are synthetic and are never served as live market data.

Run npm test with Node.js 24 to verify the browser core. Indicator oracle expectations were calculated independently with bukosabino/ta at the revision in UPSTREAM.json, using pandas 3.0.1 and numpy 2.3.5. The live site executes no Python.

66 fixed strategy rules; one selected classifier from six families and twelve variants; train/calibration/test are chronological with purged forward labels. Boosting split thresholds and leaves are learned on training only. The final test never selects model parameters. Class confidence means net market direction at one hour, not the probability of hitting a trade target before its stop.

Research cost stress holds strategy selection fixed on each past training partition and evaluates the next period at cost multipliers 1, 2 and 3. Historical replay uses the exact model cost contract. These diagnostics do not authorize real orders or promise profitability.

The site retains paper-only execution, confidence strictly above 60%, freshness, H1, source, spread-side stop and level checks. Missing volume disables volume-dependent rules.
