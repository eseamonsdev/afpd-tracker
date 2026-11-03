import fs from "node:fs";
import path from "node:path";

export function loadAssociationEvidence(root) {
  const source = JSON.parse(fs.readFileSync(path.join(root, "data/officer-association-evidence.json"), "utf8"));
  const file = path.join(root, "data/association-review-context-exclusions.json");
  if (fs.existsSync(file)) source.context_review_exclusions = JSON.parse(fs.readFileSync(file, "utf8"));
  const dialogueFile=path.join(root,"data/association-dialogue-review.json");
  if(fs.existsSync(dialogueFile)) source.dialogue_reviews=JSON.parse(fs.readFileSync(dialogueFile,"utf8"));
  const baselineFile=path.join(root,"data/production-officer-association-baseline.json");
  if(fs.existsSync(baselineFile)) source.production_association_baseline=JSON.parse(fs.readFileSync(baselineFile,"utf8"));
  // Use the same canonical name as the profile header, rather than a research
  // candidate's expanded middle name. Evidence text retains its original wording.
  const peopleDirectory = path.join(root, "data/entities/people/officers");
  if (fs.existsSync(peopleDirectory)) {
    for (const [id, officer] of Object.entries(source.officers)) {
      const personFile = path.join(peopleDirectory, `${id}.json`);
      if (!fs.existsSync(personFile)) continue;
      const person = JSON.parse(fs.readFileSync(personFile, "utf8")).entities?.[0];
      const name = person?.display_name ?? person?.name;
      if (typeof name !== "string") continue;
      const parts = name.split(",");
      officer.name = parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : name;
    }
  }
  return source;
}

// Apply the same decisions before building the player, CSVs or radio day counts.
// This also prevents a later report import from restoring a rejected namesake.
export function filterAssociationContext(source) {
  const exclusions = source.context_review_exclusions?.records ?? {};
  const eligible = (record, officerId) => {
    if (record.production_baseline) return true;
    if (record.status === "confirmed" && record.confirmed_by === "Eric") return true;
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
  return resolveSamIdentities({...source, associations, observations, review_leads, ai_reviews});
}

// A shared first name is a listening lead, not evidence for both people.
// Owner identifications apply to the recorded exchange, never every use of a radio.
export function resolveSamIdentities(source) {
  const people = ["sammantha-j-halladay", "samuel-canizalez"];
  const isSam = id => people.includes(id);
  const ownerRecords = source.associations.filter(row => isSam(row.officer_id) && row.status === "confirmed" && row.confirmed_by === "Eric");
  const ownersFor = row => new Set(ownerRecords.filter(owner =>
    owner.date === row.date && owner.talkgroup === row.talkgroup &&
    (!row.radio_id || owner.radio_id === row.radio_id) &&
    (row.cue_clips ?? row.clips ?? []).some(clip => owner.clips.includes(clip))
  ).map(owner => owner.officer_id));
  const shared = row => people.every(id => row.candidate_officer_ids?.includes(id));
  const observations = [...(source.observations ?? [])];
  const movedRecords = new Map();
  const unassign = row => {
    const id = `unassigned-${row.candidate_group_id ?? row.record_id}`;
    movedRecords.set(row.record_id, id);
    if (observations.some(record => record.record_id === id)) return;
    observations.push({...row, record_id: id, officer_id: undefined, radio_id: undefined,
      candidate_group_id: undefined, candidate_officer_ids: people,
      status: "unassigned", confirmed_by: null,
      evidence: `Unresolved Sam identity; not counted for either officer. ${row.evidence}`});
  };
  const associations = source.associations.filter(row => {
    if (!isSam(row.officer_id) || row.status === "rejected") return true;
    const owners = ownersFor(row);
    if (owners.size === 1) return owners.has(row.officer_id);
    if (!shared(row)) return true;
    unassign(row);
    return false;
  }).map(row => isSam(row.officer_id) && ownersFor(row).size === 1
    ? {...row, candidate_officer_ids: row.candidate_officer_ids?.filter(id => !isSam(id) || id === row.officer_id)} : row);
  const review_leads = (source.review_leads ?? []).flatMap(row => {
    if (!row.candidate_officer_ids?.some(isSam)) return [row];
    const owners = ownersFor(row);
    if (owners.size === 1) return [{...row, candidate_officer_ids: row.candidate_officer_ids.filter(id => !isSam(id) || owners.has(id))}];
    if (!shared(row)) return [row];
    unassign(row);
    const otherCandidates = row.candidate_officer_ids.filter(id => !isSam(id));
    return otherCandidates.length ? [{...row, candidate_officer_ids: otherCandidates}] : [];
  });
  const ai_reviews = (source.ai_reviews ?? []).map(review => ({...review,
    source_record_ids: [...new Set(review.source_record_ids.map(id => movedRecords.get(id) ?? id))]}));
  return {...source, associations, observations, review_leads, ai_reviews};
}

// Target radios describe the identity supported by an exchange, not the caller's transmitter.
export function clipDialogueEvidence(source, officerId, day, call) {
  // Explicit owner selections may include a mention or context without assigning a radio.
  const ownerSelection=day.evidence.flatMap(record=>record.owner_clip_selections??[])
    .find(selection=>selection.officer_id===officerId && selection.clip_id===call.id);
  if(ownerSelection) return {evidence:ownerSelection.included,
    owner_evidence_review:{included:ownerSelection.included,reviewer:ownerSelection.reviewer,exported_at:ownerSelection.reviewed_at},
    evidence_radio_ids:ownerSelection.evidence_radio_ids??[],attribution_basis:"owner_evidence_selection",dialogue_exchanges:ownerSelection.dialogue_exchanges??[],
    context_reason:ownerSelection.context_reason??"Selected by the owner as evidence for this person; target radio identity remains unresolved."};
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
