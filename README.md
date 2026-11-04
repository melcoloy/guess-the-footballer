# Guess the Footballer

Devine le footballeur mystère des 5 grands championnats en 8 essais.
Indices par colonne : championnat, club, nationalité, poste, année de naissance, pied fort, taille, valeur.

Fonctionnalités : joueur du jour (calendrier fixe) et partie libre (difficulté + championnat au choix),
statistiques et séries, compte à rebours, partage natif sur mobile, initiales après 5 essais,
règles au premier lancement, thème clair/sombre, contraste élevé (daltonisme),
installable sur téléphone et jouable hors ligne.

## Structure

```
index.html                  page du jeu
style.css                   styles
app.js                      logique du jeu (charge data/players.json et data/daily.json)
sw.js                       service worker (hors ligne)
manifest.webmanifest        application installable
fonts/                      polices Anton et Barlow (hébergées ici : aucun appel à Google)
icons/                      icônes et image d'aperçu des liens (og.png)
data/players.json           joueurs (généré, ne pas éditer à la main)
data/daily.json             calendrier du joueur du jour (généré)
scripts/build_players.py    génère players.json et daily.json
.github/workflows/          mise à jour automatique chaque semaine
```

## Lancer en local (VS Code)

```bash
python scripts/build_players.py   # télécharge les effectifs et crée data/players.json
python -m http.server 8000        # puis ouvre http://localhost:8000
```

Ouvrir `index.html` directement (double-clic) ne marche pas : le navigateur bloque
le chargement du JSON en `file://`. Il faut passer par un serveur local
(la commande ci-dessus, ou l'extension Live Server de VS Code).

## Réglages

Dans `app.js` : `MAX` (essais), `HINT_AFTER` (essais avant les initiales).
Les niveaux de la partie libre sont dans `index.html` (liste « Difficulté »).
Tous les joueurs restent proposables, quel que soit le niveau.

Dans `scripts/build_players.py` : `DAILY_POOL` (le joueur du jour est tiré parmi les N plus cotés),
`DAILY_AHEAD` (jours préparés à l'avance) et `DAILY_NO_REPEAT`. Les jours passés et le jour en cours
ne sont jamais réécrits. `python scripts/build_players.py --calendar-only` régénère seulement le calendrier.

Dans `index.html` : les balises `og:url` et `og:image` doivent contenir l'adresse complète du site
(aperçu des liens partagés). Elles pointent vers `https://melcoloy.github.io/guess-the-footballer/` :
à changer si le site est publié ailleurs.

Après une modification de `index.html`, `style.css` ou `app.js`, les visiteurs reçoivent la nouvelle
version au chargement suivant. Pour forcer un renouvellement complet du cache hors ligne,
incrémente `VERSION` dans `sw.js`.

Dans `scripts/build_players.py` : `COUNTRIES` (traduction + continent des nationalités)
et `CLUB_ALIASES` (noms de clubs raccourcis). Le script affiche les pays manquants.

## Données

Sources : [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (CC0),
complété par [Wikidata](https://www.wikidata.org) (CC0) pour les transferts récents, les promus,
et les tailles, nationalités et pieds forts manquants. Le site affiche la date réelle des effectifs
Transfermarkt (dernier match du dataset) en plus de la date de vérification hebdomadaire.
