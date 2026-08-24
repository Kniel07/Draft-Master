# Draft Room — Design Notes

Scope is the drafting assistant and nothing else. No accounts, no chat, no
telemetry, no generative text service. The engineering problem is not the UI —
it is keeping the recommendation logic honest, keeping the game knowledge out of
the code, and keeping the viewport still.

---

## 1. What changed from V1, and why

The previous build had the right concept and four structural problems. Each fix
is architectural rather than a patch, because each symptom had a cause that
would have kept producing symptoms.

| Symptom | Actual cause | Fix |
| --- | --- | --- |
| Five heroes missing | The hero table was hand-maintained and nothing compared it to the real roster | `CANON` in the generator; the file will not write if the table drifts. Plus a runtime merge that adds heroes the live source knows and this build does not |
| The page jumped constantly | `scrollIntoView` on the timeline and `window.scrollTo` on tab switches — but *also* a full re-render on every action, which shrinks the document and lets the browser clamp the scroll offset | Every scroll call removed; targeted rendering with a signature check; `keepScroll` around the one mutation that can still change height; the hero browser moved into a fixed sheet |
| Bans felt compulsory | One list, one visual hierarchy, and the top card was the obvious action | Every row carries its own button, `Ignore` on every row, `Browse all heroes` permanently under the list, and no styling that privileges rank 1 |
| Desktop layout squeezed onto a phone | Designed at 1000px, then adapted | Designed at 360px. The wide layout is what a breakpoint does to the phone design |

Preserved from V1 because it worked: the tag-rule matchup model, the tug-of-war
strength meter, the pre-game brief, the broadcast palette, the one-way data
flow, and `textContent`-only DOM construction.

---

## 2. Architecture

```
data/*.json ──► registry.js ──► validate ──► index (Maps, O(1))
                    ▲                              │
                    │                              ▼
public MLBB API ──► normalizer ──► cache ──► live layer merged on top
                                                   │
                                                   ▼
                          draft-state.js  ──►  engine/  ──►  ui/
                          (one store)          (pure)        (renders)
```

Data flows one way. UI modules never mutate the store; they call an action and
wait to be re-rendered. The engine imports nothing from the store and nothing
from the DOM, which is why `tools/validate-data.mjs` can drive it in Node with
no shims.

The app is fully usable after the bundled JSON loads. The live layer arrives
later, improves numbers and portraits, and can fail without consequence.

```
src/
  app.js                bootstrap, view switching, the one render pass
  api/    mlbb-api      two hosts, failover, timeout, budgeted requests
          normalizer    shape-tolerant extraction from the upstream payload
          cache         namespaced, versioned, TTL'd, degrades to memory
  data/   registry      canonical registry + validation + indexes
          live          decides what the data badge is allowed to claim
  engine/ weights       the single weights object
          counter       what a hero beats and what beats it
          synergy       what it works with
          composition   what a locked set is: strength, need, lanes
          recommendation  pick and ban scoring, with reasons
          ranked        rank awareness: live rates, else the rank curve
          tournament    the sequenced draft: turn, phase, timeline
          strategy      the pre-game brief
  state/  draft-state   one store, both modes
  ui/     dom, hero-selector, draft, recommendations, strength-meter,
          strategy, setup
```

---

## 3. The three decisions that carry the design

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Tag rules with named overrides | A 133×133 counter matrix | ~17,000 cells, mostly empty and unmaintainable. ~35 tag rules give complete coverage; named pairs add precision where it matters. It is also the only version a coach can edit after a patch |
| Live data for *rates only*; counters stay local | Fetching `/counters` per hero | 133 requests against a source that suggests 500/day. Two requests fill a session, and rule-based counters come with written explanations that measured deltas do not |
| Ranked mode is free-form | Mirroring the in-game ranked sequence | You do not control the order in a real lobby. An app that insists on a sequence you cannot follow is an app you close mid-draft |

---

## 4. Recommendation engine

Deterministic. Same state plus same data files gives the same ranking, every
time. Six components, each normalised to 0–100, weighted by one configurable
object, divided by the weight sum.

**Pick**

| Component | Default | What it measures |
| --- | --- | --- |
| Counter | 0.25 | `50 + (applied − risk) / 2` — credit for what it beats, debit for what beats it |
| Meta | 0.20 | Live rank rates when available; otherwise the bundled baseline shaped by the rank curve |
| Synergy | 0.20 | Named pairs and tag pairs against every locked ally |
| Role fit | 0.15 | Fills your selected lane, or an open one |
| Comfort | 0.10 | Your own 1–5 star rating |
| Flexibility | 0.10 | How many lanes it can be drafted into |

Plus a 0.12-weighted *team need* nudge for covering whichever strength dimension
the draft is currently thinnest in.

**Ban** asks a different question — *what does this cost us if it is left open?*
— so it gets its own components: enemy threat, counter risk (what it adds to
their side), rank popularity, comfort risk and flexibility.

The sign on comfort risk is deliberate and was wrong in the first draft of this
rewrite. A hero the **opponent** is known to play raises the ban score. A hero
**you** are comfortable on lowers it, and the card carries a warning, because
banning your own best hero spends a ban denying yourself a pick. Scoring it the
other way round quietly recommends banning the player's own pool.

Comfort's ceiling is its weight, not a special case. At 0.10 a five-star hero
moves a score by at most ten points, which lifts a close call and cannot rescue
a bad matchup. That is the balance the brief asks for and it falls out of the
weighting rather than being bolted on top.

**Explanations are not generated.** Every rule in `counters.json` and
`synergies.json` carries a `reason` string written at the same time as the rule.
The card shows the two highest-weighted reasons; **Why?** opens the rest plus the
actual per-component contributions used for the ranking — the same numbers, not
a retelling. There is no language model in this app.

**Known limit.** The engine reasons about tags and named pairs. It will not
discover a matchup nobody has written down.

---

## 5. Keeping the viewport still

Four mechanisms, because removing the scroll calls only solves a third of it.

1. **No scroll calls.** `scrollIntoView` appears nowhere in the source. The only
   `window.scrollTo` is inside `keepScroll`, restoring a position.
2. **Targeted rendering.** A signature of everything the panels read is compared
   before each pass. Identical signature, no work — which is why a keystroke in
   the hero search costs nothing outside the sheet.
3. **`keepScroll`.** Wraps the mutations that can still change document height.
   Replacing a tall list with a short one lets the browser clamp the scroll
   offset to the shorter page and it does not restore it afterwards.
4. **The sheet is fixed-position** with its own scroll and the body locked
   behind it, so nothing that happens inside it can reach the document.

The one sanctioned scroll is the tournament timeline, moved by assigning
`scrollLeft` on its own overflow container. Assignment cannot propagate to an
ancestor the way `scrollIntoView` does.

A latent bug found during this work belongs here too: `.view { display: flex }`
silently beat the `hidden` attribute, so all three tab panels stayed in the
document. The page was 4281px instead of 1801px and the browser's scroll
anchoring had three times as much to get wrong. `[hidden] { display: none
!important }` is now in `base.css`.

---

## 6. Mobile layout

Designed at 360×800.

```
┌──────────────────────────────┐
│ DRAFTROOM       ● BUNDLED    │  badge is tappable → Setup
│ [Draft] [Brief] [Setup]      │
├──────────────────────────────┤
│ YOUR TEAM              1/5   │
│ BANS ▫ ▫ ▫                   │
│ [◆][2][3][4][5]              │  five tiles across, not five rows
├──────────────────────────────┤
│ ENEMY                  1/5   │
│ BANS ▫ ▫ ▫                   │
│ [◆][2][3][4][5]              │
├──────────────────────────────┤
│ YOUR MOVE  (I'm picking)(ban)│
├──────────────────────────────┤
│ BEST PICKS          · Mythic │
│ 1 ◆ Chou                 63  │
│   · Fills the open EXP slot  │
│   · Peel keeps divers off…   │
│   [PICK] [WHY?] [IGNORE]     │
│ … two more, then:            │
│   [Show 2 more suggestions]  │
│   [Browse all heroes]        │
│ Suggestions only. Pick or    │
│ ban anything you like.       │
├──────────────────────────────┤
│ DRAFT STRENGTH               │
│ Early ████████░░ 70          │
├══════════════════════════════┤
│ YOUR PICK   [ CHOOSE A HERO ]│  fixed to the viewport
└──────────────────────────────┘
```

The board is five tiles across rather than five stacked rows. On a 360px screen
that is the difference between the board taking two thirds of the first screen
and taking a fifth of it — which is the difference between seeing a
recommendation without scrolling and not.

Three suggestions show by default with two reasons each; the rest are one tap
away. Under a draft clock, fifteen bullets across five cards is not a feature.

The bar pinned to the bottom is the only persistent chrome. It exists so the
hero list is always in thumb reach however far down the page you are — the
brief's "easy to access without navigating through a long page", solved without
moving anyone's viewport. It disappears above 1040px, where the recommendation
column sits beside the board and there is nothing left for it to solve.

Touch targets are 44px minimum. Search inputs are 16px so iOS does not zoom the
viewport on focus. `prefers-reduced-motion` disables the timeline pulse.

**Gold is rationed** to one thing per region: the live timeline step, the score,
the win condition. It marks *live right now*. If it appeared on every heading it
would stop meaning anything.

---

## 7. Data resilience

Every one of these was exercised in `tools/ui-test.mjs`:

| Case | Behaviour |
| --- | --- |
| API unreachable | Boots on bundled data, badge reads **Bundled**, everything works |
| API answers, then stops | Cached payload served, badge reads **Cached** with its stored date |
| Record with no name | Dropped and counted; the run continues |
| Duplicate hero in the payload | First wins, rest counted |
| Hero in the API, not in this build | Added as provisional, marked NEW, fully draftable |
| Hero in this build, not in the API | Keeps its bundled meta score; reported in Setup → Data |
| Missing portrait | Generated crest from the hero's initials |
| Missing rates | Falls back to the rank curve, and the Why? panel says which was used |
| `localStorage` blocked | In-memory fallback plus a visible note that settings will not persist |
| Malformed data file | Boot error naming the file and the problem, not a blank screen |

The normalizer does not walk a fixed path into the upstream payload. Those key
names have already changed once (`main_heroid` vs `hero_id`, `appearance_rate`
vs `pick_rate`), and path-based parsing is how an app breaks silently the day
the upstream shifts a field. Each extractor searches the record for a value that
*looks* like what it wants — a numeric hero id, a display name, a rate in 0..1,
an image URL — and reports what it could not find.

---

## 8. Performance

133 heroes, 20 actions. A full scoring pass evaluates every available hero
against every locked hero on both sides — roughly 133 × 10 matchup evaluations,
each an O(tags) map lookup. Indexes are built once at load rather than scanned
per evaluation.

Search is one `indexOf` per hero against a prebuilt slug haystack, debounced at
110ms, and rebuilds only the grid — the input is never recreated, so focus, the
caret and the keyboard survive. The grid is windowed at 60 cards and grows by
appending, so opening the browser never builds 133 nodes at once.

Two network requests per session, both cached. Portraits are `loading="lazy"`.

---

## 9. Verification performed

- **Engine, headless.** A full 20-step MPL draft driven through the real store;
  every step produced a ranked suggestion carrying at least one reason and a
  score breakdown; the brief returned all five sections; undo reversed exactly
  one action.
- **UI under jsdom** — 58 assertions, `tools/ui-test.mjs`. Offline boot; partial
  search ("yuz" → Yu Zhong); picking a hero the engine did not suggest; ignore
  removing one row and committing nothing; Why? opening the real components; the
  ban list; unavailable heroes still findable, struck through and disabled; a
  complete 20-step draft through the real click handlers; the brief; undo and
  clear; and the live path including an unknown hero and a nameless record.
  Scroll instrumentation asserts `scrollIntoView` is never called and the
  viewport never moves.
- **Real browser**, Chromium at 360×800, 390×844 and 412×915: no horizontal
  overflow, no touch target under 32px, no console errors, and `scrollY`
  unchanged across picking, searching and picking again. Wide layout checked at
  768px and 1280px.
- **Data**, `tools/validate-data.mjs`: no duplicate ids, no unknown lanes, no
  matchup row naming a hero that does not exist, every hero reachable by at
  least one counter rule, every tag used by at least one rule, weights resolving.

**Not verified: the live API path against the real service.** The build
environment's egress policy blocks every MLBB API host, so the endpoints,
response shapes and CORS behaviour were established from the project's own
router source and confirmed to be key-free with `allow_origins: ["*"]`, but no
request was made from here. The offline and cached paths are fully exercised,
and the live path is tested against recorded payloads in both the documented
shape and a degraded one. A first real load should be checked with the network
panel open.

Also not verified: the accuracy of the game data itself. That needs a human pass
before it is trusted in a series.

---

## 10. Known limits

| Limit | Severity | Mitigation |
| --- | --- | --- |
| Bundled `meta` and `difficulty` are judgements, not measurements | High | Live rank rates override them when reachable, and the UI always says which is in use |
| No Mythical Immortal bucket in the public source | Medium | Immortal reads Glory data; the rank picker and the data panel both say "approximated" |
| Tag rules can miss a matchup that decides a game | Medium | Named `heroCounters` overrides exist for this; adding one is a two-line JSON edit |
| Lane assignment is greedy, so unusual flex drafts can mis-assign | Low | Surfaced in the lane plan rather than hidden |
| Live counter/compatibility data is fetched only on demand and capped | Low | Deliberate: the rule layer gives complete coverage and the rate limit is real |
| Trusting the tool over the player | Medium | The whole interaction design: every suggestion is one of several, every one is ignorable, and every one shows its working so it can be argued with |
