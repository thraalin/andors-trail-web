# Andor's Trail for the browser

This is Andor's Trail 0.8.18 running in a web browser. It has the same maps, quests, dialogue, items, monsters and rules as the Android release, with a touch interface for phones. It also works with a mouse and keyboard on a computer.

The whole game is a static website: plain HTML, JavaScript, JSON and PNG files. There is no server code, database or build step needed to host it.

## Hosting it

1. Upload the contents of this folder (the folder that holds `index.html`) to any web host. That can be your own web server, a subfolder of andorstrail.com, GitHub Pages, Cloudflare Pages or Netlify.
2. Serve it over **HTTPS**. Phones only offer the full-screen "Add to Home Screen" app mode on secure sites.
3. Open `index.html` through the web server. Opening the file straight from disk (`file://`) won't work, because browsers block the game's data requests from local files.

The site can live in a subfolder (for example `https://andorstrail.com/play/`), because every path is relative.

### Server settings worth checking

- **File types.** Most servers already send the right types. If yours doesn't, set `.js` → `text/javascript`, `.json` → `application/json` and `.webmanifest` → `application/manifest+json`.
- **Compression.** Turn on gzip or Brotli for `.json` and `.js`. `data/content.json` is 8 MB uncompressed but about 1.3 MB gzipped, and it is the main download on first visit.
- **Caching.** `data/` and `js/` can be cached by browsers. After an update, either set a short cache time or rename the folder, so players get the new files.

### Size

The site is about 33 MB in total, but players only download what they need:

| Part | Size | Notes |
|---|---|---|
| `data/content.json` | 8 MB (≈1.3 MB gzipped) | Loaded on start |
| `data/layers/*.json` | 3.5 MB | Map layers, fetched as the player reaches new areas |
| `data/img/` | ≈21 MB | Tilesets, fetched only when a map or icon needs them |

## Playing

- **Walking:** tap a spot to walk there, or press and hold to keep walking towards your finger. On-screen arrow buttons can be switched on from Menu or Preferences. On a computer, the arrow keys, WASD and the number keys work.
- **Talking and fighting:** walk into people to talk to them and into monsters to fight. In combat, use the Attack, End turn and Flee buttons, or tap enemies next to you.
- **Bottom toolbar:** Hero, Items, Quests, World map and Menu (save, load, preferences).
- **Phones:** "Add to Home Screen" (Safari's Share menu on iPhone, or the browser menu on Android) installs it as a full-screen app with its own icon.

### Saves

Saves are stored in the player's browser (`localStorage`) on that device, under keys starting with `andorstrail.`. Slot 0 is the autosave, written when the page is hidden or closed. **Menu → Save game** offers extra slots, and each slot can be deleted. The Save and Load screens can also **save the autosave to a file** and **load a save from a file**, so players can back up a save or move it to another device. Copying and pasting the save as text works too. Saves don't move between websites (each domain has its own storage), and Android `.sav` files can't be imported.

## What's in this folder

```
index.html              the page: layout, styles, start screen
manifest.webmanifest    home-screen app settings
icons/                  app and home-screen icons
fonts/                  Alegreya SC and Alegreya Sans (SIL OFL, see fonts/OFL.txt)
js/
  util.js, model.js     ports of the Android model classes (actors, items, maps, quests…)
  context.js            world/controller setup, preferences, save games
  strings.js            Android string resources and format strings
  controller/           one file per Android controller (combat, movement, conversation…)
  resource/             resource loading, tile manager, tileset table
  ui/                   the browser interface: map view, HUD, all screens and dialogs
data/
  content.json          game content converted from AndorsTrail/res (items, monsters,
                        conversations, quests, maps, strings, world map)
  layers/NN.json        map tile layers (zlib + base64), split into chunks
  img/                  the game's tileset PNGs, unchanged
tools/
  build_content.py      converts an Andor's Trail checkout into data/
  make_site.py          assembles this folder from the working copy
  test_headless.mjs     engine test in Node (new game, dialogue, combat, save/load)
LICENSE                 GNU GPL v2
CREDITS.md              authors, contributors, graphics credits and licences
```

## Updating to a new game release

The game logic in `js/` is a line-by-line port of the Java code, and all game content is converted from the Android resources. So a new release that only changes content (maps, quests, items, dialogue) just needs `data/` regenerated:

```sh
git clone https://github.com/AndorsTrailRelease/andors-trail
python3 tools/build_content.py andors-trail/AndorsTrail/res      # rewrites data/
node tools/test_headless.mjs                                     # quick engine check
```

`build_content.py` reads `values/loadresources.xml` to find every content file, the map list and the tilesets, the same way the Android loader does. Releases that change game code (combat rules, new script effects, new requirement types) also need the matching change in `js/controller/` or `js/model.js`. The Java class names are kept, so each change maps to an obvious place.

`tools/make_site.py` rebuilds this deployable folder from a working copy. Put the Google Fonts `ofl/alegreyasc` and `ofl/alegreyasans` folders next to it to keep the fonts self-hosted.

## Differences from the Android app

- **English only.** The translations under `values-xx/` aren't converted yet. `build_content.py` is the place to add them, along with a language setting.
- **Touch controls are designed for the browser.** Tap or hold to move, a button bar for combat, and optional arrow buttons. The Android-only display and input preferences are left out.
- **Simpler world map.** It draws the maps you have visited in the current region, with place names and your position.
- **Different save storage.** Saves live in browser storage, as described above.

## Licence

The code in `js/` and `tools/` is a port of the GPL v2 Android code and is released under the **GNU General Public License v2** (`LICENSE`). Game content and graphics are covered by the Andor's Trail project's own terms: content is copyright its authors and licensed for use in Andor's Trail, and graphics are under the licences and permissions listed in `CREDITS.md`.
