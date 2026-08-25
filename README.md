# Draft Room — MLBB Draft Assistant

A mobile-first pick-and-ban assistant for Mobile Legends: Bang Bang. Static site,
no build step, no backend, deploys to GitHub Pages from the repository root.

**The app recommends. The player decides.** Nothing in it can pick or ban a hero
for you, and no recommendation can be turned into a requirement — see
[UX rules](#the-rules-the-app-is-built-around).

Two modes share one engine:

| Mode | For | Order |
| --- | --- | --- |
| **Ranked** | Epic → Mythical Immortal | Guided by the real Ranked ruleset — rank decides the ban count (3 / 4 / 5), bans are blind and simultaneous, picks run a snake — while every slot stays directly tappable, because the app is not in your lobby. |
| **Tournament** | MPL / M-Series | The fixed 20-step sequence, with the broadcast timeline. |

---

## Using it

**Setup tab.** Pick the mode. In ranked, set your rank and lane and add comfort
heroes with a 1–5 star rating. In tournament, pick your side and add any heroes
you have scouted the opponent on — that is the single highest-signal input to
ban priority. All of it is optional; the draft board works with none of it set.

**Draft tab.** In ranked, tap a slot to fill it and use *I'm picking* / *I'm
banning* to say what you are about to do. In tournament, the sequence drives the
turn. Either way you get a ranked list of suggestions, each with its own action
button, its own **Ignore**, and a **Why?** that opens the actual weighted
components behind the ranking. **Browse all heroes** is under the list at all
times, and the bar pinned to the bottom of the screen opens the same list from
anywhere on the page.

**Lanes.** Each filled tile shows the lane that hero is playing. Tap the chip to
change it — every lane is offered, including off-role ones. An unconventional
assignment (a tank on EXP, a support in the jungle) is marked *unorthodox* and
then left alone: the app flags it so you can see it, and does not overrule you.
The same control is on each row of the brief's lane plan.

**Brief tab.** Unlocks when both sides have five heroes: win condition,
Turtle/Lord approach, the enemy heroes putting the most pressure on your draft,
a lane plan, and shotcaller reminders. Written to be read in about 30 seconds.

---

## The rules the app is built around

1. The player controls the draft.
2. A recommendation never becomes a requirement.
3. Nothing is ever selected automatically.
4. Nothing is ever banned automatically.
5. You are never forced to choose from the recommendation list.
6. **The page never scrolls itself after a draft action.**
7. Every available hero stays searchable and selectable.
8. Every recommendation explains why.
9. Ranked and tournament share the engine and differ only in workflow.
10. The app stays usable when the public data source is unavailable.

Rule 6 is worth expanding, because it was the loudest complaint about the
previous build. There is no `scrollIntoView` anywhere in the source and no
`window.scrollTo` outside a helper whose only job is to put the viewport *back*
where it was. Removing the scroll calls was necessary but not sufficient: the
old build also jumped because replacing a tall subtree shrinks the document for
an instant, the browser clamps the scroll offset to the shorter page, and it
does not restore it when the content returns. So the render pass is targeted
rather than wholesale, a fingerprint check skips it entirely when nothing
visible changed, and the one mutation that can still change height is wrapped in
`keepScroll`. The hero browser is a fixed-position sheet with its own scroll and
the body locked behind it, so searching cannot move the board underneath.
`tools/ui-test.mjs` asserts all of this, and `mobile` checks in a real browser
confirm `scrollY` is unchanged across a whole draft.

---

## Data

```
data/
  sources/
    mlbb-official-heroes.json   official role, lane and hero id — the source of truth
  heroes.json      canonical hero registry — all 133 heroes
  meta.json        patch info + how live rates become a 0-100 meta score
  counters.json    tag, class and named counter rules
  synergies.json   tag and named synergy rules
  ranks.json       rank tiers, their API mapping, and the fallback rank curve
  config.json      lanes, modes, draft formats, weights, strength dimensions
```

No hero, tag, lane or matchup is named anywhere in the JavaScript. A patch
update is a JSON edit.

### Live data

The app pulls from the public [api-mobilelegends](https://github.com/ridwaanhall/api-mobilelegends)
project — free, no key, CORS open. Two interchangeable hosts are tried in order
and the one that answers is promoted for the rest of the session:

```
https://openmlbb.fastapicloud.dev/api
https://mlbb.rone.dev/api
```

It is used for two things: the hero list (names and portrait URLs) and
`/heroes/rank`, which gives pick, ban and win rate for one rank tier. That is
**two requests per session**, cached for 72 and 12 hours respectively — the
project's own guidance is 0–500 requests a day on the standard host, so a
per-hero fetch loop was never an option. Counters and synergy stay rule-based
locally, which is also what gives them complete coverage and a written
explanation for every rule.

The rank buckets the source exposes are `all | epic | legend | mythic | honor |
glory`. There is **no Mythical Immortal bucket**, so selecting Immortal reads
Mythical Glory data and both the rank picker and the data panel say so rather
than presenting it as its own numbers.

The badge in the header is never decorative:

| Badge | Means |
| --- | --- |
| **Live** | Fetched this session from the public source. |
| **Cached** | Served from local storage; the source did not answer. The date shown is when it was stored. |
| **Bundled** | The JSON that shipped with this build. |

When the source is unreachable the app boots normally on bundled data and every
feature keeps working. It is never blank and never blocked.

### Where hero role and lane come from

Not from anyone's memory. `classes`, `lanes` and `apiId` are read from
`data/sources/mlbb-official-heroes.json`, a committed snapshot of the official
hero list. Heroes released after that snapshot sit in the same file under
`manual`, each with the URL that was checked.

`flexLanes` holds the lanes a hero is actually drafted into that the game does
not list — officially Akai is Roam, but Akai jungles. Filters and eligibility
read the union of both, so nothing became harder to find.

`node tools/audit-roles.mjs` re-checks every row against the source and fails on
any disagreement. Run it after editing hero data.

This exists because field testing found Obsidia listed as a Mage/Fighter playing
Mid and EXP when she is a Marksman who plays Gold Lane — and no internal check
could have caught it, because the row was consistent and simply wrong.

### Adding or changing a hero

`data/heroes.json` is hand-editable. For bulk edits use the generator:

```bash
python3 tools/generate-heroes.py
```

The table lives in the script, one row per hero:

```
id | Name | classes | lanes | tags | meta
```

The generator **refuses to write the file** unless the table matches the
canonical roster in `CANON` exactly, in both directions. That is the fix for
heroes going missing: a gap is a build error naming the hero, not a silent
omission. (The previous build was missing Aldous, Cyclops, Harley, Jawhead and
Sun for exactly this reason — nothing checked.)

At runtime the same principle holds from the other end. A hero the live source
knows and this build does not is added as a provisional entry, marked NEW, and
is fully draftable with default ratings. A hero missing a portrait, a stat or a
counter rule is repaired with a default and reported in Setup → Data — it is
never removed from the pool. **No optional field can hide a hero.**

A hero the source *renames* is a different problem, and one the provisional
mechanism cannot solve alone: adding it would produce two entries for one hero.
So an API record is matched to the registry by stable numeric id first (learned
on the first successful load and remembered from then on), exact name or alias
second, and a similarity guard third; only what survives all three becomes a
provisional entry. The guard is deliberately narrow — it is prefix-or-edit-
distance, never plain containment, because `hilda` is a substring of `mathilda`
and those are two different heroes.

### Retuning the recommendations

`data/config.json → weights`. One object, read by everything:

```json
"pick": { "meta": 0.20, "counter": 0.25, "synergy": 0.20,
          "roleFit": 0.15, "comfort": 0.10, "flexibility": 0.10 }
```

Every component is normalised to 0–100 before weighting and the result is
divided by the weight sum, so raising one weight behaves predictably and the
numbers do not have to add to 1.

Comfort is capped by its weight rather than by a special case, which is how a
five-star comfort hero lifts a close call without ever overriding a bad matchup.

### Changing the draft format

`data/config.json → draftFormats.mpl-standard.steps` is the whole 20-action
sequence. Add, remove or reorder entries and the timeline, the slot counts and
the turn banner all follow.

---

## Running and testing

ES modules and `fetch` are blocked on `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

```bash
node tools/validate-data.mjs   # data checks + engine smoke test
node tools/audit-roles.mjs     # role/lane/id against the official snapshot
python3 tools/generate-heroes.py

npm i jsdom && node tools/ui-test.mjs   # 203 assertions against the real UI
```

`tools/ui-test.mjs` includes a nine-case API resilience matrix — unreachable,
rate limited, hanging, stale cache, nameless record, duplicate record, short
roster, new hero, renamed hero — each driven through the real refresh handler
with a scripted network and asserted on what the UI ends up showing.

`tools/ui-test.mjs` is the only thing here with a dependency. Install `jsdom`
anywhere and either run the test from that directory or point `JSDOM_PATH` at
it. Nothing the site itself serves has a dependency.

---

## Deploying

Settings → Pages → Deploy from a branch → `main` / `/ (root)`. There is no build
step. Everything is relative-path, so it works from a project subpath.

---

## Data accuracy

The bundled `meta` scores are a tuned competitive baseline seeded against
Official Server patch 2.1.90, not measured pick-and-ban rates, and `difficulty`
is a judgement call used only by the fallback rank curve. When the public source
is reachable, real rank statistics replace the baseline and the app says so.
When it is not, treat the numbers as a starting point and edit
`data/heroes.json` from your own notes.

`DESIGN.md` covers the architecture, the scoring model and the known limits.
