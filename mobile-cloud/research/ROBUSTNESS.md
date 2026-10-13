# Historical robustness laboratory

66 deterministic rules are evaluated on three expanding chronological train periods. The five contenders per period are frozen by earlier net expectancy before their following period is tested. Candidate comparisons are diagnostics, not votes or live selection. A minimum of 20 earlier trades and positive earlier expectancy is required by the existing walk-forward selector.

The selected rules' following-period net R outcomes feed stationary bootstrap paths. 800 paths each retain the observed trade count, use a fixed 0.5% fraction of current equity per trade, and reset blocks with probability 1 / meanBlock. Means 1, 3 and 8 test sensitivity to serial dependence. Return, peak-relative percentage drawdown and consecutive losses use P5 / P50 / P95 interpolated quantiles. Zero-return trades interrupt a negative-trade streak. Equity floors at zero; paths are not replenished after ruin.

At least 20 out-of-sample trades are required. These resampled outcomes do not estimate challenge pass odds or future win probability. They do not change live confidence, stops, costs or BUY/SELL gates. Published paths use net trade results so fees are not charged a second time. Original test-only artificial data stays outside deployment.

Stationary sampling follows the pinned upstream source and conditions in ARCH_UPSTREAM.json / ARCH_LICENSE.md. JavaScript has no external runtime dependencies.
