import fs from "node:fs";
import path from "node:path";

export function loadAssociationEvidence(root) {
  const source = JSON.parse(fs.readFileSync(path.join(root, "data/officer-association-evidence.json"), "utf8"));
  const file = path.join(root, "data/association-review-context-exclusions.json");
  if (fs.existsSync(file)) source.context_review_exclusions = JSON.parse(fs.readFileSync(file, "utf8"));
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
