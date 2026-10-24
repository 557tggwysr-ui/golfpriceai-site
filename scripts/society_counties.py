"""Counties for Find a Society: the list organisers pick from, and the county
pages ("Golf societies in Yorkshire"), built only for counties with at least
three listed golf societies so there are never empty or thin pages."""
import re

COUNTIES = [
    # England (Yorkshire kept whole: it's how golfers search)
    "Bedfordshire", "Berkshire", "Bristol", "Buckinghamshire", "Cambridgeshire", "Cheshire", "Cornwall", "Cumbria",
    "Derbyshire", "Devon", "Dorset", "Durham", "Essex", "Gloucestershire", "Greater London", "Greater Manchester",
    "Hampshire", "Herefordshire", "Hertfordshire", "Isle of Wight", "Kent", "Lancashire", "Leicestershire",
    "Lincolnshire", "Merseyside", "Norfolk", "Northamptonshire", "Northumberland", "Nottinghamshire", "Oxfordshire",
    "Rutland", "Shropshire", "Somerset", "Staffordshire", "Suffolk", "Surrey", "East Sussex", "West Sussex",
    "Tyne and Wear", "Warwickshire", "West Midlands", "Wiltshire", "Worcestershire", "Yorkshire",
    # Scotland
    "Aberdeenshire", "Angus and Dundee", "Ayrshire and Arran", "Dumfries and Galloway", "Edinburgh and the Lothians",
    "Fife", "Glasgow and Clyde", "Highlands and Islands", "Perth and Kinross", "Scottish Borders", "Stirling and Central Scotland",
    # Wales and Northern Ireland
    "North Wales", "Mid Wales", "South Wales", "West Wales", "Northern Ireland",
    # Islands
    "Channel Islands", "Isle of Man",
]
MIN_LISTED = 3


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def known(c):
    return c in COUNTIES
