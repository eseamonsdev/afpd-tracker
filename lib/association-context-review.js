import fs from "node:fs";
import path from "node:path";

export function loadAssociationEvidence(root) {
  const source = JSON.parse(fs.readFileSync(path.join(root, "data/officer-association-evidence.json"), "utf8"));
  const file = path.join(root, "data/association-review-context-exclusions.json");
  if (fs.existsSync(file)) source.context_review_exclusions = JSON.parse(fs.readFileSync(file, "utf8"));
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
