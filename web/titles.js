// ============================================================================
// Magic City Culture — famous-titles backdrop (web/titles.js)
//
// A fixed layer of iconic Marvel and DC comic TITLE NAMES rendered as
// pure text in the site's masthead lettering (Archivo Black), scattered
// across the whole viewport behind the page content, above Joshua's
// faded logo artwork. It whispers — the layer sits at 7% opacity — so
// cards, text and forms read exactly as before.
//
// TEXT ONLY, by design: no official logos, symbols, emblems or images
// of any kind — just the famous names in comic lettering, the same
// treatment the masthead gives "MAGIC CITY CULTURE".
//
// Layout is deterministic: each title carries its centre point (x/y in
// percent of the viewport), a size class (s/m/l/xl, viewport-scaled in
// styles.css), a slight rotation (-6°..+6°) and a tone (pink / blue /
// white — the site's neon palette, balanced 8/8/8). Long titles bleed
// off the edges on narrow screens; the layer clips them
// (overflow: hidden), which is part of the collage look, and the layer
// is pointer-events: none, so it can never intercept a tap.
//
// Loaded by index.html right after logo.js; renders immediately into
// #titles-backdrop (which index.html places directly after
// #site-backdrop, so with both at z-index 0 the titles paint above the
// artwork and below the z-index 1 content). If the container is
// missing the script quietly does nothing.
// ============================================================================

window.MCC_TITLES = [
  // --- top band ---
  { t: "AVENGERS",           x: 17, y: 6,  s: "xl", r: -4, c: "pink"  },
  { t: "GUARDIANS OF THE GALAXY", x: 55, y: 4, s: "s", r: 2,  c: "white" },
  { t: "BATMAN",             x: 84, y: 7,  s: "l",  r: 3,  c: "blue"  },
  // --- upper band ---
  { t: "SPIDER-MAN",         x: 33, y: 19, s: "xl", r: 2,  c: "blue"  },
  { t: "WONDER WOMAN",       x: 71, y: 20, s: "m",  r: -3, c: "pink"  },
  { t: "X-MEN",              x: 91, y: 21, s: "l",  r: -6, c: "white" },
  { t: "SUICIDE SQUAD",      x: 9,  y: 30, s: "s",  r: 6,  c: "pink"  },
  // --- upper-middle band ---
  { t: "JUSTICE LEAGUE",     x: 24, y: 35, s: "l",  r: -2, c: "blue"  },
  { t: "HULK",               x: 58, y: 36, s: "xl", r: 6,  c: "pink"  },
  { t: "THOR",               x: 95, y: 34, s: "m",  r: 5,  c: "white" },
  // --- middle band ---
  { t: "THE FLASH",          x: 86, y: 47, s: "m",  r: -5, c: "white" },
  { t: "IRON MAN",           x: 13, y: 50, s: "l",  r: 4,  c: "white" },
  { t: "SUPERMAN",           x: 47, y: 52, s: "xl", r: -3, c: "pink"  },
  { t: "SHAZAM",             x: 93, y: 60, s: "s",  r: -6, c: "blue"  },
  // --- lower-middle band ---
  { t: "DEADPOOL",           x: 8,  y: 65, s: "m",  r: 5,  c: "pink"  },
  { t: "FANTASTIC FOUR",     x: 27, y: 66, s: "m",  r: -6, c: "white" },
  { t: "DAREDEVIL",          x: 72, y: 64, s: "m",  r: 2,  c: "blue"  },
  // --- lower band ---
  { t: "WOLVERINE",          x: 14, y: 82, s: "l",  r: 2,  c: "blue"  },
  { t: "BLACK PANTHER",      x: 55, y: 78, s: "l",  r: 3,  c: "blue"  },
  { t: "AQUAMAN",            x: 90, y: 78, s: "m",  r: -4, c: "pink"  },
  // --- bottom band ---
  { t: "GREEN LANTERN",      x: 42, y: 90, s: "m",  r: -2, c: "white" },
  { t: "CAPTAIN AMERICA",    x: 28, y: 94, s: "m",  r: -3, c: "blue"  },
  { t: "TEEN TITANS",        x: 63, y: 93, s: "m",  r: 4,  c: "white" },
  { t: "DOCTOR STRANGE",     x: 88, y: 92, s: "s",  r: -5, c: "pink"  },
];

(function renderTitlesBackdrop() {
  const layer = document.getElementById("titles-backdrop");
  if (!layer || !Array.isArray(window.MCC_TITLES)) return;
  const frag = document.createDocumentFragment();
  for (const item of window.MCC_TITLES) {
    const span = document.createElement("span");
    span.className = `tb-title tb-${item.s} tb-${item.c}`;
    span.textContent = item.t;
    span.style.left = `${item.x}%`;
    span.style.top = `${item.y}%`;
    span.style.transform = `translate(-50%, -50%) rotate(${item.r}deg)`;
    frag.appendChild(span);
  }
  layer.appendChild(frag);
})();
