# Draft Room — Design Specification

Scope is locked to the drafting assistant described in the brief. Nothing below adds a
feature outside it; the work is in making the existing seven features hold up under
tournament conditions.

---

## 1. Executive summary

A static, single-page drafting assistant that mirrors an MPL pick-and-ban and advises the
team on the clock. The engineering problem is not the UI — it is keeping the recommendation
logic honest and keeping the game knowledge out of the code, so a coach can retune the tool
after a patch without touching JavaScript.

Three decisions carry the design:

| Decision | Alternative rejected | Why |
| --- | --- | --- |
| Tag-based matchup rules with named overrides | A full hero-vs-hero counter matrix | 128 heroes means ~16,000 cells. A matrix is unmaintainable and mostly empty. Tags give complete coverage from ~50 rules; named pairs add precision where it matters. |
| Every component normalised to 0–100 before weighting | Raw additive scoring | Weights in `config.json` become meaningful and comparable. A coach can reason about "raise comfort" without re-deriving the whole scale. |
| One state store, views as pure renderers | Per-component local state | Every draft action changes every panel. Central state removes the class of bug where the strength meter and the recommendations disagree about the board. |

---

## 2. Information architecture

```
Draft Room
├── Roster          side toggle → 5 lane cards → player name + comfort heroes
├── Draft           timeline → boards → turn → controls → recommendations
│                   → synergy → strength → hero pool
└── Strategy        side toggle → win condition → objectives → threats
                    → lane check → shotcaller reminders
```

Three destinations, matching the three moments of use: before the draft, during it, and in
the seconds before the match starts.

---

## 3. User flow

```
Set roster ──► (optional) scout enemy comfort ──► Draft tab
                                                     │
        ┌────────────────────────────────────────────┘
        ▼
   read turn banner ──► read top recommendation ──► tap Lock / Ban
        ▲                                                │
        └──────────── state recalculates ◄───────────────┘
                              │
                  20 actions complete
                              ▼
                        Strategy tab
```

Undo is available at every point. The draft can be cleared without losing rosters — the
common case between games of a series.

---

## 4. Wireframe (mobile, 380px)

```
┌──────────────────────────────────────┐
│ DRAFTROOM        Official Server 2.1.90 │
│ [Roster] [ Draft ] [Strategy]        │
├──────────────────────────────────────┤
│ ▸1▸2▸3▸4▸5▸6▸7▸8▸9▸10 …  (scrolls)   │  timeline, gold = live
├─────────────────┬────────────────────┤
│ BLUE SIDE   2/5 │ RED SIDE      1/5  │
│ ▨▨▨▨▨ (bans)    │ ▨▨▨▨▨              │
│ ◆ Atlas   ROAM  │ ◆ Nolan     JUNG   │
│ ◆ Nolan   JUNG  │ ○ Pick 2           │
│ ○ Pick 3        │ ○ Pick 3           │
├─────────────────┴────────────────────┤
│ PICK PHASE 1          BLUE PICK 3    │
├──────────────────────────────────────┤
│ [Undo last] [Clear] [Comfort only]   │
├──────────────────────────────────────┤
│ RECOMMENDED PICKS                    │
│ 1 ◆ Zhuxin                   72 [Lock]│
│   · Layered CC with Atlas            │
│   · Comfort pick for Kairi           │
├──────────────────────────────────────┤
│ DRAFT STRENGTH        Blue 2/5 Red 1/5│
│ 63 ──── EARLY GAME ──── 69           │
│ ▰▰▰▰▱│▰▰▰▰▰▱                        │
├──────────────────────────────────────┤
│ [search] [ALL][ROAM][JUNG][MID]…     │
│ ┌────────┐┌────────┐                 │
│ │◆ Akai  ││◆ Alice │                 │
└──────────────────────────────────────┘
```

Above 1000px the boards move to sticky left and right columns with the panels between them,
which is the broadcast arrangement.

---

## 5. UI layout and design system

Broadcast palette. Deep arena black with side colour bleeding in from the screen edges, so
the two teams read as sides of an arena rather than as two lists.

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#05070c` | Page |
| `--panel` / `--panel-2` / `--raise` | `#0c1018` / `#121826` / `#19212f` | Three surface depths |
| `--blue` / `--red` | `#2f8dff` / `#ff3f5f` | Side identity only |
| `--gold` | `#f2c14e` | Reserved for *live right now*: active timeline step, top recommendation, win condition |
| `--good` | `#38d39f` | Draft complete |

Type pairs Barlow Condensed (all labels, hero names, numbers — condensed uppercase is the
lower-third vernacular of esports broadcast) against Inter for reading text. The reason
lines under each recommendation are the only place with real prose, and they are set in
Inter at 12.5px so they read as annotation rather than chrome.

**Gold is rationed.** It marks exactly one thing per screen region. If gold appeared on
every score and every heading, the live step would stop reading as live.

**Signature element: the tug-of-war strength meter.** Each dimension is a single row with
blue growing leftward from the centre line and red growing rightward, the leading number in
gold. Two independent bar charts would be the default answer and would make the reader do
the comparison; this makes the gap the shape you see first. It is the one place the design
spends its boldness.

Touch targets are 44px minimum. The layout is mobile-first with two breakpoints (620px,
1000px). Keyboard focus is visible, and `prefers-reduced-motion` disables the pulse on the
active timeline step.

---

## 6. UX decisions

| Decision | Reasoning |
| --- | --- |
| Unavailable heroes are shown greyed and struck through, not hidden | A coach scanning for a hero needs to see that it is gone, not fail to find it. Matches the in-game draft screen. |
| Every recommendation carries up to three reasons | An unexplained ranking is not usable under a 50-second draft clock. Reasons are sorted by contribution weight, so the strongest justification is first. |
| Reasons name the specific hero (`vs Khufra`, `with Atlas`) | Generic advice cannot be verified at a glance. |
| Both sides' comfort lists are editable | Enemy comfort is the highest-signal input to ban priority, and teams already scout it. |
| Undo, not a confirmation dialog | Draft input is fast and mistakes are frequent. Confirmations cost more time overall than a single undo. |
| Clearing the draft keeps rosters | Between games of a Bo5 the roster does not change. |
| Strategy tab is locked until the draft completes | A partial brief would be wrong, and being wrong here is worse than being absent. It shows the remaining action count instead. |
| Recommendation cards are tappable to commit directly | The whole point is to reduce the distance between advice and action. |

---

## 7. Component architecture

```
main.js  ── bootstrap, view switching, the one render loop
   │
   ├── data.js ────── fetch → validate → index (Maps for O(1) lookup)
   ├── state.js ───── draft machine + roster; publishes snapshots
   │      └── storage.js  (localStorage, in-memory fallback)
   │
   ├── engine/
   │     recommender.js  counterPoints / synergyPoints → six components → score
   │     strength.js     per-dimension means + synergy bonus on coordination
   │     strategy.js     win condition, objectives, threats, lanes, reminders
   │
   └── ui/
         render.js   el / clear / portrait / meter / toast
         board.js    timeline, boards, turn banner
         pool.js     hero grid, search, filters   (reused by roster.js)
         panel.js    recommendations, synergy, strength
         roster.js   comfort setup
         strategy.js brief
```

Data flows one way: `state` → `render(snapshot)` → DOM. UI modules never mutate state; they
call exported actions and wait to be re-rendered. `heroGrid` is shared between the draft
pool and the comfort picker — the same component with a different click handler and a
different "selected" set.

---

## 8. Recommendation engine

Evaluation order follows the approved specification.

| Step | Component | Range | Notes |
| --- | --- | --- | --- |
| 1 | Availability | hard filter | Picked or banned heroes never enter scoring |
| 2 | Role compatibility | 20 / 90–100 | Fills an open lane, plus a small flex bonus for multi-lane heroes |
| 3 | Counter | 0–100, 50 neutral | `50 + (applied − risk) / 2` — credit for what it beats, debit for what beats it |
| 4 | Synergy | 0–100, 50 with no allies yet | Named pairs plus tag pairs against every locked ally |
| 5 | Comfort | 30 / 100 (40 if no roster set) | Named to the player when the roster has one |
| 6 | Meta | 0–100 | Straight from `heroes.json` |
| — | Composition need | 0–100 | Weighted by which dimensions the draft is currently thinnest in |

Raw matchup points convert to the 0–100 range through a shared `×1.6` scale with clamping,
so a hero that hard-counters two enemies saturates rather than running away with the score.

Ban scoring is a different question — *what hurts us if it is left open* — so it uses its
own weights: enemy comfort, threat against our locked picks plus synergy with their locked
picks, meta priority, and role flexibility.

**Known limitation.** The engine reasons about tags and named pairs, not about hero
mechanics. It will not discover a matchup nobody has written down.

---

## 9. Data schema

`heroes.json` — `{ patch, patchDate, heroes[] }`, each hero `{ id, name, classes[], lanes[],
tags[], meta, stats{early,late,damage,survivability,cc,push,coordination}, portrait? }`.

`matchups.json` — four rule sets, all additive: `tagCounters`, `tagSynergies`,
`classCounters`, `heroCounters`, `heroSynergies`. Every row carries a `weight` and a
`reason`, and the reason string is what the UI displays. Writing a rule and writing the
explanation are the same act, which is what keeps explanations from drifting from logic.

`config.json` — `draftFormat.steps`, `weights.pick`, `weights.ban`, `strength.dimensions`,
`thresholds`.

There is no database. The data files are the schema, and they are validated on load: unknown
lanes, duplicate ids, and matchup rows pointing at heroes that do not exist all produce a
boot error naming the offending row rather than a silent wrong answer.

---

## 10. Folder structure and naming

Directories by responsibility (`engine/` decides, `ui/` draws, `data/` describes).
`camelCase` for JavaScript identifiers, `kebab-case` for hero ids, file names and CSS
classes. CSS follows a block/element/modifier pattern (`.rec__act--ban`, `.tug--edge-blue`)
with state classes prefixed `is-`. Element selectors are avoided in favour of class
selectors so specificity stays flat and sections cannot cancel each other's spacing.

---

## 11. Security

The attack surface is small — no backend, no accounts, no third-party requests except the
Google Fonts stylesheet — but two things still matter:

- **No `innerHTML` anywhere.** Player names are user input and are set with `textContent`.
  A team name containing a `<script>` tag renders as text.
- **Storage is namespaced and defensive.** Everything under `mlbb-draft-room:`, every read
  wrapped in `try/catch`, and stored hero ids re-validated against `heroes.json` on load so
  a hand-edited or stale value cannot break the app.

Data files are same-origin and authored by the team, so they are trusted for content but
still validated for shape.

---

## 12. Performance

128 heroes, 20 draft actions. The full recommendation pass scores every available hero
against every locked hero on both sides — roughly 128 × 10 matchup evaluations, each an
O(tags) map lookup. Measured well under a frame on mobile, so there is no need for
memoisation or virtual scrolling, and adding either would be complexity without benefit.

Indexes are built once at load (`Map` by hero id, by lane, by tag) rather than scanning
arrays per evaluation. Bar widths animate via CSS transition, not JavaScript.

The one real cost is a full re-render of the draft view on every action. At this DOM size it
is imperceptible, and it is what guarantees every panel agrees. If the hero list ever grew
by an order of magnitude, targeted re-rendering would be the first optimisation.

---

## 13. Design risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `meta` scores are estimates, not measured pick-and-ban rates | High | Documented plainly in the README; the file is designed to be overwritten by the coach before real use |
| Tag rules miss a matchup that decides a real game | Medium | Named `heroCounters` overrides exist for exactly this; adding one is a two-line edit |
| New heroes ship mid-tournament and are absent from the data | Medium | Adding a hero is one JSON object; validation catches mistakes at boot |
| Lane assignment is greedy, so unusual flex drafts can mis-assign | Low | Surfaced in the Lane check block with an explicit role-conflict warning rather than hidden |
| Coordination bonus saturating and flattening the meter | Low | Divisor tuned so full drafts land in the 70s–80s rather than all reading 95+ |
| Trusting the tool over the coach | Medium | Every recommendation shows its reasoning so it can be argued with; the tool ranks, the coach decides |

---

## 14. Acceptance criteria

1. Deploys to GitHub Pages from repository root with no build step, and works from a
   project subpath.
2. Draft follows the configured 20-step MPL order; the timeline shows the live step and the
   turn banner names the side and action.
3. A hero picked or banned by either side cannot be selected again and is visibly out.
4. Recommendations recalculate after every action and each carries at least one specific
   reason.
5. Ban recommendations rank by threat, and a hero on the opponent's comfort list ranks above
   an equivalent hero that is not.
6. Comfort picks persist across a reload and name the player in the recommendation reason.
7. A synergy suggestion appears after each pick, naming the pair and the reason.
8. All seven strength dimensions update live for both sides.
9. The pre-game brief unlocks only on a complete draft and returns all five sections.
10. The lane check flags any uncovered lane or role conflict.
11. Undo reverses exactly one action; clearing the draft preserves rosters.
12. Every interactive target is at least 44px; the layout is usable at 360px wide.
13. A malformed data file produces a boot error naming the problem, not a blank screen.

---

## 15. Verification performed

- Engine driven through a full 20-step draft headlessly; every step produced a ranked
  recommendation with a reason, the brief generated all five sections, undo and reset
  behaved.
- Full UI rendered and interacted with under jsdom: 20 timeline chips, 128 pool cards,
  5 recommendation cards, recommendation click committing through the real handler, search
  and role filters, comfort toggle through the roster picker, and 20 heroes marked
  unavailable after a complete draft. No console errors.
- Data files validated: no duplicate ids, no unknown lanes, no matchup row referencing a
  hero that does not exist.

Not verified: rendering in a real mobile browser, and the accuracy of the game data itself.
Both need a human pass before a live series.
