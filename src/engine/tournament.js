/**
 * tournament.js — the sequenced draft: turn, phase, progress.
 *
 * Everything here is derived from config.json's step list, so changing the
 * format is a data edit: add, remove or reorder steps and the timeline, the
 * slot counts and the turn banner all follow without touching code.
 */

export function stepsOf(registry, formatId) {
  const format = registry.config.draftFormats[formatId];
  return (format && format.steps) || [];
}

export function formatName(registry, formatId) {
  const format = registry.config.draftFormats[formatId];
  return format ? format.name : formatId;
}

/** Timeline rows: one per action, with whatever has been committed to it. */
export function timeline(registry, snapshot) {
  return snapshot.steps.map((step, index) => {
    const entry = snapshot.history.find((h) => h.stepIndex === index);
    return {
      index,
      team: step.team,
      action: step.action,
      phase: step.phase,
      hero: entry ? registry.byId.get(entry.heroId) : null,
      done: Boolean(entry),
      active: snapshot.stepIndex === index
    };
  });
}

/** "Blue ban 3 of 5" — the line above the recommendation list. */
export function turnLabel(snapshot) {
  const step = snapshot.currentStep;
  if (!step) return { phase: 'Draft complete', call: 'Both sides are locked in', team: null };
  const done = snapshot.history.filter((h) => h.team === step.team && h.action === step.action).length;
  const total = snapshot.steps.filter((s) => s.team === step.team && s.action === step.action).length;
  return {
    phase: step.phase,
    call: `${step.team === 'blue' ? 'Blue' : 'Red'} ${step.action} ${done + 1} of ${total}`,
    team: step.team,
    action: step.action
  };
}

export function progress(snapshot) {
  const total = snapshot.steps.length || 1;
  return { done: snapshot.stepIndex, total, remaining: Math.max(0, total - snapshot.stepIndex) };
}
