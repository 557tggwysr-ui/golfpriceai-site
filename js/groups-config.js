// Shared group definitions for the Apparel and Accessories hub pages.
// "types" values match each product's "icon" field in products.json.
window.GOLFPRICE_GROUPS = {
  accessories: [
    {
      key: "gps-watch",
      label: "GPS Watches",
      blurb: "Distances, hazards, shot tracking — all on your wrist.",
      image: "assets/photos/gps-watch-hub.jpg",
      types: ["gps-watch"]
    },
    {
      key: "rangefinder",
      label: "Rangefinders",
      blurb: "Lock on. Know more. Play with confidence.",
      image: "assets/photos/rangefinder-hub.jpg",
      types: ["rangefinder"]
    },
    {
      key: "sensor",
      label: "Smart Sensors",
      blurb: "Data that drives real improvement.",
      image: "assets/photos/sensor-hub.jpg",
      types: ["sensor"]
    },
    {
      key: "pushcart",
      label: "Push Carts",
      blurb: "Lightweight, stable, built for every round.",
      image: "assets/photos/pushcart.jpg",
      types: ["pushcart"]
    },
    {
      key: "headcover",
      label: "Headcovers",
      blurb: "Protect your clubs, show your style.",
      image: "assets/photos/headcover.jpg",
      types: ["headcover"]
    },
    {
      key: "umbrella",
      label: "Umbrellas",
      blurb: "Because the forecast lied again.",
      image: "assets/photos/umbrella-closed-oncart.jpg",
      types: ["umbrella"]
    },
    {
      key: "gloves",
      label: "Gloves",
      blurb: "Grip it, don't slip it.",
      image: "assets/photos/glove-pair-ongrass.jpg",
      types: ["glove"]
    },
    {
      key: "tees",
      label: "Tees",
      blurb: "The one piece of gear you'll actually lose, not break.",
      image: "assets/photos/tee-ongrass.jpg",
      types: ["tee"]
    },
    {
      key: "grips",
      label: "Grips",
      blurb: "Fresh grips, fewer excuses.",
      image: "assets/photos/grips-ongrass.jpg",
      types: ["grip"]
    },
    {
      key: "towels",
      label: "Towels",
      blurb: "For clean clubs and questionable sweat management.",
      image: "assets/photos/towel-oncart.jpg",
      types: ["towel"]
    },
    {
      key: "essentials",
      label: "Divot Tools",
      blurb: "Small gear, big difference.",
      image: "assets/photos/umbrella-open-oncart.jpg",
      types: ["divot-tool", "accessories"]
    },
    {
      key: "ball-bags",
      label: "Ball Bags",
      blurb: "For keeping your balls together.",
      image: "assets/photos/ballbag-with-balls.jpg",
      types: ["ball-bag"]
    },
    {
      key: "ball-retrievers",
      label: "Ball Retrievers",
      blurb: "For the ones that didn't quite make it.",
      image: "assets/photos/ball-retriever-ongrass.jpg",
      types: ["ball-retriever"]
    }
    // Alignment Sticks, Caddie & Shagger Sets, and Launch Monitors &
    // Simulators are deliberately not shown as hub tiles yet — no real
    // matching photo exists for them (site policy: never an icon, never a
    // mismatched photo). Products in these types are still correctly
    // tagged and reachable via the Shop page's Product Type filter; they
    // just don't have a dedicated homepage tile until real photos come in.
  ],
  apparel: [
    {
      key: "polo",
      label: "Polo Tees",
      blurb: "The classic golf polo — smart enough for the clubhouse.",
      image: "assets/photos/polo.png",
      types: ["polo"]
    },
    {
      key: "bottoms",
      label: "Bottoms",
      blurb: "Tailored trousers for every round.",
      image: "assets/photos/bottoms.png",
      types: ["trousers"]
    },
    {
      key: "shorts-skort",
      label: "Shorts & Skorts",
      blurb: "For the first sunny day of the year (however brief that turns out to be).",
      image: "assets/photos/shorts-skort.png",
      types: ["shorts", "skort"]
    },
    {
      key: "outerwear",
      label: "Outerwear",
      blurb: "Jackets, hoodies and base layers for four-seasons-in-one-round days.",
      image: "assets/photos/outerwear.png",
      types: ["jacket", "hoodie", "base-layer"]
    },
    {
      key: "headwear",
      label: "Headwear & Extras",
      blurb: "Caps, sunglasses, belts and socks — the finishing touches.",
      image: "assets/photos/headwear.png",
      types: ["cap", "sunglasses", "belt", "socks"]
    }
    // Golf Dresses and Golf Suits are deliberately not shown as hub tiles
    // yet — no real matching photo exists (site policy: never an icon,
    // never a mismatched photo). Products are still correctly tagged and
    // reachable via the Shop page's Product Type filter.
  ]
};
