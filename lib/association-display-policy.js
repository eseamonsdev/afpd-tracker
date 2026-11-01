// Review acceptance, pair confirmation, and a dated identity are separate facts.
// Transcription or AI imports cannot approve themselves by repeating an identity.
export const isDatedConfirmation = row => !row.production_date_conflict && row.status === 'confirmed' && (row.confirmed_by === 'Eric' || row.production_confirmed === true);
export const isReviewedAssociationEvidence = row => row.status !== 'rejected' && !row.production_date_conflict &&
  (row.association_reviewed === true || isDatedConfirmation(row));

export function associationDisplayDecisions(source, groups) {
  const byRadio = new Map(), decisions = new Map();
  for (const [key, rows] of groups) {
    const radio = key.split('/')[1];
    const reviewed = rows.filter(isReviewedAssociationEvidence);
    const count = new Set(reviewed.map(row => row.date)).size;
    const confirmed = source.association_confirmations?.[key]?.confirmed === true;
    const hasDatedConfirmation = rows.some(isDatedConfirmation);
    const protectedStrong = source.display_policy?.production_strong_pairs?.includes(key);
    const status = protectedStrong ? 'strong' : confirmed ? 'confirmed-association' : count >= 4 ? 'strong' : count >= 2 ? 'possible' : count ? 'dated' : 'supporting';
    const candidate = (protectedStrong || !key.startsWith('unresolved-')) && ['confirmed-association','strong','possible'].includes(status);
    decisions.set(key, {confirmed, status, hasDatedConfirmation, candidate});
    if (!byRadio.has(radio)) byRadio.set(radio, []);
    byRadio.get(radio).push(key);
  }
  for (const keys of byRadio.values()) {
    const candidates = keys.filter(key => decisions.get(key).candidate);
    const retained = candidates.filter(key => source.display_policy?.accepted_general_pairs?.includes(key));
    // Extending evidence is not permission to replace a retained identity.
    // A new competing general pair needs explicit acceptance in this list or
    // a separately explicit general confirmation; dated confirmations are independent.
    const eligible = candidates.filter(key => !retained.length || retained.includes(key) || decisions.get(key).confirmed);
    const tier = ['confirmed-association','strong','possible'].find(status =>
      eligible.some(key => decisions.get(key).status === status));
    for (const key of keys) {
      const decision = decisions.get(key);
      decision.general_eligible = eligible.includes(key) && decision.status === tier;
      decision.display_eligible = decision.general_eligible || decision.hasDatedConfirmation;
      decision.display_reason = decision.general_eligible
        ? decision.confirmed ? 'Personally confirmed general association' : `Reviewed ${decision.status} association`
        : decision.hasDatedConfirmation ? 'Confirmed dates only'
        : decision.candidate ? eligible.includes(key) ? 'Lower-priority association; CSV only' : 'Conflicts with retained association; CSV only' : 'Unreviewed or insufficient evidence; CSV only';
    }
  }
  return decisions;
}
