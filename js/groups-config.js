// Shared group definitions for the Apparel and Accessories hub pages.
// "types" values match each product's "icon" field in products.json.
//
// "emoji" is a small decorative badge rendered by hub.js ON TOP OF the
// group's real photo (matching the site's existing dark-banner emoji
// pattern) — it is never a substitute for a photo. Every group here has a
// real "image"; a group with no photo is simply not shown (see hub.js).
//
// A group can optionally set "category" to link somewhere other than its
// own hub's category — used for Golf Balls below, since balls are their
// own real top-level category (like drivers or putters), not an
// accessories sub-type, even though the tile lives on the Accessories page.
window.GOLFPRICE_GROUPS = {
  clubs: [
    {
      key: "driver",
      label: "Drivers",
      blurb: "Maximum distance, minimum accuracy — for some of us, anyway.",
      // image: — needs a real photo before this tile will render.
      emoji: "🚀",
      category: "driver",
      types: []
    },
    {
      key: "wood",
      label: "Fairway Woods",
      blurb: "For those rare occasions you're actually on the fairway.",
      // image: — needs a real photo before this tile will render.
      emoji: "🌳",
      category: "wood",
      types: []
    },
    {
      key: "hybrid",
      label: "Hybrids",
      blurb: "The club that apologises for your long irons.",
      // image: — needs a real photo before this tile will render.
      emoji: "🔀",
      category: "hybrid",
      types: []
    },
    {
      key: "irons",
      label: "Irons",
      blurb: "Where most rounds are actually won or lost.",
      // image: — needs a real photo before this tile will render.
      emoji: "⛳",
      category: "irons",
      types: []
    },
    {
      key: "wedge",
      label: "Wedges",
      blurb: "Get up, get down, get bragging rights.",
      // image: — needs a real photo before this tile will render.
      emoji: "🎯",
      category: "wedge",
      types: []
    },
    {
      key: "putter",
      label: "Putters",
      blurb: "The most important club you'll blame the least.",
      // image: — needs a real photo before this tile will render.
      emoji: "🥅",
      category: "putter",
      types: []
    },
    {
      key: "sets",
      label: "Sets",
      blurb: "Everything you need, minus the decision fatigue.",
      // image: — needs a real photo before this tile will render.
      emoji: "📦",
      category: "sets",
      types: []
    }
  ],
  accessories: [
    {
      key: "gps-watch",
      label: "GPS Watches",
      blurb: "Distances, hazards, shot tracking — all on your wrist.",
      image: "assets/photos/gps-watch-real.jpg",
      emoji: "⌚",
      types: ["gps-watch"]
    },
    {
      key: "rangefinder",
      label: "Rangefinders",
      blurb: "Lock on. Know more. Play with confidence.",
      image: "assets/photos/rangefinder-real.jpg",
      emoji: "🔭",
      types: ["rangefinder"]
    },
    {
      key: "sensor",
      label: "Smart Sensors",
      blurb: "Data that drives real improvement.",
      image: "assets/photos/sensor-real.jpg",
      emoji: "📊",
      types: ["sensor"]
    },
    {
      key: "pushcart",
      label: "Push Carts",
      blurb: "Lightweight, stable, built for every round.",
      image: "assets/photos/pushcart-loaded.jpg",
      emoji: "🛒",
      types: ["pushcart"]
    },
    {
      key: "headcover",
      label: "Headcovers",
      blurb: "Protect your clubs, show your style.",
      image: "assets/photos/headcover-inbag.jpg",
      emoji: "🛡️",
      types: ["headcover"]
    },
    {
      key: "umbrella",
      label: "Umbrellas",
      blurb: "Because the forecast lied again.",
      image: "assets/photos/umbrella-closed-oncart.jpg",
      emoji: "☂️",
      types: ["umbrella"]
    },
    {
      key: "gloves",
      label: "Gloves",
      blurb: "Grip it, don't slip it.",
      image: "assets/photos/glove-pair-ongrass.jpg",
      emoji: "🧤",
      types: ["glove"]
    },
    {
      key: "tees",
      label: "Tees",
      blurb: "The one piece of gear you'll actually lose, not break.",
      image: "assets/photos/tee-ongrass.jpg",
      emoji: "📍",
      types: ["tee"]
    },
    {
      key: "grips",
      label: "Grips",
      blurb: "Fresh grips, fewer excuses.",
      image: "assets/photos/grips-ongrass.jpg",
      emoji: "🔧",
      types: ["grip"]
    },
    {
      key: "towels",
      label: "Towels",
      blurb: "For clean clubs and questionable sweat management.",
      image: "assets/photos/towel-oncart.jpg",
      emoji: "🧺",
      types: ["towel"]
    },
    {
      key: "essentials",
      label: "Divot Tools",
      blurb: "Small gear, big difference.",
      image: "assets/photos/divottool-plusball-ongrass.jpg",
      emoji: "🔨",
      types: ["divot-tool", "caddie-shagger", "accessories"]
    },
    {
      key: "ball-bags",
      label: "Ball Bags",
      blurb: "For keeping your balls together.",
      image: "assets/photos/ballbag-with-balls.jpg",
      emoji: "🎒",
      types: ["ball-bag"]
    },
    {
      key: "ball-retrievers",
      label: "Ball Retrievers",
      blurb: "For the ones that didn't quite make it.",
      image: "assets/photos/ball-retriever-ongrass.jpg",
      emoji: "🎣",
      types: ["ball-retriever"]
    },
    {
      key: "alignment-sticks",
      label: "Alignment Sticks",
      blurb: "For the practice you'll do twice a year, ambitiously.",
      image: "assets/photos/alignment-sticks-crossed.jpg",
      emoji: "📏",
      types: ["alignment-sticks"]
    },
    {
      key: "launch-monitors",
      label: "Launch Monitors & Simulators",
      blurb: "Bring the range into the garage.",
      image: "assets/photos/launch-monitor-display.jpg",
      emoji: "📡",
      types: ["launch-monitor"]
    },
    {
      // Balls are their own real top-level category (category: "ball"),
      // not an accessories icon sub-type — the "category" override sends
      // this tile's link to shop.html?category=ball directly, with no
      // "types" filter needed, same as how Drivers/Putters/etc. work.
      key: "balls",
      label: "Golf Balls",
      blurb: "The one thing you'll buy again. And again. And again.",
      // image: — needs a real photo before this tile will render.
      emoji: "⚪",
      category: "ball",
      types: []
    },
    {
      key: "travel",
      label: "Travel",
      blurb: "For getting your clubs there in one piece (mostly).",
      // image: — needs a real photo before this tile will render.
      emoji: "🧳",
      types: ["travel"]
    },
    {
      key: "putting-mats",
      label: "Putting Mats",
      blurb: "Practice your putting without leaving the living room.",
      // image: — needs a real photo before this tile will render.
      emoji: "🟢",
      types: ["mat"]
    }
    // Caddie & Shagger Sets fold into the Divot Tools tile above rather
    // than getting their own — no dedicated image needed for that one.
  ],
  apparel: [
    {
      key: "polo",
      label: "Polo Tees",
      blurb: "The classic golf polo — smart enough for the clubhouse.",
      image: "assets/photos/polo.png",
      emoji: "👕",
      types: ["polo"]
    },
    {
      key: "bottoms",
      label: "Bottoms",
      blurb: "Tailored trousers for every round.",
      image: "assets/photos/bottoms.png",
      emoji: "👖",
      types: ["trousers"]
    },
    {
      key: "shorts-skort",
      label: "Shorts & Skorts",
      blurb: "For the first sunny day of the year (however brief that turns out to be).",
      image: "assets/photos/shorts-skort.png",
      emoji: "🩳",
      types: ["shorts", "skort"]
    },
    {
      key: "outerwear",
      label: "Outerwear",
      blurb: "Jackets, hoodies and base layers for four-seasons-in-one-round days.",
      image: "assets/photos/outerwear.png",
      emoji: "🧥",
      types: ["jacket", "hoodie", "base-layer"]
    },
    {
      key: "headwear",
      label: "Headwear & Extras",
      blurb: "Caps, sunglasses, belts and socks — the finishing touches.",
      image: "assets/photos/headwear.png",
      emoji: "🧢",
      types: ["cap", "sunglasses", "belt", "socks"]
    },
    {
      key: "suit",
      label: "Golf Suits",
      blurb: "For when you've committed to the whole look.",
      image: "assets/photos/golf-suit-winter-group.jpg",
      emoji: "👔",
      types: ["suit"]
    },
    {
      key: "dress",
      label: "Golf Dresses",
      blurb: "Because not every round needs a skort.",
      image: "assets/photos/golf-dress-woman.jpg",
      emoji: "👗",
      types: ["dress"]
    }
  ]
};
