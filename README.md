# Orivane Funded Desk

Terminal local à interface noire et motion design : lumière d’ambiance mobile, transitions de cartes, sélection glissante, réactions au toucher et panneau de signal dédié sur ordinateur. Navigation flottante sur mobile. Cinq marchés, un graphique, un signal BUY / SELL / HOLD, une confiance estimée, des idées conditionnelles et des titres d’actualité sourcés. Les explications restent dans « Méthode ».

Le bouton **Motion** active ou réduit les effets et mémorise le choix dans ce navigateur. Sans choix explicite, la préférence système d’animations réduites est respectée ; une activation manuelle permet de les afficher. Les effets s’arrêtent lorsque la page est masquée. Les transitions utilisent [Web Animations](https://www.w3.org/TR/web-animations-1/) et CSS. Les prix ne sont jamais interpolés : seul le texte d’une nouvelle cotation réellement affichée peut recevoir un bref éclat. Le graphique dévoile les bougies fournies au changement de marché, sans générer de chandeliers décoratifs.

## Ouvrir

Double-cliquer **LANCER.cmd**, puis ouvrir http://127.0.0.1:4328. Node.js 24 minimum. Le serveur écoute uniquement sur cette machine et doit rester actif.

## Les cinq marchés

| Marché | Données |
| --- | --- |
| Bitcoin · BTC/USD | Kraken public : transactions et OHLC WebSocket |
| EUR/USD | Deriv public : cotations forex et OHLC WebSocket |
| GBP/USD | Deriv public : cotations forex et OHLC WebSocket |
| Gold · XAU/USD | Deriv public : cotations du courtier et OHLC WebSocket |
| Nasdaq-100 · NDX | Yahoo Finance : véritable indice `^NDX`, snapshots HTTP automatiques ; endpoint public non officiel, délai non garanti |

Aucun indice synthétique Deriv ni ETF QQQ ne remplace NDX. Les prix restent propres à leur fournisseur ; ils ne représentent pas automatiquement ceux du broker d’une firme funded. Les historiques, snapshots et flux directs ont des statuts distincts.

Chaque bougie Nasdaq doit tenir entièrement dans une séance régulière fournie par Yahoo. Le résumé ponctuel à l’heure de clôture est conservé comme cotation, jamais comme nouvelle bougie de 15 minutes. Les snapshots validés remplacent l’historique Nasdaq du cache pour éliminer les anciennes barres hors séance.

L’état arrive automatiquement dans le navigateur chaque seconde. Le cours et la bougie ouverte changent uniquement lors d’un événement fournisseur. Aucun prix ni volume manquant n’est interpolé. Les volumes consolidés forex/or sont indisponibles.

## Signal et confiance

La règle cassure–retest exige un canal de vingt bougies terminé avant la cassure, une clôture hors canal, un retest qui tient le niveau, puis une clôture de confirmation. Son stop couvre les trois bougies. Les trous de données et les bougies ouvertes bloquent la confirmation.

Les diagnostics du test figé affichent trois périodes chronologiques et un échantillon aux horizons sans chevauchement, comparés à la fréquence des classes de l'entraînement. Ils ne sélectionnent pas le modèle. Les horizons retirés ne garantissent pas l'indépendance statistique. La LDA suit la formulation à covariance partagée décrite dans la [documentation de référence](https://scikit-learn.org/stable/modules/lda_qda.html).


Un routeur choisit **une règle** selon le régime du marché, parmi quarante-deux règles déterministes : pullback, breakout, Bollinger, EMA crossover, MACD, RSI recovery, squeeze, VWAP, Supertrend, stochastique, inside bar, balayage du canal, continuation, Keltner, continuation ADX, Ichimoku, reprise CCI, Aroon, Donchian 55, impulsion ROC, Parabolic SAR, Williams %R, Fisher, TRIX, TSI, DEMA, Chandelier, Vortex, KAMA, PPO, Ultimate Oscillator, SMI, Stoch RSI, Elder Ray, DeMarker et Awesome Oscillator. Chaque règle peut produire BUY ou SELL et participe au même routeur et au laboratoire. L’entrée utilise les bougies clôturées et un filtre H1 constitué d’heures complètes. Aucun vote de stratégies. La bougie ouverte reste informative. La VWAP exige des volumes fournis ; aucun volume forex/or n’est inventé.

ADX utilise le lissage de Wilder ; le nuage Ichimoku tient compte de son décalage de 26 périodes, sans lire le futur. Donchian exclut la bougie analysée du canal. CCI, Aroon et ROC conservent leurs conditions propres ; les règles dépendant d’une amplitude future n’inventent pas de prix de déclenchement exact.

Le laboratoire et la production évaluent les règles avec la même fenêtre maximale de 160 bougies. Le laboratoire simule l’entrée à l’ouverture suivante avec coûts, sans utiliser les bougies futures pour calculer le signal.

La confiance estime la probabilité d’une **direction nette à une heure**, distincte du win rate : UP pour BUY, DOWN pour SELL, FLAT pour HOLD. Cette heure part de la dernière clôture analysée ; la méthode affiche ses heures de début et de fin. Le seuil de neutralité combine 0,35 ATR et des coûts aller-retour hypothétiques. Ce pourcentage ne mesure pas la réussite d’un trade à son stop ou objectif.

**BUY et SELL exigent une confiance publiée strictement supérieure à 60 %.** Le filtre compare le pourcentage arrondi au dixième affiché dans le terminal : 60,0 % reste HOLD, 60,1 % peut passer si les critères techniques, la fraîcheur et le filtre H1 sont aussi satisfaits. Une probabilité absente bloque également l’entrée paper. Les probabilités du modèle ne sont pas modifiées. Pour un HOLD filtré, le pourcentage principal reste celui de FLAT et la raison indique la probabilité du candidat BUY/SELL refusé. Les idées non confirmées sont nommées scénarios ; les critères bruts du catalogue ne constituent pas des signaux autorisés. L’historique visible liste les observations effectuées sous ce filtre avec leur pourcentage ; les anciens enregistrements restent conservés.

L’IA locale compare **cinq architectures et onze variantes** : une régression logistique, trois modèles de voisins historiques pondérés (kNN à 15, 31 ou 61 voisins) et trois analyses discriminantes quadratiques régularisées (QDA), ainsi que deux réseaux neuronaux à 8 ou 16 unités cachées et deux LDA régularisées à covariance partagée (α = 0,25 ou 0,90). Elle retient **un seul modèle** selon le meilleur score de Brier sur la validation chronologique. Les treize caractéristiques utilisent les rendements, la tendance, la volatilité, le volume lorsqu’il est fourni et le contexte H1. Le découpage réserve 50 % à l’entraînement, 25 % à la validation et 25 % au test final, avec purge des horizons. Le test final ne sélectionne ni modèle ni paramètre ; aucun réentraînement ne mélange ces partitions.

La standardisation est apprise uniquement sur l’entraînement, avec valeurs standardisées limitées à ±5. Le kNN utilise la distance euclidienne, un poids de 1 / (1 + distance) et trois pseudo-observations réparties selon les fréquences des classes d’entraînement. La QDA apprend une moyenne et une covariance complète pour chaque classe sur l’entraînement ; sa covariance est rapprochée de sa diagonale à 25, 50 ou 90 %, avec stabilisation positive et décomposition de Cholesky. La régression logistique, la QDA et les réseaux neuronaux ajustent leur température sur la validation ; le kNN choisit son nombre de voisins sur cette partition, sans prétendre avoir reçu une calibration de température. Les diagnostics séparés incluent Brier, référence et échantillons. Une estimation historique peut être moins bonne que sa référence. Données périmées, connexion interrompue ou échantillon insuffisant : confiance indisponible, affichée « — ».

Les réseaux neuronaux utilisent une couche tanh, une sortie softmax à trois classes, une initialisation Xavier déterministe et Adam en lot complet avec pénalisation L2 hors biais. Les deux tailles et les 160 itérations sont fixées avant le test. Aucun modèle ne reçoit un avantage de sélection lié à son architecture.

Le panneau « IA locale » montre les trois probabilités UP, DOWN et FLAT. Son scanner suit automatiquement les cinq marchés et permet de changer de graphique. « Méthode » montre les modèles comparés, celui retenu et, lorsque le kNN est sélectionné, cinq voisins historiques réellement utilisés, avec dates, directions et distances. Ces voisins décrivent la cible nette à une heure, pas des trades gagnants. Le volet replié « Test historique » présente uniquement les trades clos du test final de la règle choisie : échantillon, taux de réussite et intervalle de Wilson à 95 %, espérance, résultat net et perte depuis un sommet en R. Les dates couvrent les trades effectivement observés, pas toute la partition. Moins de 20 trades porte la mention « échantillon court » ; zéro trade conserve un taux indisponible. Ces diagnostics ne choisissent ni règle ni modèle et ne remplacent pas la confiance directionnelle.

KAMA utilise ER 10 avec constantes 2/30 au carré et une amorce SMA 10. PPO normalise MACD 12/26 par EMA 26. Ultimate utilise les pressions et true ranges 7/14/28 pondérés 4/2/1. SMI doublement lissé 3/3 mesure la distance au milieu du canal 5. Stoch RSI emploie RSI Wilder 14, fenêtre 14, SMA K3/D3. Elder Ray utilise EMA 13, DeMarker les variations high/low sur 14 et Awesome les médianes HL2 en SMA 5/34. Les règles de reprise/croisement sont des conditions programmées propres au terminal ; les seuils futurs dépendant d’une bougie inconnue restent absents.

Calculs vérifiés avec les références primaires : [QDA](https://scikit-learn.org/stable/modules/lda_qda.html), [SAR](https://www.tradingview.com/support/solutions/43000502597-parabolic-sar-sar/), [Williams %R](https://www.tradingview.com/support/solutions/43000501985-williams-r-r/), [Fisher — éditeur](https://traders.com/documentation/feedbk_docs/2002/11/TradersTips/TradersTips.html), [TRIX](https://www.tradingview.com/support/solutions/43000502331-trix/), [TSI](https://www.tradingview.com/support/solutions/43000592290-true-strength-index/), [DEMA](https://www.tradingview.com/support/solutions/43000589132-double-exponential-moving-average-ema/), [Chandelier](https://www.tradingview.com/support/solutions/43000773013-chandelier-exit/), [Vortex](https://www.tradingview.com/support/solutions/43000591352-vortex-indicator/), [KAMA](https://www.tradingview.com/support/solutions/43000773012-kaufman-s-adaptive-moving-average-kama/), [PPO](https://www.tradingview.com/support/solutions/43000502346-percentage-price-oscillator-ppo/), [Ultimate](https://www.tradingview.com/support/solutions/43000502328-ultimate-oscillator-uo/), [SMI](https://www.tradingview.com/support/solutions/43000707882-stochastic-momentum-index-smi/), [Stoch RSI](https://www.tradingview.com/support/solutions/43000502333-stochastic-rsi-stoch-rsi/), [DeMarker](https://www.metatrader5.com/en/terminal/help/indicators/oscillators/demarker), [Elder Ray](https://www.metatrader5.com/en/terminal/help/indicators/oscillators/bears), [Awesome](https://www.metatrader5.com/en/terminal/help/indicators/bw_indicators/awesome), [MLP](https://scikit-learn.org/stable/modules/neural_networks_supervised.html) et [Adam](https://docs.pytorch.org/docs/2.14/generated/torch.optim.Adam.html).

## Idées et actualités

Les idées respectent leurs prérequis techniques et leur propre direction H1. Le signal confirmé reste en tête ; les autres scénarios sont classés par distance au seuil en ATR, avec une règle par carte. Les seuils EMA et MACD anticipent exactement la fenêtre de 160 bougies utilisée à la prochaine clôture. Franchir un niveau ne valide pas les autres critères. Les règles dépendant de la prochaine amplitude ou d’un indicateur ne présentent pas de faux seuil précis. Aucun stop ni objectif n’est projeté sur un scénario conditionnel : seuls les niveaux réels d’un signal confirmé sont publiés. L’heure de référence et la prochaine clôture sont distinctes. Un marché fermé ou périmé n’affiche aucune idée active.

Le journal de signaux conserve les changements effectivement observés avec cours frais, heure d’observation et source ; il ne reconstitue pas de signaux historiques.

Les titres RSS/Atom proviennent de la Federal Reserve, de la BCE, de la Bank of England, du BLS, de Nasdaq Trader et de CoinDesk, identifié comme média. Actualisation automatique toutes les cinq minutes, déduplication et fenêtre de trente jours. Chaque titre garde son lien HTTPS, sa date de publication et son heure de réception. Les associations aux marchés reflètent le périmètre de la source ou des mots-clés, sans sentiment ni note d’impact calculés. Un échec conserve le dernier cache avec son statut ; l’âge de réception reste visible. Les actualités ne déclenchent aucun ordre.

## Alertes et observation

Le panneau « Observation » ajoute des alertes BUY/SELL activables, l’état des cinq flux et le suivi des nouveaux signaux. Les alertes exigent une bougie confirmée, un flux frais, des niveaux cohérents et une probabilité directionnelle strictement supérieure à 60 %. Elles ne rejouent pas l’historique au chargement ou à la reconnexion ; leurs identifiants et le réglage sont conservés dans ce navigateur. L’alerte visuelle fonctionne dans le terminal ouvert. Le son utilise [Web Audio](https://www.w3.org/TR/webaudio-1.1/) après activation manuelle, selon les règles du navigateur. Ce ne sont pas des notifications système.

Le suivi conserve dans SQLite l’entrée, le stop, l’objectif et l’horizon d’origine de chaque nouveau signal sur bougie clôturée. Seules les cotations fraîches reçues après son enregistrement, du même fournisseur, peuvent constater un toucher. Chaque cotation Kraken/Deriv est examinée dès sa réception, avant l’actualisation de l’écran. Les ticks dont l’heure fournisseur est identique sont ordonnés par leur réception locale réellement mesurée ; une répétition ou un ordre temporel ambigu reste ignoré. Le premier toucher reste enregistré ; aucune bougie passée, interpolation ou reconstruction ne crée de résultat. À la fin de l’horizon, un signal sans toucher observé devient « Horizon terminé ». Ces observations ne sont ni des exécutions, ni un PnL, ni un taux de trades gagnants. Les anciens événements ne sont pas rétroactivement convertis en observations.

L’état des flux distingue direct, instantané, marché fermé et données anciennes. L’âge reçu mesure le temps depuis la réception locale, pas une latence réseau. Le spread vient uniquement du bid/ask fourni. Une valeur manquante reste « — ». Les détails affichent l’âge des cotations, l’état du modèle, les clôtures disponibles et la progression temporelle de la bougie ouverte. Ces diagnostics ne modifient pas la décision. Les interfaces `/api/health` et `/api/followups` proposent les mêmes observations, éventuellement filtrées par l’un des cinq marchés.

## Paper et profil funded

Le journal est simulé localement, sans ordre réel ni ordre Alpaca. Confirmer les règles et instruments du challenge pour activer les entrées. Les snapshots Nasdaq ne sont pas exécutables.

Le modèle, le laboratoire et les entrées paper partagent les mêmes hypothèses par côté : frais de 10 points de base et slippage de 5 pour BTC/ETH ; 2 et 2 pour les autres marchés. Ces hypothèses ne sont pas des tarifs de broker. Un stop ou objectif déjà franchi, une entrée rendue invalide par bid/ask et slippage, ou un éloignement supérieur à 0,5 ATR bloque aussi le signal affiché. Les niveaux de la règle restent fixes après confirmation.

Le profil utilise une perte totale fixe, sans trailing drawdown ni règle de consistance. Sa référence quotidienne est l’équité au premier accès du jour dans le fuseau choisi, pas une reconstitution du broker à minuit. Le compteur mesure les jours d’ouverture de trades. Les sorties utilisent les cotations observées ; coupures et gaps peuvent modifier le résultat. Capital et fuseau sont verrouillés après le premier trade.

## Configuration et vérification

Kraken et Deriv public ne nécessitent aucune clé. Twelve Data reste un secours REST optionnel : copier `.env.example` en `.env`, renseigner la clé localement et relancer. Les accès des connecteurs du chat ne sont pas transmis au terminal.

`npm run check` vérifie tous les modules. `npm test` couvre notamment les données, les coupures, les décisions, la séparation temporelle, le modèle, les actualités et le journal paper. Les données déterministes sont réservées aux tests.

Les historiques et imports restent dans `data/`, les caches et le journal dans `runtime/`. `.env` est exclu des fichiers publics.

Sources : [Kraken OHLC](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ohlc), [Deriv public](https://developers.deriv.com/docs/options/ws-public/), [Fed RSS](https://www.federalreserve.gov/feeds/feeds.htm), [BCE RSS](https://www.ecb.europa.eu/home/html/rss.en.html), [BoE RSS](https://www.bankofengland.co.uk/rss), [BLS RSS](https://www.bls.gov/feed/), [Nasdaq RSS](https://www.nasdaqtrader.com/Trader.aspx?id=NewsRSS), [CoinDesk RSS](https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss), [calibration](https://scikit-learn.org/stable/modules/calibration.html), [validation temporelle](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html).

## Publication des estimations

Le serveur supprime les probabilités, les niveaux et l’autorisation BUY/SELL si le modèle n’a pas de rapport de test exploitable (au moins 40 lignes, statut de test présent) ou si son erreur Brier n’est pas strictement inférieure à celle de la référence fondée sur les fréquences d’entraînement. L’interface indique « Modèle non retenu » et expose la raison. Les idées restent conditionnelles et aucune entrée paper ne peut contourner ce contrôle.

Ce contrôle utilise désormais le rapport de test comme condition de publication : le test n’est donc plus une mesure totalement indépendante de cette décision de publication. Il ne choisit ni l’architecture ni les paramètres du modèle. Un passage du contrôle est une comparaison descriptive sur un échantillon historique, pas une certification de calibration, de rentabilité ou de taux de réussite. Les cibles à une heure se chevauchent. Le seuil directionnel supérieur à 60 %, les vérifications des niveaux et les contrôles de fraîcheur restent nécessaires. Le statut interne « audited » indique une taille minimale de test ; il ne certifie pas la performance.

## Cohérence des plans et replay du moteur

L’entrée affichée est désormais l’entrée exécutable estimée : ask pour BUY, bid pour SELL lorsque disponible, sinon dernier prix explicitement identifié dans le plan. Le glissement hypothétique est appliqué une seule fois à cette entrée. Le stop et l’objectif restent ceux du signal clôturé ; le backtest ne les déplace plus à l’ouverture suivante. Les cotations invalides, livres croisés, niveaux déjà franchis, dérive au-delà de 0,5 ATR et objectifs négatifs après coûts sont refusés par le même calcul. Le dimensionnement paper utilise la perte estimée au stop (entrée exécutable, glissement de sortie et frais), et réserve le risque réel de la quantité simulée.

Le volet **Replay du moteur** et `GET /api/replay?symbol=EUR%2FUSD` rejouent la règle choisie par régime, le filtre H1, les probabilités du modèle figé et le seuil >60 % sur la période historique postérieure à sa calibration. Une seule position est simulée à la fois. Les issues utilisent les niveaux d’origine, les coûts et l’horizon du modèle (actuellement une heure). Une bougie touchant les deux niveaux prend le stop en premier. Les périodes manquantes et positions encore ouvertes sont censurées, sans être transformées en gains. Le rapport expose les trades résolus, les causes de blocage et les issues non connues, ainsi qu’un scénario frais/glissement ×2.

Ce replay ne réapplique pas rétrospectivement le contrôle calculé à la fin du test dans model-assessment : le faire consulterait les résultats futurs de la période rejouée. Les rapports l’indiquent avec publicationGateApplied=false. Les architectures restent choisies sur validation, jamais sur le résultat du replay. Les prix historiques n’incluent pas un carnet bid/ask : leur spread ne peut pas être reconstitué par invention. Le replay reste une simulation OHLC, distincte du suivi des cotations observées en direct et du laboratoire des règles seules (horizon de quatre heures).

Le pourcentage principal d’un BUY/SELL est nommé **Direction à 1 h**. Il estime un mouvement net à cet horizon, pas la probabilité d’atteindre l’objectif avant le stop. Les taux de trades gagnants du replay restent dans le volet historique, avec leur taille d’échantillon ; aucun de ces chiffres n’est substitué à la confiance actuelle. Le R des nouveaux backtests et replays correspond à la perte initiale estimée au stop, frais et glissement inclus (riskUnit). Le stop sans gap représente donc −1 R ; un gap défavorable peut perdre davantage.

Sources sur les flux et la simulation : [Kraken, événements OHLC WebSocket](https://support.kraken.com/articles/360022326871-kraken-websocket-api-frequently-asked-questions), [Alpaca, fonctionnement du paper trading](https://docs.alpaca.markets/us/v1.4.2/docs/paper-trading). Ces références décrivent les contraintes générales ; elles ne certifient pas les résultats de ce terminal et n’impliquent aucune connexion à un compte Alpaca.

### Deux nouvelles structures de prix (38 règles)

NR7 breakout 15m : adaptation intraday de la compression NR7. Les sept bougies précédentes doivent être consécutives ; la dernière a une amplitude strictement plus petite que les six autres. La bougie suivante doit clôturer hors de cette amplitude, avec corps ≥ 0,25 ATR et tendance EMA 21/50 cohérente. Les égalités sont refusées. [Description NR7](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7).

Engulfing trend reclaim : adaptation de l'engloutissement de corps au repli de tendance. Le corps précédent opposé doit être englouti avec dépassement strict, le repli doit toucher EMA 21, puis la clôture reprendre EMA 21 avec pente et EMA 50 alignées. Le corps de confirmation doit être ≥ 0,25 ATR. Il s'agit du corps, pas d'une obligation d'engloutir toutes les mèches. [Définition des figures](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bullish-reversal-patterns).

Ces deux règles sont accessibles dans le routeur déterministe, le catalogue, les plans conditionnels, les backtests et le replay. Le stop se situe au-delà de l'extrême des deux bougies avec marge de 0,1 ATR ; l'objectif est 1,8 fois le risque brut initial. Elles gardent les mêmes contrôles de données, H1, modèle, prix, frais et probabilité directionnelle > 60 %. Aucune performance spécifique n'est présumée pour ces adaptations 15m.

### Contrôles du signal et 40 règles

Extension précédente : 41 règles avec `two-bar-pullback`. Deux corps opposés à la tendance EMA 21/50 doivent toucher EMA 21 puis être franchis par la clôture suivante ; trois bougies consécutives et un corps de confirmation ≥ 0,25 ATR sont requis. Le stop couvre les trois bougies avec marge 0,1 ATR. Le routeur décrit maintenant chaque figure avec son explication propre. Le contrôle historique distinct est dans `../controle-strategie-41.md`.

Le diagnostic `/api/decision-checks` ajoute `candleQuality`, limité aux 85 dernières bougies exposées dans le terminal : anomalies OHLC, doublons, ordre, clôtures prématurées et interruptions. Il ne trie ni n'interpole les données et n'affecte pas les décisions. L'affichage masque le diagnostic mémorisé après déconnexion. Les tests vérifient aussi, pour chacune des 42 règles, que les bougies après la borne de fin ne changent pas le backtest.

Deux règles supplémentaires : `fractal-breakout` confirme un pivot strict de cinq bougies avec deux bougies clôturées à droite avant la bougie de cassure ; `failed-breakout` exige une clôture hors du canal des vingt bougies antérieures puis une réintégration en clôture sur la bougie suivante. Elles passent par le routeur, les niveaux structurels, les backtests et les contrôles de publication existants. Les filtres EMA et ATR sont nos adaptations, sans performance présumée. Définition du pivot : https://www.metatrader5.com/en/terminal/help/indicators/bw_indicators/fractals.

Le volet repliable « Contrôles du signal » montre sept contrôles indépendants, dont les blocages simultanés. La route `/api/decision-checks` accepte un filtre `symbol`. Le diagnostic explique uniquement la décision existante : il ne choisit aucune stratégie et ne modifie aucune probabilité. Les valeurs indisponibles restent distinctes des contrôles réussis. En cas de déconnexion du navigateur, les contrôles mémorisés ne sont plus présentés comme actuels.

Les backtests de règles excluent désormais les bougies en formation. Si une position traverse un trou de données, son issue est censurée et exclue des statistiques plutôt que d'être déduite d'une bougie ultérieure. La propriété `censored` compte ces positions. Les clôtures de fin de période restent des sorties simulées au cours de clôture.

Le fichier `../audit-strategies-40.json` présente les quatre dernières règles sur le dernier quart des historiques fournisseurs disponibles, avec coûts de base et coûts doublés. Il teste les règles seules, sans les filtres H1 et probabilité du moteur complet ; le replay du terminal reste le rapport distinct de ce moteur. Aucun résultat n'est une observation de trade réel.

## Profil The5ers

Activer avec ORIVANE_COST_PROFILE=the5ers. La [commission publiée](https://the5ers.com/faqs/what-are-the-spreads-and-commissions/) est de 4 USD par lot forex aller-retour pour un contrat de 100 000 unités. Le moteur utilise donc 0,00002 USD par unité et par côté, converti en fraction du prix seulement pour les étiquettes directionnelles. Cette commission reste fixe en dollars dans le calcul du risque, les backtests, le replay, les positions paper et le journal. Les indices ont une commission publiée nulle.

Le glissement reste hypothétique à 2 pb par côté pour FX/NDX ; le spread historique The5ers manque. Les taux crypto et métaux ne sont pas chiffrés dans cette FAQ : leurs hypothèses antérieures sont conservées avec commissionVerified=false. Aucune source de cotation The5ers n’est connectée : Kraken, Deriv et Yahoo restent distincts. Le Nasdaq Yahoo est un indice et ne représente pas le CFD du compte.

Le contrôle du modèle refuse toujours les estimations qui ne battent pas leur référence sur le test. Sa raison remplace désormais tout pourcentage rejeté, tout en conservant les blocages indépendants H1/prix. Le seuil BUY/SELL reste strictement supérieur à 60 %.
