# Guess the Footballer

Devine le footballeur mystère des 5 grands championnats en 8 essais.
Indices par colonne : championnat, club, nationalité, poste, année de naissance.

## Structure

```
index.html                  page du jeu
style.css                   styles
app.js                      logique du jeu (charge data/players.json)
data/players.json           joueurs (généré, ne pas éditer à la main)
scripts/build_players.py    génère players.json depuis transfermarkt-datasets
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

Dans `app.js` : `MAX` (essais), `POOL_DAILY` et `POOL_FREE` (le joueur mystère est tiré
parmi les N joueurs les plus cotés ; tous les joueurs restent proposables).

Dans `scripts/build_players.py` : `COUNTRIES` (traduction + continent des nationalités)
et `CLUB_ALIASES` (noms de clubs raccourcis). Le script affiche les pays manquants.

## Données

Source : [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets)
(licence CC0), mise à jour hebdomadaire.
