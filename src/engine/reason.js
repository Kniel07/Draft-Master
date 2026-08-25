/**
 * reason.js — reasons as facts, rendered per perspective.
 *
 * Field testing surfaced a sentence in the enemy threat list:
 *
 *   "Baxia — healing reduction blunts the enemy support's core value"
 *
 * The relationship was correct: Baxia carries anti-heal, our Angela carries
 * heal, and the note describes what Baxia does to us. The defect was the
 * pronoun. Reason strings were authored as standalone rule descriptions, where
 * "enemy" means *the hero the rule acts on*. The threat list reuses them in a
 * context where "enemy" already means the opposing team — so the sentence said
 * "the enemy support" while meaning *your* support.
 *
 * The same strings are read from two opposite perspectives: a pick reason looks
 * outward from our hero, a threat note looks inward from theirs. Storing a
 * finished English sentence and reusing it in both is the bug, and editing the
 * Baxia sentence would only have hidden it.
 *
 * So a reason is a fact — who acts, on whom, through what, worth how much — and
 * the sentence is rendered at the point of use, where the perspective is known.
 * The authored text survives as the *mechanism* clause: what the interaction
 * does, with no claim about whose hero is whose.
 *
 * This is also the shape a future tactical layer needs. Handing a model
 * "Baxia — healing reduction blunts the enemy support's core value" asks it to
 * disambiguate a pronoun. Handing it { actor, target, relationship, effect,
 * weight } asks it nothing.
 */

/**
 * @typedef {object} ReasonFact
 * @property {string} actor        hero id the rule is about
 * @property {string} actorName
 * @property {string} target       hero id it acts on or pairs with
 * @property {string} targetName
 * @property {'counter'|'synergy'} relationship
 * @property {string} effect       the trait, class or pair the rule keys on
 * @property {'named'|'tag'|'class'|'measured'} source
 * @property {number} weight       raw contribution, before normalisation
 * @property {string} mechanism    what the interaction does, perspective-free
 */

export function createFact({ actor, target, relationship, effect, source, weight, mechanism }) {
  return {
    actor: actor.id,
    actorName: actor.name,
    target: target.id,
    targetName: target.name,
    relationship,
    effect: effect || null,
    source: source || 'tag',
    weight,
    mechanism
  };
}

/** Sides, from the point of view of the team the reader is drafting for. */
export const OURS = 'ours';
export const THEIRS = 'theirs';

function possessive(side) {
  return side === OURS ? 'your' : 'their';
}

/**
 * A sentence for one fact.
 *
 * @param {ReasonFact} fact
 * @param {object} [options]
 * @param {'ours'|'theirs'} [options.actorSide]  whose hero is doing this
 * @param {boolean} [options.qualifier]          name the other hero (default true)
 * @param {boolean} [options.subject]            lead with the actor's name
 */
export function renderReason(fact, options = {}) {
  const { actorSide = OURS, qualifier = true, subject = false } = options;
  if (!fact) return '';

  // The target always sits on the opposite side to the actor for a counter, and
  // the same side for a synergy. Naming that side explicitly is the whole fix:
  // the reader never has to work out whose hero is being talked about.
  const targetSide =
    fact.relationship === 'counter' ? (actorSide === OURS ? THEIRS : OURS) : actorSide;

  const preposition = fact.relationship === 'counter' ? 'vs' : 'with';
  const tail = qualifier ? ` (${preposition} ${possessive(targetSide)} ${fact.targetName})` : '';
  const head = subject ? `${fact.actorName}: ` : '';
  return `${head}${fact.mechanism}${tail}`;
}

/** The legacy display string, used where perspective is already unambiguous. */
export function reasonText(fact) {
  return renderReason(fact, { actorSide: OURS });
}

function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
}

/**
 * One line describing a synergy pair.
 *
 * The other field-test defect lived here. The brief rendered a pair's single
 * highest-weighted reason as its explanation, so "Angela into Edith" was
 * justified with "protection buys the scaling carry the time it needs" — a
 * claim from one rule, on a pair that won on the sum of three. Angela+Edith
 * scores 22 to Angela+Harith's 16 not because Edith is more of a scaling carry
 * but because three rules fire instead of two. The sentence named a reason the
 * choice did not turn on.
 *
 * So the pair is described by what it actually is: how many effects link it, and
 * the strongest couple of them — never one asserted as decisive.
 */
export function summarisePair(facts, limit = 2) {
  const ranked = facts.slice().sort((a, b) => b.weight - a.weight);
  const parts = ranked.slice(0, limit).map((fact) => lowerFirst(fact.mechanism));
  if (!parts.length) return { count: 0, text: 'complementary kits' };
  return {
    count: ranked.length,
    text: parts.join('; '),
    effects: ranked.map((f) => f.effect).filter(Boolean)
  };
}

/** Strips the trailing "(vs …)" / "(with …)" qualifier from a rendered string. */
export function stripQualifier(text) {
  return String(text).replace(/\s*\((?:vs|with) [^)]+\)$/, '');
}
