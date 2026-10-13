# Compact terminal and quote recovery

The desktop chart occupies the main workspace; the five original instruments form the adjacent watchlist. Mobile uses scrollable instrument rows, a compact signal status and fixed bottom navigation. No prices or percentages are generated for presentation.

Chart views 15m, 1h and 4h aggregate at most 320 actual received quarter-hour candles. The hour and four-hour buckets follow UTC boundaries. Missing sub-bars, duplicate timestamps, invalid OHLC and incomplete old buckets are rejected. Only the current real partial bucket is drawn as active. Missing volume remains null. Changing the chart view cannot change the 15-minute decision, stop or target.

BTC recovery prefers a fresh exchange-timestamped WebSocket quote. Once that quote is stale, a newer valid REST observation can update the displayed price. Invalid, crossed, future or older REST observations cannot replace it. REST is explicitly labeled snapshot and never becomes an executable streaming quote merely through this fallback. Existing model evidence, freshness, H1, prices, levels, fees and strict confidence-above-60 gates remain unchanged.

Historical audits still contain zero accepted engine entries. The cost sensitivity check does not authorize a new cost profile, lower the confidence threshold or establish a trading win rate.
