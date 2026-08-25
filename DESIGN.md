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

## 4. Hero knowledge: sourced, not remembered

Field testing found Obsidia in the registry as a **Mage/Fighter playing Mid and
EXP**. She is a **Marksman who plays Gold Lane** — wrong class and wrong lane.

The important part is not the wrong row. It is that nothing could have caught
it. The row was schema-valid. It passed every structural check. It was
internally consistent: the class matched the lane, the lane matched the tags,
the tags matched the stats. A validator that reasons about internal consistency
is exactly the wrong tool, because the data was consistent and false.

Running a class↔lane plausibility check across all 133 heroes returned **zero
flags**. That result is the argument for this section.

### Where the data comes from now

`classes`, `lanes` and `apiId` are read from
`data/sources/mlbb-official-heroes.json` — a vendored snapshot of the official
hero list, scraped from Moonton's own hero page, carrying role, lane and the
official numeric hero id. It is committed rather than fetched so the audit is
reproducible and reviewable, and so a diff shows when it changes.

Diffing the snapshot against the previous authored table found **19 role
disagreements and 34 lane disagreements across 129 heroes** — roughly 15% and
26% of the roster. The four heroes the snapshot predates (Obsidia, Sora, Marcel,
Hirara) were **all four wrong**, which is the shape of the problem: the errors
cluster where authored knowledge is thinnest, and authored knowledge cannot
report its own thinness.

Those four live in the same file under `manual`, each carrying the URL that was
actually checked. The generator and the audit tool both read that file, so there
is one place to correct and one place to review.

### Common lanes and flex lanes

The official classification is narrower than how heroes are drafted: officially
Akai is Roam, but Akai jungles. Discarding that knowledge would make the app
worse; keeping it in `lanes` would make "off-role" meaningless.

So the two are separate, as `lanes` (what the game says) and `flexLanes` (what
the meta adds). Their union is exactly the old `lanes` field, which is why
routing every filter, search and eligibility check through
`hero.playableLanes` reproduces the previous behaviour precisely while making
the canonical half available for display and for provenance.

**No scoring weight, formula or threshold changed in this work.** Recommendations
move only because the inputs are now true.

### The standing gate

`tools/audit-roles.mjs` re-diffs the registry against the snapshot and against
the cited sources for the manual rows, and exits non-zero on any disagreement.
The committed suite asserts the same thing, plus that every hero declares its
`provenance`, that none is left as unverified authored guesswork, and that every
hero carries a unique official id.

Both were mutation-tested: reintroducing the Obsidia row makes the audit report
two mismatches and the suite fail three assertions, rather than passing
regardless.

### What this bought elsewhere

Every hero now carries its official numeric id, so identity resolution matches
on it from the first load instead of having to learn it. The learned-id map
remains as a fallback for heroes the snapshot has not caught up with.

**The limit.** The snapshot is a scrape of a third-party mirror of the official
list, not a first-party feed, and it is a point-in-time capture. It is a
verifiable, inspectable, re-checkable source — which authored recollection was
not — but it is not infallible, and refreshing it is a manual step.

---

## 4a. Lane assignment: what the game says vs what the team decided

Field testing surfaced the failure this section exists to prevent. A team put
Kaja on Roam and Belerick on EXP — both canonically Roam-only, both intentional.
The brief reported *"EXP — not covered"* and flagged Kaja as having no free
lane. The draft was fine; the app was wrong about it.

The cause was conflating three separate things:

| | What it is | Authority |
| --- | --- | --- |
| Hero's known roles | What the data says this hero normally plays | Informs |
| Lane assignment | What the team decided it is playing **this game** | **Decides** |
| Recommendation | What the app thinks would be optimal | Advises |

`assignLanes` now resolves in that order: explicit assignments claim their lane
first, orthodox or not; natural fit fills the rest least-flexible-first; and
anything still unplaced goes into whatever lane is free, because a hero on the
board is playing *somewhere*. A lane comes back empty only when there are fewer
heroes than lanes — that is, the draft is unfinished. An unusual pairing is
reported as unorthodox, which is information. It is never reported as invalid.

The same function serves the board tile, the brief and role-fit scoring, so all
three agree about who is playing what. `state.laneAssignments` is a plain
heroId → laneId map, cleared when the hero leaves the board and when the draft
resets, and never written by anything except the player.

This matters beyond the brief. Any later feature that reasons about who plays
where — a teammate roster, for instance — would inherit the same wrong answer,
and a player's preferred role must never become a hard constraint on where their
team can put them.

**Unusual is not invalid.** The app may say a pairing is unconventional. It may
not overrule it, move the hero back, or treat the draft as broken.

## 4b. Ranked is a ruleset, not a blank board

Field testing found Ranked harder to follow than Tournament, and the reason was
structural rather than cosmetic. Tournament answers four questions at a glance —
what phase, whose turn, what action, what next. Ranked answered none of them. It
offered ten slots, six bans regardless of rank, and a pick/ban toggle, and left
the player to work out what the lobby was doing.

The original reasoning — the player does not control the lobby order, so do not
impose one — was half right. It was read as *there is no order*, which is a
different claim and a false one. **Free-form does not mean structure-free.**

### The actual rules

Verified before implementing, rather than assumed from Tournament:

| | |
| --- | --- |
| Bans per team | **3 at Epic, 4 at Legend, 5 at Mythic and above** |
| Ban style | **Blind and simultaneous.** Both teams ban at once; the enemy's are revealed afterwards |
| Pick order | Snake: first-pick side, then two, two, two, two, one |

The blind-ban finding mattered most. Ranked bans are *not* an alternating
sequence, so modelling them like Tournament's would have been wrong in a way
that looked right. It also means there is exactly one window where a ban
recommendation can influence anything — your own bans, before you can see
theirs — so the sequence asks for those first and for the enemy's once the lobby
reveals them.

### Guided, not sequenced

`config.json` marks Ranked `guided: true` and Tournament `sequenced: true`, and
they stay separate rulesets. The guided step is **derived, not stored**: it is
the first step in the sequence whose slot is still empty.

That one decision is what lets structure and freedom coexist. Record something
out of order and the pointer steps over it; clear a slot and the pointer comes
back to it. There is no transition to get stuck in and no state to repair,
because there is no stored position to disagree with the board.

Rank selection now reshapes the board: changing rank resizes both ban strips and
drops anything recorded in a slot that no longer exists, so the draft state
cannot quietly disagree with the rules it claims to follow.

### What it still refuses to know

The app is not in the lobby. It does not model which player holds the current
selection, S1–S5 slot ownership, or the ban-wave timing at Mythic (three
revealed, then two). Who picks first is *observed*, so the player says so in
Setup; nothing else is inferred.

The banner distinguishes a decision from an observation — "Your decision —
suggestions below" against "Recording what they did" — because those are
different jobs and conflating them is what made the free-form board confusing.

**Bans remain advisory.** Every suggestion keeps its own Ignore, browse-all
stays under the list, and the disclaimer stays. Structure was added to the
phase, not to the choice.

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

Each filled tile carries a lane chip showing what that hero is *playing* — not
what its role data says it usually plays — and the chip is a button, because
that assignment is the player's to make. An off-role assignment is tinted and
marked with `!`, never corrected. The same reassignment is reachable from the
brief's lane plan, which is where an unusual pairing actually gets noticed.

The hero sheet does **not** focus its search field on open. Autofocusing raised
the Android keyboard every time, covering half the grid, so the common case —
tap a hero you can already see — started with an obstruction to dismiss. On a
phone, browsing is the default and typing is the exception. A pointer-fine
device has no on-screen keyboard to raise and its user is likely to type, so
there the input still takes focus.

Touch targets are 44px minimum, lane chips included. Search inputs are 16px so
iOS does not zoom the viewport on focus. `prefers-reduced-motion` disables the
timeline pulse.

**Gold is rationed** to one thing per region: the live timeline step, the score,
the win condition. It marks *live right now*. If it appeared on every heading it
would stop meaning anything.

---

## 7. Data resilience

Every row below names **how** it is verified. That column exists because an
earlier draft of this document opened this section with "every one of these was
exercised in `tools/ui-test.mjs`" when three of them were, and the rest had been
checked in throwaway Node runs during development. A verification section that
overstates itself is worse than no verification section, so:

- **matrix** — asserted in the committed API resilience matrix in
  `tools/ui-test.mjs`, driven through the real refresh handler with a scripted
  network, reading the result off the DOM.
- **unit** — asserted in the committed suite by calling the module directly.
- **code only** — handled in the source, no committed assertion.

| Case | Behaviour | Verified |
| --- | --- | --- |
| App starts with no network at all | Boots on bundled data, badge reads **Bundled**, everything works | matrix |
| API unreachable mid-session | Falls back, badge stops claiming live | matrix |
| API rate limits (429) | Tries the next host, then falls back; drafting unaffected | matrix |
| API hangs | `AbortController` ends it; the app never waits on it | matrix |
| API answers, then stops | Stale cached payload served, badge reads **Cached** with its stored date | matrix |
| Record with no name | Dropped and counted; the load continues | matrix |
| Duplicate record in one payload | First wins; the registry does not grow | matrix |
| Fewer heroes than we know about | The rest keep their bundled meta score; the shortfall is reported | matrix |
| Hero in the API, not in this build | Added as provisional, marked NEW, fully draftable | matrix |
| **Hero renamed upstream** | Bound to the existing hero, no duplicate created | matrix + unit |
| Two different heroes with similar names | Never merged (Hilda vs Mathilda is the live case) | unit |
| A remembered id contradicting an exact name | Name wins, id is re-learned, conflict recorded | unit |
| Missing portrait | Generated crest from the hero's initials | code only |
| Missing rates | Falls back to the rank curve; Why? says which was used | code only |
| `localStorage` blocked | In-memory fallback plus a visible note | code only |
| Malformed data file | Boot error naming the file and the problem | code only |

### Identity resolution

The provisional-hero mechanism protects against a hero released after this build
shipped. Its failure mode is that it cannot, alone, distinguish *a hero I have
never seen* from *a hero whose name changed* — and getting that wrong makes the
safety net manufacture the problem it exists to prevent: two entries for one
hero, one carrying the live statistics and one carrying the curated tags.

So `identity.js` resolves in four passes, strongest evidence first, and a hero
can be claimed only once:

1. **Stable numeric id.** Rename-proof. Not in the bundled data — this build has
   never seen a live response, and inventing ids would be worse than having
   none, since a wrong id binds another hero's statistics. They are *learned*
   instead: every match by name records the id it saw, persisted as a setting,
   and every later refresh matches on it first. One successful load makes the
   app rename-proof from then on. `API_IDS` in the generator lets real ids be
   baked in later; those take priority.
2. **Exact name, id or alias**, slug-normalised, so punctuation drift is free.
3. **Similarity guard** against heroes nothing else claimed — prefix match, or
   normalised edit distance ≥ 0.72, and only for names of five characters or
   more.
4. **Provisional.** Genuinely unrecognised, so add it.

The guard is prefix-matching rather than containment specifically because
`hilda` is a substring of `mathilda` and those are two different heroes on the
live roster. Plain containment let an unmatched Hilda row claim Mathilda's slot
and bind her statistics to the wrong hero — the same failure one layer up. The
committed test runs the guard across all 133 registry names pairwise and asserts
zero collisions.

Short names are excluded from the fuzzy path entirely. "Sun" and "Sup" score
0.67 on a ratio that means nothing at three characters, and a false rename is
worse than a false new hero: it binds the wrong statistics to a hero the player
will actually draft.

### Reading the payload

The normalizer does not walk a fixed path into the upstream response. Those key
names have already changed once (`main_heroid` vs `hero_id`, `appearance_rate`
vs `pick_rate`), and path-based parsing is how an app breaks silently the day
the upstream shifts a field. Each extractor searches the record for a value that
*looks* like what it wants — a numeric hero id, a display name, a rate in 0..1,
an image URL — and reports what it could not find.

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

Committed and repeatable:

- **`tools/ui-test.mjs` — 185 assertions**, the real UI under jsdom. Offline
  boot; partial search ("yuz" → Yu Zhong); picking a hero the engine did not
  suggest; ignore removing one row and committing nothing; Why? opening the real
  components; the ban list; unavailable heroes still findable, struck through
  and disabled; a complete 20-step tournament draft through the real click
  handlers; the brief; undo and clear; and the nine-case API resilience matrix
  above, plus both field-test findings: that the sheet does not raise the
  keyboard, and that the exact reported board (Kaja on Roam, Belerick on EXP)
  produces a full lane plan with one unorthodox flag and no missing-lane error.
  Scroll instrumentation asserts `scrollIntoView` is never called and the
  viewport never moves.
- **`tools/validate-data.mjs`** — no duplicate ids, no unknown lanes, no matchup
  row naming a hero that does not exist, every hero reachable by at least one
  counter rule, every tag used by at least one rule, weights resolving, and an
  engine smoke test on an empty board.
- **`tools/generate-heroes.py`** — refuses to write `heroes.json` unless the
  hero table matches the canonical roster exactly, in both directions.
- **`tools/audit-roles.mjs`** — every hero's role, lane and id against the
  vendored official snapshot and the cited sources; exits non-zero on drift.

Run once, by hand, and **not** committed as a repeatable check:

- A full 20-step draft driven headlessly through the store, confirming every
  step produced a ranked suggestion with at least one reason and a breakdown.
- Chromium at 360×800, 390×844 and 412×915: no horizontal overflow, no touch
  target under 32px, no console errors, `scrollY` unchanged across picking,
  searching and picking again. Wide layout at 768px and 1280px.
- Mutation tests on both fixes, confirming the suites fail when the defect is
  reintroduced rather than passing regardless: disabling identity passes 1 and 3
  reproduces the phantom duplicate ("Fanny, Fanny Awakened"), and reverting
  `assignLanes` to greedy-only reproduces the field report verbatim ("EXP Lane
  still to fill / Belerick has nowhere to go").

**Not verified: the live API path against the real service.** The build
environment's egress policy blocks every MLBB API host, so the endpoints,
response shapes and CORS behaviour were established from the project's own
router source — key-free, `allow_origins: ["*"]` — but no request has ever been
made from here. Everything above tests recorded payloads in the documented
shape and in eight degraded ones. A first real load still needs a human with the
network panel open, and the data badge is the diagnostic.

Also not verified: the accuracy of the game data itself, and whether the
drafting workflow feels natural in a real ranked queue. The second of those is
the next gate and no amount of further code changes it.

## 10. Known limits

| Limit | Severity | Mitigation |
| --- | --- | --- |
| Bundled `meta` and `difficulty` are judgements, not measurements | High | Live rank rates override them when reachable, and the UI always says which is in use |
| No Mythical Immortal bucket in the public source | Medium | Immortal reads Glory data; the rank picker and the data panel both say "approximated" |
| Tag rules can miss a matchup that decides a game | Medium | Named `heroCounters` overrides exist for this; adding one is a two-line JSON edit |
| A rename beyond the guard's reach (a hero renamed to something unrecognisable, before any id was learned) still creates a provisional duplicate | Low | Fails in the safe direction — an extra selectable entry, reported in Setup → Data, rather than statistics bound to the wrong hero. One successful load learns the id and closes it permanently |
| Lane assignment is greedy, so unusual flex drafts can mis-assign | Low | Surfaced in the lane plan rather than hidden |
| Live counter/compatibility data is fetched only on demand and capped | Low | Deliberate: the rule layer gives complete coverage and the rate limit is real |
| Lane assignments are per-draft and not persisted | Low | They describe one game. Carrying them into the next draft would be a worse default than re-deriving them |
| Trusting the tool over the player | Medium | The whole interaction design: every suggestion is one of several, every one is ignorable, and every one shows its working so it can be argued with |

---

## 11. Phase B field-test findings

Four findings from real mobile drafts. Each records what was seen, what kind of
problem it turned out to be, and — where it was not fixed — why not.

### B1 · The hero sheet raised the keyboard

**Observation.** Opening Pick/Ban focused the search field, so Android raised the
keyboard over half the grid every time.
**Classification.** Interaction.
**Root cause.** `createSelector.open()` autofocused the input unconditionally.
**Fix.** Focus goes to the sheet panel instead, keeping Escape and screen-reader
announcement. A pointer-fine device has no keyboard to raise and its user is
likely to type, so there the input still takes focus.
**Verification.** Automated (committed suite asserts focus is not the search
field) and manual (Chromium at all three widths: `sheet__panel` on open,
`search` after an explicit tap).

### B2 · Off-role picks reported as missing lanes

**Observation.** Kaja on Roam and Belerick on EXP produced "EXP — not covered"
and a role conflict for Kaja. Both assignments were deliberate.
**Classification.** Draft model.
**Root cause.** Lane coverage was inferred from hero role metadata alone. What a
hero normally plays, what the team decided it is playing, and what the app would
recommend were one concept instead of three.
**Fix.** Explicit assignments are authoritative; the plan places every drafted
hero somewhere; an unusual pairing is reported as unorthodox rather than
invalid. Section 4a.
**Verification.** Automated, including a mutation test that reproduces the
original report verbatim.

### B3 · Ranked draft structure

**Observation.** Ranked was harder to follow than Tournament; ban count did not
respond to rank.
**Classification.** Draft rules — the rules themselves were modelled wrongly.
**Root cause.** Ranked was implemented as a free-form board with a fixed six
bans and no phase concept.
**Fix.** Rank-dependent rulesets, blind-ban ordering, snake picks, and a derived
guided step. Section 4b.
**Verification.** Automated (rank→ban mapping for all six tiers, sequence shape,
rank-switch cleanup, out-of-order recording, Tournament regression) and manual
(Epic/Legend/Mythic ban counts at all three widths).

### B4 · Brief tactical grounding — **traced, not fixed**

Two suspicious outputs. Both were traced to their deterministic source and
**deliberately left in place**, because Phase B is measuring how much authored
knowledge is unreliable and correcting the symptom would destroy the evidence.

**B4a — "Combo to call: Angela into Edith — protection buys the scaling carry
the time it needs"**, on a team with Harith as the more obvious scaling carry.

Not a data error. Both Edith and Harith legitimately carry the `scaling` tag.
Angela+Edith scores 22 against Angela+Harith's 16 because *three* rules fire on
the Edith pair (shield+engage 6, heal+frontline 7, peel+scaling 9) against two
on the Harith pair. The engine is right that Angela+Edith is the strongest
realised pairing.

The defect is in attribution. `shotcallerNotes` renders the pair's single
highest-weighted reason as the explanation, so the sentence asserts "the scaling
carry" — a claim from the +9 rule — when what actually made this pair win was
the +7 frontline-healing rule. The explanation names a reason the choice did not
turn on.

Worth recording alongside it: `peel + scaling` fires on four of the five pairs
in that draft. `peel`, `shield` and `heal` are common tags and so is `scaling`,
so this one rule dominates the combo line across many compositions.

**Classification.** Template attribution, plus a tag-distribution observation.
**Status.** Not fixed. Candidate for THINK review.

**B4b — "Baxia — healing reduction blunts the enemy support's core value"** in
the enemy threat list, which read as a reversed relationship.

The direction is **correct**. Baxia carries `anti-heal`, our Angela carries
`heal`, the rule fires, and the note describes what Baxia does to us.

The defect is the pronoun. Reason strings are authored as standalone rule
descriptions where "enemy" means *the target of the rule*. The threat list
reuses them in a context where "enemy" has already been bound to the opposing
team — so the sentence says "the enemy support" when it means *your* support.
The same string is reused from two opposite perspectives: pick reasons read from
our hero's point of view, threat notes from the enemy hero's.

**Classification.** Reason-string authoring convention — perspective-dependent
text reused in both perspectives.
**Status.** Not fixed. This one is systemic rather than a single bad sentence,
and any fix touches the authored `reason` field on every rule.

