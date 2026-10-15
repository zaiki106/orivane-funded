# Orivane mobile — 88 stratégies · intelligence-mobile3

Cette livraison contient l'interface compilée, les modules de calcul dans le navigateur, les modèles existants et les petites API Vercel. Aucun build React ni entraînement n'est requis pour publier ce dossier.

## Publier sur ton projet existant

1. Décompresse entièrement l'archive sur ton ordinateur. Ne lance pas le fichier HTML directement depuis le ZIP.
2. Installe Node.js 24 avec npm si `node` et `npx` ne sont pas disponibles.
3. Ouvre un terminal dans le dossier extrait et exécute `npx vercel login` avec un compte autorisé dans l'équipe `zaikifrt-1551s-projects`.
4. Sous Windows, double-clique `DEPLOYER-VERCEL.cmd`. Sinon, exécute `npx vercel --prod --scope zaikifrt-1551s-projects --yes` dans ce dossier.
5. Attends la confirmation Vercel. Ouvre ensuite https://orivane-funded-mobile.vercel.app sur ton téléphone et actualise la page.

L'archive inclut une liaison `.vercel/project.json` vers le projet existant `prj_IaHo0YQZHXh9WzmnL4KAz5XE2BQA` et l'équipe `team_wJLSqPuvjj9izDaQOoJU9QAu`. Ce fichier contient uniquement des identifiants de projet, aucun jeton. Une erreur 403 exige un compte ayant réellement les droits de déploiement ; changer les fichiers ne contourne pas ce contrôle.

## Ce qui fonctionne sans le PC

Une fois le site publié sur Vercel, le téléphone charge l'application par HTTPS. Les cotations viennent des fournisseurs et des API hébergées ; les Web Workers du téléphone calculent les configurations et les diagnostics. Le PC peut être éteint. Internet et une page active restent nécessaires ; iOS peut suspendre la page en arrière-plan. Le retour à la page relance ou réinitialise proprement les connexions.

Le ZIP est une livraison de fichiers, pas une application iOS native. `file://`, `localhost`, `127.0.0.1` et l'adresse privée d'un PC éteint ne fournissent pas le service hébergé.

## Corrections incluses

- Historique Bitcoin conservé lorsque seules certaines observations sont futures ; horodatages préservés et écart d'horloge signalé.
- Reprise des workers et des flux après suspension, erreur ou retour de la connexion ; sauvegarde locale du journal conservée.
- Section « Intelligence sur cet appareil » dans Terminal et Recherche : bibliothèque des 88 règles (66 moteur + 6 recettes OHLCV + 16 recettes prix), recherche par nom/formule, filtres par famille/état, conditions BUY/SELL et niveaux des configurations détectées. Les seize recettes prix restent calculables sans volume réel. Régimes k-means et dérive PSI restent disponibles quand leurs données le permettent.
- Raisons explicites du HOLD et des refus de publication. Les configurations BUY/SELL de recherche ne sont pas déguisées en signaux validés.
- Tests : 659 dans le cœur, 156 sur le mobile et 47 dans l'interface ; compilation TypeScript/Vite réussie. Vue 390 px vérifiée sans débordement horizontal ni erreur JavaScript observée.

La connexion Vercel de l'assistant a refusé la publication avec un 403. Cette livraison ne signifie donc pas que le site public a déjà été remplacé. Le téléchargement seul ne publie rien. Les corrections ne sont pas encore poussées sur GitHub ; un futur redéploiement depuis l'ancienne branche peut rétablir l'ancienne version.

Les modèles historiques restent en observation. Ce correctif ne prouve pas leur rentabilité et n'invente pas des BUY/SELL pour éliminer les HOLD.

## Nouveautés de cette version

Analyse EMA 9/21 sur 15 min, 1 h et 4 h ; ATR Wilder, canal des 20 bougies précédentes et rang d'amplitude. Seuls les blocs UTC complets de la dernière séquence continue sont utilisés. Les anciennes interruptions sont signalées avec le nombre de bougies écartées.

Bilan BUY/SELL/attente/données manquantes, désaccords entre familles, configurations partielles et liste des conditions encore manquantes. Aucun décompte de règles n'est présenté comme une probabilité de réussite.

La version affichée dans Intelligence doit être intelligence-mobile3 après publication. Le fichier /intelligence-release.json doit également répondre avec cette version. Si ce fichier répond 404, l'ancienne version est encore servie.

Consulte VERIFICATION-MOBILE.md pour les résultats et les limites des vérifications.
