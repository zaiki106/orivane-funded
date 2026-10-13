# Event-specific model selection

Each of the existing twelve trained classifier variants is evaluated on the calibration partition for UP and DOWN one-versus-rest Brier loss. Exactly one classifier is retained for each direction. There are no votes or averages. Its full three-class probability vector stays normalized.

Training weights, scalers, covariances, trees, neighbors and priors use training data only. Temperatures use calibration data. Optional class recalibration is accepted only if that direction's calibration Brier improves. Neither model selection nor recalibration can consult final-test prices or outcomes.

The routed BUY or SELL uses its corresponding classifier for both the displayed estimate and independent final-test publication assessment. A mismatched or missing enabled expert fails closed. Existing freshness, closed-candle, H1, level, cost and strict confidence-above-60 gates stay intact. This is a change in selection objective, not a trading-performance claim.
