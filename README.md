# Draft Room — MLBB Tournament Drafting Assistant (flat build)

Same app, every file at the repository root. This layout survives GitHub's web
uploader, which flattens folders — use it when you're uploading from a phone.

---

## Fixing the DRAFT-Master- repo

The current repo has files at the root but `index.html` is still looking for
`css/` and `js/`, and the three JSON data files never made it up. Replace what's
there:

1. Open the repo → tick the checkbox next to each existing file → **Delete files**
   → Commit. (Or delete the repo and make a fresh one — faster on mobile.)
2. **Add file → Upload files**, and upload all 20 files from this folder at once.
3. Commit.
4. **Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.**
5. Wait for the green check, then hard-refresh the Pages URL.

### Files that must all be present

```
index.html          styles.css
main.js             data.js         state.js        storage.js
recommender.js      strength.js     strategy-engine.js
render.js           board.js        pool.js         panel.js
roster.js           strategy-view.js
heroes.json         matchups.json   config.json
DESIGN.md           generate_heroes.py
```

If the page loads unstyled with black-on-white serif text, `styles.css` did not
upload. If it sits forever on "Loading hero data…", one of the three `.json`
files is missing.

There were two files named `strategy.js` in the folder build — the engine and the
view. Here they are `strategy-engine.js` and `strategy-view.js`, so neither can
overwrite the other during upload.

---

## Using it

**Roster tab.** Enter the five players per side and tap the heroes each is
comfortable on. Fill in the opponent's list too — it drives ban priority. Saved
in the browser between games.

**Draft tab.** The timeline shows all twenty actions in MPL order; gold is the one
on the clock. Tap **Lock** or **Ban** on a recommendation, or tap any hero in the
pool. Picked and banned heroes grey out. **Undo last** steps back one action.

**Strategy tab.** Unlocks on a complete draft: win condition, Turtle and Lord
approach, the three enemy heroes with the most pressure on your draft, a lane
check, and shotcaller reminders.

---

## Updating for a new patch

No hero, tag or matchup is named anywhere in the JavaScript. A patch update is a
data edit — tap a file on GitHub, hit the pencil icon, commit.

| File | What to change |
| --- | --- |
| `heroes.json` | `patch`, plus each hero's `meta` (0–100 priority), `tags`, `lanes`, `stats` |
| `matchups.json` | counter and synergy rules — tag-level, class-level, named hero pairs |
| `config.json` | draft order, scoring weights, strength dimensions, thresholds |

### Adding a hero

```json
{
  "id": "new-hero",
  "name": "New Hero",
  "classes": ["Mage"],
  "lanes": ["mid"],
  "tags": ["burst", "zoning", "setup"],
  "meta": 74,
  "stats": {
    "early": 68, "late": 78, "damage": 86,
    "survivability": 44, "cc": 66, "push": 58, "coordination": 62
  }
}
```

`id` must be unique — it is what `matchups.json` refers to. The app validates on
load and names the offending row if something does not line up.

### Retuning recommendations

`config.json → weights`. Raise `comfort` for a team that plays better on familiar
heroes; raise `counter` for a team that drafts reactively. Every component is
normalised to 0–100 before weighting, so changes behave predictably.

### Changing the draft format

`config.json → draftFormat.steps` is the full twenty-action sequence. Add, remove
or reorder entries and the timeline, slot counts and turn banner all follow.

---

## Running it locally

ES modules and `fetch` are blocked on `file://`, so opening `index.html` directly
will not work. Serve the folder:

```bash
python3 -m http.server 8000
```

---

## Hero portraits

No artwork ships with this. Heroes render as generated crests with initials. To
use your own images, upload them and add a `portrait` field pointing at the file:

```json
{ "id": "atlas", "portrait": "atlas.jpg", "...": "..." }
```

Missing files fall back to the crest. Only publish artwork you have rights to.

---

## Data accuracy

The `meta` scores are a tuned baseline seeded against Official Server patch
2.1.90 — not measured tournament pick-and-ban rates. Have your coach pass through
`heroes.json` and set them from your own scrim notes before a real series. The
engine is only as good as those numbers.

`DESIGN.md` covers the architecture, the scoring model and the known risks.
