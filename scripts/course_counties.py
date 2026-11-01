"""Which county each UK golf course is in, for the county pages
("Golf societies in Yorkshire").

The course list (data/courses/uk.json, from OpenStreetMap) has each course's
position but not its county. Once per course, its position is looked up with
postcodes.io (free, open UK postcode data: Office for National Statistics,
Royal Mail and Ordnance Survey under the Open Government Licence), and the
answer is mapped to the counties golfers use in Find a Society
(society_counties.COUNTIES). The answers are kept in data/courses/counties.json,
so each course is only ever looked up once. If the service can't be reached,
the build carries on with what it already knows.
"""
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "courses"
OUT = DATA / "counties.json"
API = "https://api.postcodes.io/postcodes"

# England: two-tier counties come back as admin_county; the rest are unitary
# councils (admin_district), mapped here to the county golfers would say.
ENGLAND_DISTRICTS = {
    # Greater London is matched on the region; these are the metropolitan areas and unitaries.
    **{d: "Greater Manchester" for d in ["Manchester", "Salford", "Trafford", "Stockport", "Tameside", "Oldham", "Rochdale", "Bury", "Bolton", "Wigan"]},
    **{d: "Merseyside" for d in ["Liverpool", "Sefton", "Knowsley", "St. Helens", "St Helens", "Wirral"]},
    **{d: "Tyne and Wear" for d in ["Newcastle upon Tyne", "Gateshead", "North Tyneside", "South Tyneside", "Sunderland"]},
    **{d: "West Midlands" for d in ["Birmingham", "Coventry", "Dudley", "Sandwell", "Solihull", "Walsall", "Wolverhampton"]},
    **{d: "Durham" for d in ["County Durham", "Darlington", "Hartlepool", "Stockton-on-Tees", "Middlesbrough", "Redcar and Cleveland"]},
    **{d: "Cheshire" for d in ["Cheshire East", "Cheshire West and Chester", "Halton", "Warrington"]},
    **{d: "Lancashire" for d in ["Blackpool", "Blackburn with Darwen"]},
    **{d: "Cumbria" for d in ["Cumberland", "Westmorland and Furness"]},
    "Northumberland": "Northumberland",
    **{d: "Lincolnshire" for d in ["North Lincolnshire", "North East Lincolnshire"]},
    **{d: "Derbyshire" for d in ["Derby"]},
    **{d: "Nottinghamshire" for d in ["Nottingham"]},
    **{d: "Leicestershire" for d in ["Leicester"]},
    "Rutland": "Rutland",
    **{d: "Northamptonshire" for d in ["North Northamptonshire", "West Northamptonshire"]},
    **{d: "Staffordshire" for d in ["Stoke-on-Trent"]},
    **{d: "Shropshire" for d in ["Shropshire", "Telford and Wrekin"]},
    "Herefordshire, County of": "Herefordshire", "Herefordshire": "Herefordshire",
    **{d: "Bedfordshire" for d in ["Bedford", "Central Bedfordshire", "Luton"]},
    **{d: "Cambridgeshire" for d in ["Peterborough"]},
    **{d: "Buckinghamshire" for d in ["Buckinghamshire", "Milton Keynes"]},
    **{d: "Berkshire" for d in ["Reading", "West Berkshire", "Wokingham", "Bracknell Forest", "Windsor and Maidenhead", "Slough"]},
    **{d: "Essex" for d in ["Southend-on-Sea", "Thurrock"]},
    **{d: "Kent" for d in ["Medway"]},
    **{d: "East Sussex" for d in ["Brighton and Hove"]},
    **{d: "Hampshire" for d in ["Portsmouth", "Southampton"]},
    "Isle of Wight": "Isle of Wight",
    **{d: "Dorset" for d in ["Dorset", "Bournemouth, Christchurch and Poole"]},
    **{d: "Wiltshire" for d in ["Wiltshire", "Swindon"]},
    **{d: "Somerset" for d in ["Somerset", "Bath and North East Somerset", "North Somerset"]},
    "Bristol, City of": "Bristol", "Bristol": "Bristol",
    **{d: "Gloucestershire" for d in ["South Gloucestershire"]},
    **{d: "Devon" for d in ["Plymouth", "Torbay"]},
    **{d: "Cornwall" for d in ["Cornwall", "Isles of Scilly"]},
}
ENGLAND_COUNTIES = {  # admin_county names that differ from ours
    "North Yorkshire": "Yorkshire", "West Yorkshire": "Yorkshire", "South Yorkshire": "Yorkshire",
    "East Riding of Yorkshire": "Yorkshire", "Durham": "Durham", "County Durham": "Durham",
}
SCOTLAND = {
    **{d: "Aberdeenshire" for d in ["Aberdeenshire", "Aberdeen City", "Moray"]},
    **{d: "Angus and Dundee" for d in ["Angus", "Dundee City"]},
    **{d: "Ayrshire and Arran" for d in ["North Ayrshire", "South Ayrshire", "East Ayrshire"]},
    "Dumfries and Galloway": "Dumfries and Galloway",
    **{d: "Edinburgh and the Lothians" for d in ["City of Edinburgh", "East Lothian", "Midlothian", "West Lothian"]},
    "Fife": "Fife",
    **{d: "Glasgow and Clyde" for d in ["Glasgow City", "East Dunbartonshire", "West Dunbartonshire", "East Renfrewshire", "Renfrewshire",
                                         "Inverclyde", "North Lanarkshire", "South Lanarkshire", "Argyll and Bute"]},
    **{d: "Highlands and Islands" for d in ["Highland", "Na h-Eileanan Siar", "Orkney Islands", "Shetland Islands"]},
    "Perth and Kinross": "Perth and Kinross",
    "Scottish Borders": "Scottish Borders",
    **{d: "Stirling and Central Scotland" for d in ["Stirling", "Falkirk", "Clackmannanshire"]},
}
WALES = {
    **{d: "North Wales" for d in ["Isle of Anglesey", "Gwynedd", "Conwy", "Denbighshire", "Flintshire", "Wrexham"]},
    **{d: "Mid Wales" for d in ["Powys", "Ceredigion"]},
    **{d: "West Wales" for d in ["Pembrokeshire", "Carmarthenshire", "Swansea", "Neath Port Talbot"]},
    **{d: "South Wales" for d in ["Bridgend", "Vale of Glamorgan", "Cardiff", "Rhondda Cynon Taf", "Merthyr Tydfil", "Caerphilly",
                                   "Blaenau Gwent", "Torfaen", "Monmouthshire", "Newport"]},
}


def county_of(r):
    """Map one postcodes.io result to a Find a Society county (or None)."""
    import society_counties as sc
    if not r:
        return None
    country, region = r.get("country") or "", r.get("region") or ""
    acounty, district = r.get("admin_county") or "", r.get("admin_district") or ""
    if country == "Northern Ireland":
        return "Northern Ireland"
    if country == "Scotland":
        return SCOTLAND.get(district)
    if country == "Wales":
        return WALES.get(district)
    if country != "England":
        return None
    if region == "London":
        return "Greater London"
    if region == "Yorkshire and The Humber" and district not in ("North Lincolnshire", "North East Lincolnshire"):
        return "Yorkshire"
    if acounty:
        c = ENGLAND_COUNTIES.get(acounty, acounty)
        if sc.known(c):
            return c
    c = ENGLAND_DISTRICTS.get(district)
    return c if c and sc.known(c) else None


def _islands(lat, lon):
    if 54.0 <= lat <= 54.45 and -4.9 <= lon <= -4.25:
        return "Isle of Man"
    if 49.15 <= lat <= 49.75 and -2.75 <= lon <= -2.0:
        return "Channel Islands"
    return None


def _lookup(batch):
    body = json.dumps({"geolocations": [{"latitude": c["lat"], "longitude": c["lon"], "radius": 2000, "limit": 1} for c in batch]}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json", "User-Agent": "GolfPriceAI build"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read().decode("utf-8")).get("result") or []
    out = {}
    for c, item in zip(batch, res):
        hits = (item or {}).get("result") or []
        out[c["id"]] = county_of(hits[0]) if hits else None
    return out


def _km(a, b):
    return math.hypot((a["lat"] - b["lat"]) * 111, (a["lon"] - b["lon"]) * 111 * math.cos(math.radians(a["lat"])))


def build(max_lookups=4000):
    """Fill in counties for courses not yet known. Returns {course id: county}."""
    try:
        courses = json.loads((DATA / "uk.json").read_text()).get("courses") or []
    except (OSError, ValueError):
        return {}
    try:
        known = json.loads(OUT.read_text())
    except (OSError, ValueError):
        known = {}
    todo = []
    for c in courses:
        if c["id"] in known:
            continue
        isl = _islands(c["lat"], c["lon"])
        if isl:
            known[c["id"]] = isl
        else:
            todo.append(c)
    looked = 0
    for i in range(0, min(len(todo), max_lookups), 100):
        batch = todo[i:i + 100]
        try:
            got = _lookup(batch)
        except Exception as exc:  # no network, or the service is down: try again next run
            print(f"Course counties: lookup stopped ({exc}); {len(known)} known.")
            break
        for cid, county in got.items():
            # A course with no postcode within 2 km (remote links) is left as "" and
            # placed by its nearest neighbour below.
            known[cid] = county or ""
        looked += len(batch)
    # Courses with no answer: take the county of the nearest course within 15 km.
    placed = [c for c in courses if known.get(c["id"])]
    for c in courses:
        if c["id"] in known and not known[c["id"]] and placed:
            near = min(placed, key=lambda p: _km(c, p))
            if _km(c, near) <= 15:
                known[c["id"]] = "~" + known[near["id"]]
    if looked or not OUT.exists():
        OUT.write_text(json.dumps(known, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    print(f"Course counties: {sum(1 for v in known.values() if v)} of {len(courses)} placed ({looked} looked up this run).")
    return {k: v.lstrip("~") for k, v in known.items() if v}


if __name__ == "__main__":
    build()
