import fs from "node:fs";
import path from "node:path";

export function loadAssociationEvidence(root) {
  const source = JSON.parse(fs.readFileSync(path.join(root, "data/officer-association-evidence.json"), "utf8"));
  const file = path.join(root, "data/association-review-context-exclusions.json");
  if (fs.existsSync(file)) source.context_review_exclusions = JSON.parse(fs.readFileSync(file, "utf8"));
  const dialogueFile=path.join(root,"data/association-dialogue-review.json");
  if(fs.existsSync(dialogueFile)) source.dialogue_reviews=JSON.parse(fs.readFileSync(dialogueFile,"utf8"));
  return source;
}

// Apply the same decisions before building the player, CSVs or radio day counts.
// This also prevents a later report import from restoring a rejected namesake.
export function filterAssociationContext(source) {
  const exclusions = source.context_review_exclusions?.records ?? {};
  const eligible = (record, officerId) => {
    const decision = exclusions[record.record_id];
    return !decision || !!(decision.officer_ids && !decision.officer_ids.includes(officerId));
  };
  const associations = source.associations.filter(row => eligible(row, row.officer_id));
  const observations = (source.observations ?? []).filter(row => eligible(row, "unassigned-observations"));
  const review_leads = (source.review_leads ?? []).flatMap(row => {
    const candidates = row.candidate_officer_ids.filter(id => eligible(row, id));
    return candidates.length ? [{...row, candidate_officer_ids: candidates}] : [];
  });
  const ids = new Set([...associations, ...observations].map(row => row.record_id));
  const ai_reviews = (source.ai_reviews ?? []).flatMap(row => {
    const source_record_ids = row.source_record_ids.filter(id => ids.has(id));
    return source_record_ids.length ? [{...row, source_record_ids}] : [];
  });
  return {...source, associations, observations, review_leads, ai_reviews};
}

// Target radios describe the identity supported by an exchange, not the caller's transmitter.
export function clipDialogueEvidence(source, officerId, day, call) {
  const review=source.dialogue_reviews?.people?.[officerId];
  if(review) {
    const exchanges=review.exchanges.filter(e=>e.date===day.date && e.talkgroup===day.talkgroup && e.evidence_clips.includes(call.number));
    const unresolved=review.unresolved.filter(e=>e.date===day.date && e.talkgroup===day.talkgroup && e.clips.includes(call.number));
    const ownerSelection=review.owner_review?.clip_selections.find(r=>r.date===day.date && r.talkgroup===day.talkgroup && r.number===call.number);
    return {evidence:ownerSelection?.included ?? exchanges.length>0,owner_evidence_review:ownerSelection ? {included:ownerSelection.included,reviewer:review.owner_review.reviewer,exported_at:review.owner_review.exported_at} : null,evidence_radio_ids:[...new Set(exchanges.map(e=>e.target_radio_id))],attribution_basis:"transcript_dialogue",dialogue_exchanges:exchanges.map(e=>({...e,role:e.clip_roles[String(call.number)]})),context_reason:exchanges.length?null:unresolved.map(e=>e.reason).join(" ")||"Surrounding context; no independently attributed exchange."};
  }
  const records=day.evidence.filter(r=>r.radio_id && (r.cue_clips??r.clips).includes(call.number));
  return {evidence:records.length>0,evidence_radio_ids:[...new Set(records.map(r=>r.radio_id))],attribution_basis:records.length?"existing_source_association":"unassigned_context",dialogue_exchanges:[],context_reason:records.length?null:"Name cue or surrounding context; no target radio has been assigned from dialogue."};
}
