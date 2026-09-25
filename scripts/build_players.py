"""
Génère data/players.json.

Sources :
  1. transfermarkt-datasets (CC0) : identité, nationalité, poste, date de naissance, valeur.
     Attention : ce dataset est figé au 6 juillet 2026, le mercato d'été n'y est pas.
  2. Wikidata (CC0) : transferts depuis le 1er juin 2026, reliés par l'identifiant Transfermarkt (P2446).
  3. scripts/overrides.json : promus/relégués de la saison, corrections manuelles.

Les clubs de chaque championnat sont ceux qui ont joué la saison 2025-26 (games.csv),
auxquels on applique les promus/relégués d'overrides.json.

Usage :
    python scripts/build_players.py                 # tout télécharger
    python scripts/build_players.py --no-wikidata   # sans l'étape Wikidata
    python scripts/build_players.py --local DIR     # lit players, clubs et games depuis DIR (.csv ou .csv.gz)

Aucune dépendance externe : uniquement la bibliothèque standard.
"""
import csv
import datetime
import functools
import gzip
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "players.json"
OVERRIDES = ROOT / "scripts" / "overrides.json"

BASE_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/"
WIKIDATA = "https://query.wikidata.org/sparql"
USER_AGENT = "guess-the-footballer/1.0 (projet perso etudiant)"
CUTOFF = "2026-06-01T00:00:00Z"  # transferts plus récents que ça -> on fait confiance à Wikidata

LEAGUES = {"GB1": "Premier League", "ES1": "Liga", "IT1": "Serie A", "L1": "Bundesliga", "FR1": "Ligue 1"}
LEAGUE_CODE = {v: k for k, v in LEAGUES.items()}
EXPECTED_CLUBS = {"Premier League": 20, "Liga": 20, "Serie A": 20, "Bundesliga": 18, "Ligue 1": 18}
POSITIONS = {"Goalkeeper": "GB", "Defender": "DEF", "Midfield": "MIL", "Attack": "ATT"}

EU, AF, SA, NA, AS, OC = "Europe", "Afrique", "Amérique du Sud", "Amérique du Nord", "Asie", "Océanie"
# Nom Transfermarkt (anglais) -> (nom français, continent).
# Le script affiche les pays manquants à la fin : ajoute-les ici.
COUNTRIES = {
    "France": ("France", EU), "England": ("Angleterre", EU), "Scotland": ("Écosse", EU), "Wales": ("Pays de Galles", EU),
    "Northern Ireland": ("Irlande du Nord", EU), "Ireland": ("Irlande", EU), "Belgium": ("Belgique", EU),
    "Netherlands": ("Pays-Bas", EU), "Germany": ("Allemagne", EU), "Austria": ("Autriche", EU),
    "Switzerland": ("Suisse", EU), "Spain": ("Espagne", EU), "Portugal": ("Portugal", EU), "Italy": ("Italie", EU),
    "Denmark": ("Danemark", EU), "Norway": ("Norvège", EU), "Sweden": ("Suède", EU), "Finland": ("Finlande", EU),
    "Iceland": ("Islande", EU), "Poland": ("Pologne", EU), "Czech Republic": ("Tchéquie", EU),
    "Czechia": ("Tchéquie", EU), "Slovakia": ("Slovaquie", EU), "Hungary": ("Hongrie", EU),
    "Romania": ("Roumanie", EU), "Bulgaria": ("Bulgarie", EU), "Greece": ("Grèce", EU), "Croatia": ("Croatie", EU),
    "Serbia": ("Serbie", EU), "Slovenia": ("Slovénie", EU), "Bosnia-Herzegovina": ("Bosnie-Herzégovine", EU),
    "Montenegro": ("Monténégro", EU), "North Macedonia": ("Macédoine du Nord", EU), "Albania": ("Albanie", EU),
    "Kosovo": ("Kosovo", EU), "Turkey": ("Turquie", EU), "Türkiye": ("Turquie", EU), "Ukraine": ("Ukraine", EU),
    "Russia": ("Russie", EU), "Georgia": ("Géorgie", EU), "Armenia": ("Arménie", EU),
    "Azerbaijan": ("Azerbaïdjan", EU), "Luxembourg": ("Luxembourg", EU), "Lithuania": ("Lituanie", EU),
    "Latvia": ("Lettonie", EU), "Estonia": ("Estonie", EU), "Cyprus": ("Chypre", EU), "Malta": ("Malte", EU),
    "Moldova": ("Moldavie", EU), "Belarus": ("Biélorussie", EU), "Israel": ("Israël", EU),
    "Faroe Islands": ("Îles Féroé", EU), "Andorra": ("Andorre", EU),
    "Brazil": ("Brésil", SA), "Argentina": ("Argentine", SA), "Uruguay": ("Uruguay", SA),
    "Colombia": ("Colombie", SA), "Ecuador": ("Équateur", SA), "Chile": ("Chili", SA), "Paraguay": ("Paraguay", SA),
    "Peru": ("Pérou", SA), "Venezuela": ("Venezuela", SA), "Bolivia": ("Bolivie", SA),
    "United States": ("États-Unis", NA), "Canada": ("Canada", NA), "Mexico": ("Mexique", NA),
    "Costa Rica": ("Costa Rica", NA), "Jamaica": ("Jamaïque", NA), "Panama": ("Panama", NA),
    "Honduras": ("Honduras", NA), "Haiti": ("Haïti", NA), "Curacao": ("Curaçao", NA), "Suriname": ("Suriname", NA),
    "Guadeloupe": ("Guadeloupe", NA), "Martinique": ("Martinique", NA), "French Guiana": ("Guyane", NA),
    "Trinidad and Tobago": ("Trinité-et-Tobago", NA), "El Salvador": ("Salvador", NA),
    "Guatemala": ("Guatemala", NA), "Grenada": ("Grenade", NA),
    "Dominican Republic": ("République dominicaine", NA), "Cuba": ("Cuba", NA),
    "Morocco": ("Maroc", AF), "Algeria": ("Algérie", AF), "Tunisia": ("Tunisie", AF), "Egypt": ("Égypte", AF),
    "Senegal": ("Sénégal", AF), "Mali": ("Mali", AF), "Cote d'Ivoire": ("Côte d'Ivoire", AF),
    "Ivory Coast": ("Côte d'Ivoire", AF), "Ghana": ("Ghana", AF), "Nigeria": ("Nigeria", AF),
    "Cameroon": ("Cameroun", AF), "Guinea": ("Guinée", AF), "Guinea-Bissau": ("Guinée-Bissau", AF),
    "Equatorial Guinea": ("Guinée équatoriale", AF), "Gabon": ("Gabon", AF), "DR Congo": ("RD Congo", AF),
    "Congo": ("Congo", AF), "Burkina Faso": ("Burkina Faso", AF), "Benin": ("Bénin", AF), "Togo": ("Togo", AF),
    "Gambia": ("Gambie", AF), "The Gambia": ("Gambie", AF), "Sierra Leone": ("Sierra Leone", AF),
    "Liberia": ("Liberia", AF), "Cape Verde": ("Cap-Vert", AF), "Angola": ("Angola", AF),
    "Mozambique": ("Mozambique", AF), "Zambia": ("Zambie", AF), "Zimbabwe": ("Zimbabwe", AF),
    "South Africa": ("Afrique du Sud", AF), "Kenya": ("Kenya", AF), "Tanzania": ("Tanzanie", AF),
    "Uganda": ("Ouganda", AF), "Ethiopia": ("Éthiopie", AF), "Madagascar": ("Madagascar", AF),
    "Comoros": ("Comores", AF), "Mauritania": ("Mauritanie", AF), "Niger": ("Niger", AF), "Chad": ("Tchad", AF),
    "Central African Republic": ("Centrafrique", AF), "Burundi": ("Burundi", AF), "Libya": ("Libye", AF),
    "Sudan": ("Soudan", AF),
    "Japan": ("Japon", AS), "Korea, South": ("Corée du Sud", AS), "South Korea": ("Corée du Sud", AS),
    "China": ("Chine", AS), "Iran": ("Iran", AS), "Iraq": ("Irak", AS), "Saudi Arabia": ("Arabie saoudite", AS),
    "Qatar": ("Qatar", AS), "Uzbekistan": ("Ouzbékistan", AS), "Indonesia": ("Indonésie", AS),
    "Philippines": ("Philippines", AS), "Lebanon": ("Liban", AS), "Syria": ("Syrie", AS),
    "Jordan": ("Jordanie", AS), "Palestine": ("Palestine", AS), "Bangladesh": ("Bangladesh", AS),
    "Malaysia": ("Malaisie", AS), "Thailand": ("Thaïlande", AS),
    "Australia": ("Australie", OC), "New Zealand": ("Nouvelle-Zélande", OC),
    "New Caledonia": ("Nouvelle-Calédonie", OC),
    # variantes utilisées par Wikidata
    "United States of America": ("États-Unis", NA), "Republic of Ireland": ("Irlande", EU),
    "Bosnia and Herzegovina": ("Bosnie-Herzégovine", EU), "Democratic Republic of the Congo": ("RD Congo", AF),
    "Republic of the Congo": ("Congo", AF), "Curaçao": ("Curaçao", NA), "People's Republic of China": ("Chine", AS),
    "Kingdom of the Netherlands": ("Pays-Bas", EU), "Czechia": ("Tchéquie", EU), "Cabo Verde": ("Cap-Vert", AF),
    "The Gambia": ("Gambie", AF), "Guinea-Bissau": ("Guinée-Bissau", AF), "Côte d'Ivoire": ("Côte d'Ivoire", AF),
    "?": ("Inconnue", "?"),
}

# Noms affichés dans le jeu : "mots-clés" -> nom court.
# Un club prend le nom de la règle dont tous les mots-clés apparaissent dans son nom officiel.
CLUB_NAMES = {
    # Premier League
    "arsenal": "Arsenal", "aston villa": "Aston Villa", "bournemouth": "Bournemouth", "brentford": "Brentford",
    "brighton": "Brighton", "chelsea": "Chelsea", "crystal palace": "Crystal Palace", "everton": "Everton",
    "fulham": "Fulham", "leeds": "Leeds", "liverpool": "Liverpool", "manchester city": "Manchester City",
    "manchester united": "Manchester United", "newcastle": "Newcastle", "nottingham": "Nottingham Forest",
    "sunderland": "Sunderland", "tottenham": "Tottenham", "coventry": "Coventry", "ipswich": "Ipswich",
    "hull": "Hull City", "west ham": "West Ham", "burnley": "Burnley", "wolverhampton": "Wolverhampton",
    # Liga
    "athletic bilbao": "Athletic Bilbao", "atletico madrid": "Atlético Madrid", "osasuna": "Osasuna",
    "celta": "Celta Vigo", "alaves": "Alavés", "elche": "Elche", "barcelona": "FC Barcelone",
    "getafe": "Getafe", "levante": "Levante", "espanyol": "Espanyol", "espanyol barcelona": "Espanyol", "rayo vallecano": "Rayo Vallecano",
    "betis": "Real Betis", "real madrid": "Real Madrid", "real sociedad": "Real Sociedad", "sevilla": "FC Séville",
    "valencia": "Valence", "villarreal": "Villarreal", "racing santander": "Racing Santander",
    "coruna": "Deportivo La Corogne", "malaga": "Málaga", "mallorca": "Majorque", "girona": "Girona",
    "oviedo": "Real Oviedo",
    # Serie A
    "ac milan": "AC Milan", "fiorentina": "Fiorentina", "roma": "AS Rome", "atalanta": "Atalanta",
    "bologna": "Bologne", "cagliari": "Cagliari", "como": "Côme", "genoa": "Genoa", "inter": "Inter Milan",
    "juventus": "Juventus", "parma": "Parme", "napoli": "Naples", "lazio": "Lazio Rome", "torino": "Torino",
    "lecce": "Lecce", "sassuolo": "Sassuolo", "udinese": "Udinese", "venezia": "Venise",
    "frosinone": "Frosinone", "monza": "Monza", "cremonese": "Cremonese", "verona": "Hellas Vérone", "pisa": "Pise",
    # Bundesliga
    "augsburg": "Augsbourg", "union berlin": "Union Berlin", "werder": "Werder Brême",
    "borussia dortmund": "Borussia Dortmund", "eintracht frankfurt": "Eintracht Francfort",
    "freiburg": "SC Fribourg", "hamburger": "Hambourg", "hoffenheim": "Hoffenheim", "koln": "Cologne",
    "leipzig": "RB Leipzig", "leverkusen": "Bayer Leverkusen", "mainz": "Mayence",
    "monchengladbach": "Mönchengladbach", "bayern": "Bayern Munich", "vfb stuttgart": "VfB Stuttgart",
    "schalke": "Schalke 04", "elversberg": "Elversberg", "paderborn": "Paderborn", "wolfsburg": "Wolfsburg",
    "heidenheim": "Heidenheim", "st pauli": "St. Pauli",
    # Ligue 1
    "auxerre": "Auxerre", "monaco": "Monaco", "angers": "Angers", "lorient": "Lorient", "toulouse": "Toulouse",
    "lille": "Lille", "havre": "Le Havre", "nice": "Nice", "lyon": "Lyon", "marseille": "Marseille",
    "paris fc": "Paris FC", "paris sg": "Paris SG", "paris saint germain": "Paris SG", "lens": "Lens",
    "strasbourg": "Strasbourg", "brest": "Brest", "brestois": "Brest", "rennes": "Rennes", "rennais": "Rennes", "troyes": "Troyes",
    "le mans": "Le Mans", "nantes": "Nantes", "metz": "Metz",
}
SUFFIXES = re.compile(
    r"(Football Club|Futbol Club|Club de Fútbol|S\.p\.A\.|S\.A\.D\.|\bSAD\b|\bAFC\b|\bF\.C\.|\be\.V\.|"
    r"GmbH & Co\. KGaA|\bLtd\b\.?|\bLimited\b)",
    re.IGNORECASE,
)


def norm(s: str) -> str:
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower().strip()


def tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", norm(s)))


def matches(query: str, name: str) -> bool:
    q = tokens(query)
    return bool(q) and q <= tokens(name)


def clean_club(name: str) -> str:
    name = (name or "").strip()
    return re.sub(r"\s{2,}", " ", SUFFIXES.sub("", name)).strip(" -,") or name


@functools.lru_cache(maxsize=None)
def pretty_club(name: str) -> str:
    rules = [(q, p) for q, p in CLUB_NAMES.items() if matches(q, name)]
    if not rules:
        return clean_club(name)
    return max(rules, key=lambda r: len(tokens(r[0])))[1]  # la règle la plus précise gagne


# ---------------------------------------------------------------- lecture des données

def read_csv(name: str, local_dir: str | None) -> list[dict]:
    if local_dir:
        plain = Path(local_dir) / f"{name}.csv"
        raw = plain.read_bytes() if plain.exists() else gzip.decompress(Path(f"{plain}.gz").read_bytes())
    else:
        req = urllib.request.Request(BASE_URL + f"{name}.csv.gz", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = gzip.decompress(r.read())
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))


def sparql(query: str) -> list[dict]:
    data = urllib.parse.urlencode({"query": query}).encode()
    req = urllib.request.Request(WIKIDATA, data=data, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["results"]["bindings"]


# Affiliations en cours (sans date de fin) commencées après CUTOFF, pour une liste de joueurs...
QUERY_BY_PLAYER = """SELECT ?tm ?clubTm ?start WHERE {{
  VALUES ?tm {{ {values} }}
  ?p wdt:P2446 ?tm ; p:P54 ?st .
  ?st ps:P54 ?club ; pq:P580 ?start .
  FILTER NOT EXISTS {{ ?st pq:P582 ?end }}
  FILTER(?start >= "{cutoff}"^^xsd:dateTime && ?start <= NOW())
  ?club wdt:P7223 ?clubTm .
}}"""
# ...et pour une liste de clubs (attrape les arrivées de joueurs venus d'autres championnats)
QUERY_BY_CLUB = """SELECT ?tm ?clubTm ?start WHERE {{
  VALUES ?clubTm {{ {values} }}
  ?club wdt:P7223 ?clubTm .
  ?st ps:P54 ?club ; pq:P580 ?start .
  ?p p:P54 ?st ; wdt:P2446 ?tm .
  FILTER NOT EXISTS {{ ?st pq:P582 ?end }}
  FILTER(?start >= "{cutoff}"^^xsd:dateTime && ?start <= NOW())
}}"""
# Article Wikipédia (anglais) -> élément Wikidata du club (+ son id Transfermarkt s'il existe)
QUERY_CLUBS_BY_ARTICLE = """SELECT ?title ?club ?clubTm WHERE {{
  VALUES ?title {{ {values} }}
  ?article schema:name ?title ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?club .
  OPTIONAL {{ ?club wdt:P7223 ?clubTm }}
}}"""
# Joueurs actuellement au club (affiliation sans date de fin, commencée récemment)
QUERY_SQUAD = """SELECT ?club ?p ?pLabel ?tm ?dob ?natLabel ?pos ?start WHERE {{
  VALUES ?club {{ {values} }}
  ?p p:P54 ?st . ?st ps:P54 ?club .
  FILTER NOT EXISTS {{ ?st pq:P582 ?end }}
  OPTIONAL {{ ?st pq:P580 ?start }}
  FILTER(!BOUND(?start) || (?start >= "2019-07-01T00:00:00Z"^^xsd:dateTime && ?start <= NOW()))
  ?p wdt:P569 ?dob . FILTER(YEAR(?dob) >= 1986)
  # écarte les joueurs qui ont une affiliation en cours plus récente dans un autre club
  FILTER NOT EXISTS {{
    ?p p:P54 ?o . ?o ps:P54 ?other ; pq:P580 ?s2 .
    FILTER NOT EXISTS {{ ?o pq:P582 ?e2 }}
    FILTER(?other != ?club && (!BOUND(?start) || ?s2 > ?start))
    ?other wdt:P7223 ?otherTm .
  }}
  OPTIONAL {{ ?p wdt:P2446 ?tm }}
  OPTIONAL {{ ?p wdt:P1532 ?nat }}
  OPTIONAL {{
    ?p wdt:P413 ?posItem .
    VALUES (?top ?pos) {{ (wd:Q201330 "GB") (wd:Q336286 "DEF") (wd:Q193592 "MIL") (wd:Q280658 "ATT") }}
    ?posItem wdt:P279* ?top .
  }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
VALID_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T")


def wikidata_moves(player_ids: set[str], club_ids: set[str]) -> dict[str, tuple[str, str]]:
    """Renvoie {id joueur TM: (id club TM, date de début)} pour les transferts récents."""
    today = datetime.date.today().isoformat()
    moves: dict[str, tuple[str, str]] = {}
    for template, ids in ((QUERY_BY_PLAYER, sorted(player_ids)), (QUERY_BY_CLUB, sorted(club_ids))):
        for i in range(0, len(ids), 300):
            values = " ".join(f'"{x}"' for x in ids[i:i + 300])
            for b in sparql(template.format(values=values, cutoff=CUTOFF)):
                pid, cid, start = b["tm"]["value"], b["clubTm"]["value"], b["start"]["value"]
                if not VALID_DATE.match(start) or start[:10] > today:  # dates mal saisies dans Wikidata
                    continue
                if pid not in moves or start > moves[pid][1]:
                    moves[pid] = (cid, start)  # en cas de doublon, on garde le plus récent
            time.sleep(1)  # politesse envers le serveur Wikidata
    return moves


# ---------------------------------------------------------------- construction

def main() -> None:
    local = sys.argv[sys.argv.index("--local") + 1] if "--local" in sys.argv else None
    use_wikidata = "--no-wikidata" not in sys.argv
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    log: list[str] = []

    players = read_csv("players", local)
    by_id = {r["player_id"]: r for r in players}

    names = {r["club_id"]: r.get("name", "") for r in read_csv("clubs", local)}
    for r in players:
        if r.get("current_club_id") and r["current_club_id"] not in names:
            names[r["current_club_id"]] = r.get("current_club_name", "")

    # 1. clubs de chaque championnat = ceux qui ont joué la dernière saison complète
    games = [g for g in read_csv("games", local) if g.get("competition_id") in LEAGUES and g.get("season")]
    per_season: dict[int, int] = {}
    for g in games:
        per_season[int(g["season"])] = per_season.get(int(g["season"]), 0) + 1
    season = max(s for s, n in per_season.items() if n >= 100)
    club_league: dict[str, str] = {}
    for g in games:
        if int(g["season"]) == season:
            for side in ("home_club_id", "away_club_id"):
                club_league[g[side]] = LEAGUES[g["competition_id"]]

    def league_of(cid: str | None) -> str | None:
        return club_league.get(cid or "")

    def display(cid: str | None) -> str:
        return pretty_club(names.get(cid or "", "")) if cid and names.get(cid) else "sans club"

    def find_club(query: str, prefer_in_game: bool) -> str | None:
        hits = [cid for cid, n in names.items() if matches(query, n) or norm(query) == norm(display(cid))]
        if prefer_in_game:
            hits = [h for h in hits if league_of(h)] or hits
        if len(hits) != 1:
            found = ", ".join(sorted({names[h] for h in hits})[:6])
            log.append(f"! club « {query} » : {len(hits)} correspondance(s){' (' + found + ')' if found else ''}, précise le nom")
            return None
        return hits[0]

    # 2. promus / relégués
    promoted: set[str] = set()
    for club_name, league in overrides.get("championnats", {}).items():
        if club_name.startswith("_"):
            continue
        if league and league not in LEAGUE_CODE:
            log.append(f"! championnat inconnu « {league} » pour {club_name}")
            continue
        cid = find_club(club_name, prefer_in_game=not league)
        if not cid:
            continue
        if league:
            club_league[cid] = league
            promoted.add(cid)
        else:
            club_league.pop(cid, None)

    # 2b. promus absents du dataset : repérés via leur article Wikipédia
    wiki_clubs = {k: v for k, v in overrides.get("clubs_wikipedia", {}).items() if not k.startswith("_")}
    wiki_qids: dict[str, str] = {}  # élément Wikidata -> id club dans le script
    if wiki_clubs and use_wikidata:
        titles = {v["article"]: (name, v["championnat"]) for name, v in wiki_clubs.items()}
        try:
            rows = sparql(QUERY_CLUBS_BY_ARTICLE.format(values=" ".join(json.dumps(t) + "@en" for t in titles)))
        except Exception as e:
            rows = []
            log.append(f"! Wikidata inaccessible pour les promus ({e})")
        found = set()
        for b in rows:
            title, qid = b["title"]["value"], b["club"]["value"].rsplit("/", 1)[-1]
            name, league = titles[title]
            cid = b.get("clubTm", {}).get("value") or f"wd:{qid}"
            names[cid], club_league[cid], wiki_qids[qid] = name, league, cid
            promoted.add(cid)
            found.add(title)
        for title in titles.keys() - found:
            log.append(f"! article Wikipédia introuvable : « {title} » (vérifie le titre exact sur en.wikipedia.org)")

    # 3. base Transfermarkt (les promus n'ont souvent pas joué en 1re division : on est plus souple)
    current = {}
    for pid, r in by_id.items():
        cid, last = r.get("current_club_id"), r.get("last_season") or "0"
        if league_of(cid) and (last == str(season) or (cid in promoted and int(last) >= season - 3)):
            current[pid] = cid

    # 4. transferts récents via Wikidata
    moves: dict[str, tuple[str, str]] = {}
    if use_wikidata:
        try:
            moves = wikidata_moves({p for p in current if p.isdigit()}, {c for c in club_league if c.isdigit()})
        except Exception as e:  # Wikidata indisponible : on continue avec la base
            moves = {}
            log.append(f"! Wikidata inaccessible ({e}), transferts récents non appliqués")
        for pid, (cid, start) in sorted(moves.items(), key=lambda kv: kv[1][1]):
            old = current.get(pid)
            if cid == old:
                continue
            if pid not in by_id:
                continue  # jeune joueur absent du dataset : ni nationalité ni poste connus
            name, when = by_id[pid]["name"], start[:10]
            old_name = display(old) if old else "hors 5 championnats"
            if league_of(cid):
                current[pid] = cid
                log.append(f"+ {name} : {old_name} -> {display(cid)} ({when})")
            elif cid in names and old:
                del current[pid]
                log.append(f"- {name} : {old_name} -> {display(cid)}, retiré ({when})")
            elif old:
                log.append(f"? {name} ({old_name}) : nouveau club inconnu (club TM {cid}, {when}), ajoute-le à departs si confirmé")

    # 4b. effectifs des promus via Wikidata
    extra: dict[str, dict] = {}  # joueurs absents du dataset
    if wiki_qids:
        try:
            rows = sparql(QUERY_SQUAD.format(values=" ".join(f"wd:{q}" for q in wiki_qids)))
        except Exception as e:
            rows = []
            log.append(f"! effectifs des promus non récupérés ({e})")
        added: dict[str, int] = {}
        for b in rows:
            cid = wiki_qids[b["club"]["value"].rsplit("/", 1)[-1]]
            tm, start = b.get("tm", {}).get("value"), b.get("start", {}).get("value", "")
            if tm and tm in moves and moves[tm][0] != cid and moves[tm][1] > start:
                continue  # parti depuis
            if tm and tm in by_id:
                current[tm] = cid
            else:
                pos = b.get("pos", {}).get("value")
                if not pos:
                    continue  # poste inconnu : inutilisable dans le jeu
                pid = "wd" + b["p"]["value"].rsplit("/Q", 1)[-1]
                extra[pid] = {"name": b["pLabel"]["value"], "y": int(b["dob"]["value"][:4]),
                              "nat": b.get("natLabel", {}).get("value", "?"), "pos": pos}
                current[pid] = cid
            added[display(cid)] = added.get(display(cid), 0) + 1
        for club, n in sorted(added.items()):
            log.append(f"+ effectif Wikidata : {club} ({n} joueurs)")

    # 5. corrections manuelles
    name_index: dict[str, list[str]] = {}
    for pid, r in by_id.items():
        name_index.setdefault(norm(r["name"]), []).append(pid)

    def find_player(label: str, pid: str | None = None) -> str | None:
        if pid:
            return pid if pid in by_id else None
        hits = name_index.get(norm(label), [])
        hits = [h for h in hits if h in current] or hits
        if len(hits) != 1:
            log.append(f"! joueur « {label} » : {len(hits)} correspondance(s), ajoute \"id\" (id Transfermarkt)")
            return None
        return hits[0]

    for t in overrides.get("transferts", []):
        pid = find_player(t.get("joueur", ""), str(t["id"]) if t.get("id") else None)
        cid = find_club(t.get("club", ""), prefer_in_game=True)
        if not pid or not cid:
            continue
        if not league_of(cid):
            log.append(f"! transfert de {t.get('joueur')} : {display(cid)} n'est pas dans les 5 championnats")
            continue
        current[pid] = cid
        log.append(f"= {by_id[pid]['name']} -> {display(cid)} (manuel)")

    for label in overrides.get("departs", []):
        pid = find_player(label)
        if pid and current.pop(pid, None):
            log.append(f"= {by_id[pid]['name']} retiré (manuel)")

    # 6. export
    out, missing = [], {}
    for pid, cid in current.items():
        if pid in extra:
            e = extra[pid]
            nat_fr, cont = COUNTRIES.get(e["nat"], (e["nat"], "?"))
            if e["nat"] not in COUNTRIES:
                missing[e["nat"]] = missing.get(e["nat"], 0) + 1
            out.append({"id": -int(pid[2:]), "n": e["name"], "c": display(cid), "l": league_of(cid),
                        "nat": nat_fr, "cont": cont, "pos": e["pos"], "y": e["y"], "v": 0, "foot": "", "h": 0})
            continue
        r = by_id[pid]
        dob = r.get("date_of_birth") or ""
        if r.get("position") not in POSITIONS or len(dob) < 4:
            continue
        nat_en = r.get("country_of_citizenship") or "?"
        nat_fr, cont = COUNTRIES.get(nat_en, (nat_en, "?"))
        if nat_en not in COUNTRIES and nat_en != "?":
            missing[nat_en] = missing.get(nat_en, 0) + 1
        out.append({
            "id": int(pid),
            "n": r["name"].strip(),
            "c": display(cid),
            "l": league_of(cid),
            "nat": nat_fr,
            "cont": cont,
            "pos": POSITIONS[r["position"]],
            "y": int(dob[:4]),
            "v": int(float(r.get("market_value_in_eur") or 0)),
            "foot": r.get("foot") or "",
            "h": int(float(r["height_in_cm"])) if r.get("height_in_cm") else 0,
        })

    out.sort(key=lambda p: -p["v"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": datetime.date.today().isoformat(), "players": out},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 7. rapport
    print(f"{len(out)} joueurs écrits dans {OUT} (clubs de base : saison {season}-{season + 1})")
    for league, expected in EXPECTED_CLUBS.items():
        squad: dict[str, int] = {}
        for p in out:
            if p["l"] == league:
                squad[p["c"]] = squad.get(p["c"], 0) + 1
        flag = "" if len(squad) == expected else f"   <- {len(squad)} clubs au lieu de {expected}"
        print(f"  {league:15s} {sum(squad.values()):4d} joueurs, {len(squad)} clubs{flag}")
        small = [f"{c} ({n})" for c, n in sorted(squad.items(), key=lambda kv: kv[1]) if n < 15]
        if flag:
            print("     " + ", ".join(sorted(squad)))
        if small:
            print("     effectifs incomplets : " + ", ".join(small))
    if log:
        print(f"\nChangements et avertissements ({len(log)}) :")
        print("\n".join("  " + line for line in log))
    if missing:
        print("\nPays sans traduction/continent (à ajouter dans COUNTRIES) :")
        for name, count in sorted(missing.items(), key=lambda kv: -kv[1]):
            print(f"  {name} ({count})")


if __name__ == "__main__":
    main()