import fs from "node:fs";
import path from "node:path";
import { filterAssociationContext, loadAssociationEvidence } from "./association-context-review.js";

import { withProductionAssociationBaseline } from "./production-association-baseline.js";

import { associationDisplayDecisions, isDatedConfirmation, isReviewedAssociationEvidence } from "./association-display-policy.js";

const labels = { strong: "Strong association", possible: "Possible association", dated: "Confirmed dates only", supporting: "Supporting evidence only" };
const csv = rows => rows.map(row => Array.from({length: rows[0].length}, (_, i) => row[i]).map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
const sortedDates = rows => [...new Set(rows.map(row => row.date))].sort();
const held = (source, row) => source.withheld_dates?.[row.date]?.includes(row.radio_id) && !isReviewedAssociationEvidence(row);

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const validRadioId = id => /^[1-9]\d*$/.test(id);
const evidenceStatus = (count, decision) =>
  count >= 4 ? "strong" : count >= 2 || decision.status === "possible" ? "possible" : count ? "dated" : "supporting";
const knownOfficer = (source, id) => typeof id === "string" && Object.hasOwn(source.officers, id);

function compileDateExclusions(source, groups, entryFor) {
  const exclusions = {}, conflicts = [];
  const input = source.association_exclusions === undefined ? {} : source.association_exclusions;
  if (!isRecord(input)) throw new Error("association_exclusions must be an object keyed by date");
  for (const [date, radios] of Object.entries(input)) {
    if (!validDate(date) || !isRecord(radios)) throw new Error(`Invalid association exclusion date: ${date}`);
    for (const [radioId, exclusion] of Object.entries(radios)) {
      const ids = exclusion?.excluded_officer_ids;
      if (!validRadioId(radioId) || !isRecord(exclusion) || !Array.isArray(ids) ||
          ids.some(id => !knownOfficer(source, id)) || new Set(ids).size !== ids.length) {
        throw new Error(`Invalid association exclusion: ${date}/${radioId}`);
      }
      if (!ids.length) continue;
      const remaining = new Map();
      for (const [key, rows] of groups) {
        const [officerId, id] = key.split("/");
        if (id !== radioId) continue;
        if (!ids.includes(officerId)) remaining.set(key, rows);
        else if (rows.some(row => row.date === date && isDatedConfirmation(row))) {
          conflicts.push({ date, radio_id: radioId, officer_id: officerId });
        }
      }
      // Re-evaluate single-day eligibility and strength with the excluded pairs removed.
      const decisions = associationDisplayDecisions(source, remaining);
      const associations = [...decisions].filter(([, decision]) => decision.general_eligible)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, decision]) => entryFor(key, remaining.get(key), decision));
      (exclusions[date] ??= {})[radioId] = { excluded_officer_ids: ids, associations };
    }
  }
  return { exclusions, conflicts };
}

function compileClipOverrides(source) {
  const input = source.clip_overrides === undefined ? {} : source.clip_overrides;
  if (!isRecord(input)) throw new Error("clip_overrides must be an object keyed by archive filename");
  return Object.fromEntries(Object.entries(input).map(([filename, radios]) => {
    if (!/^dcfems-(6001|5922|6036)-[1-9]\d*\.m4a$/.test(filename) || !isRecord(radios)) {
      throw new Error(`Invalid association clip override: ${filename}`);
    }
    return [filename, Object.fromEntries(Object.entries(radios).map(([id, override]) => {
      const officerId = override?.officer_id;
      if (!validRadioId(id) || !isRecord(override) || !knownOfficer(source, officerId) || source.excluded_candidates?.[officerId]) {
        throw new Error(`Invalid association clip override: ${filename}/${id}`);
      }
      return [id, { officer_id: officerId, name: source.officers[officerId].name, status: "confirmed-clip" }];
    }))];
  }));
}

export function compileOfficerAssociations(source) {
  if (source.schema_version !== 1 || !source.officers || !Array.isArray(source.associations)) throw new Error("Invalid officer association evidence source");
  if (source.review_mode !== undefined) throw new Error("review_mode is no longer supported; accept individual association evidence instead");
  source = filterAssociationContext(withProductionAssociationBaseline(source));
  const groups = new Map(), historicalContext=[];
  for (const row of source.associations) {
    if (!source.officers[row.officer_id] || !/^[1-9]\d*$/.test(row.radio_id) ||
        !validDate(row.date) ||
        ![6001, 5922, 6036].includes(row.talkgroup) || !["confirmed", "supporting", "rejected"].includes(row.status) ||
        typeof row.evidence !== "string" || !row.evidence.trim() || !Array.isArray(row.clips) ||
        row.clips.some(clip => !Number.isInteger(clip) || clip < 1)) throw new Error(`Invalid association evidence: ${JSON.stringify(row)}`);
    if (source.excluded_candidates?.[row.officer_id]) continue;
    const ownerReview=source.owner_evidence_reviews?.[row.officer_id];
    if(ownerReview && !row.production_baseline && !isDatedConfirmation(row) && !ownerReview.active_record_ids.includes(row.record_id)) {historicalContext.push(row);continue;}
    const key = `${row.officer_id}/${row.radio_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);

  }
  const displayDecisions = associationDisplayDecisions(source, groups);
  const fallbackEntry = (key, rows, decision) => {
    const [officerId] = key.split("/");
    const dates = sortedDates(rows.filter(isReviewedAssociationEvidence));
    const status = evidenceStatus(dates.length, decision);
    return { ...decision, officer_id: officerId, name: source.officers[officerId].name,
      status: decision.confirmed ? "confirmed-association" : status,
      evidence_days: dates.length, evidence_dates: dates, review_status: "reviewed-only" };
  };
  const { exclusions, conflicts } = compileDateExclusions(source, groups, fallbackEntry);
  const clipOverrides = compileClipOverrides(source);
  const days = {}, associations = {}, profiles = {}, summaryRows = [["Name heard", "Roster candidate", "Radio ID", "Evidence days", "Association", "Evidence dates", "Evidence", "Profile", "Officer ID", "Previously confirmed days", "Confirmed association", "Display eligible", "Display reason"]];
  const evidenceRows = [["Officer ID", "Radio ID", "Date", "Talkgroup", "Clips", "Evidence", "Status", "Confirmed by", "Full name", "Name heard", "Original assessment", "Review status", "Other candidates", "Record ID", "AI report IDs", "AI assessment", "Personal verification", "Confirmed association", "Display eligible", "Display reason", "Evidence accepted", "Acceptance basis"]];
  for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [officerId, radioId] = key.split("/"), officer = source.officers[officerId];
    const decision = displayDecisions.get(key) ?? {confirmed:false,display_eligible:false,display_reason:"Rejected evidence; CSV only"};
    const confirmed = rows.filter(isReviewedAssociationEvidence);
    const dates = sortedDates(confirmed), count = dates.length;
    const status = evidenceStatus(count, decision);
    const statusLabel = decision.confirmed ? "Personally confirmed general association" : decision.general_eligible ? labels[status] : decision.hasDatedConfirmation ? "Confirmed dates only" : "CSV only";
    const confirmedDates = sortedDates(rows.filter(isDatedConfirmation));
    const entry = { ...decision, officer_id: officerId, name: officer.name, status, evidence_days: count, evidence_dates: dates, review_status: "reviewed-only" };
    if (decision.general_eligible) {
      associations[radioId] ??= [];
      associations[radioId].push({ ...entry, status: decision.confirmed ? "confirmed-association" : status });
    }
    for (const date of confirmedDates) {
      const evidence = rows.filter(row => row.date === date && isDatedConfirmation(row));
      days[date] ??= {};
      days[date][radioId] ??= [];
      days[date][radioId].push({ ...entry, status: "confirmed", confirmed_dates: [date], display_eligible: true,
        evidence: evidence.map(row => ({ talkgroup: row.talkgroup, clips: row.clips, evidence: row.evidence, confirmed_by: row.confirmed_by ?? null, name_heard: row.name_heard, original_assessment: row.original_assessment, review_status: row.review_status, candidate_officer_ids: row.candidate_officer_ids?.filter(id=>!source.excluded_candidates?.[id]) })) });
    }
    const evidenceDates = [...new Set(confirmed.map(row=>`${row.date}/${row.talkgroup}`))].sort().map(key=>{
      const [date,tg]=key.split("/"),talkgroup=Number(tg),dated=confirmed.filter(row=>row.date===date&&row.talkgroup===talkgroup);
      const clips=[...new Set(dated.flatMap(row=>row.clips))].sort((a,b)=>a-b);
      const archive=talkgroup===5922?"law-2-radio":talkgroup===6001?"police-radio":null;
      return {date,talkgroup,clips,url:archive?`/${archive}/?date=${date}`:null,
        review_url:[6001,5922].includes(talkgroup)?`https://media.afpd-accountability.com/officer-association-review.html#${officerId}-${date}-${talkgroup}`:null,
        records:dated.map(row=>({record_id:row.record_id,evidence:row.evidence,status:row.status,confirmed_by:row.confirmed_by??null,source_url:row.source_url??null,source_label:row.source_label??null}))};
    });
    if (decision.display_eligible) {
      profiles[officerId] ??= [];
      profiles[officerId].push({...decision,radio_id:radioId,status,status_label:statusLabel,evidence_days:count,evidence_dates:dates,prior_source_confirmed_dates:confirmedDates,evidence:evidenceDates});
    }
    summaryRows.push([[...new Set(rows.map(row => row.name_heard ?? officer.heard))].join("; "), officer.name, radioId, count, statusLabel, dates.join("; "), rows.map(row => `${row.date} (${row.status}${held(source,row) ? ", held" : ""}; talkgroup ${row.talkgroup}${row.clips.length ? `; clips ${row.clips.join(", ")}` : ""}): ${row.evidence}`).join("\n"), officer.url, officerId, confirmedDates.length, decision.confirmed, decision.display_eligible, decision.display_reason]);
    for (const row of rows) evidenceRows.push([officerId, radioId, row.date, row.talkgroup, [...new Set(row.clips)].join("; "), row.evidence, row.status, row.confirmed_by, officer.name, row.name_heard ?? officer.heard, row.original_assessment, row.review_status, (row.candidate_officer_ids ?? []).filter(id => id !== officerId && !source.excluded_candidates?.[id]).map(id => source.officers[id].name).join("; "), row.record_id, ...(source.ai_reviews ?? []).filter(r=>r.source_record_ids.includes(row.record_id)).reduce((out,r)=>[out[0] ? out[0]+"; "+r.report_id : r.report_id,out[1] ? out[1]+"; "+r.ai_assessment+": "+r.evidence : r.ai_assessment+": "+r.evidence], ["",""]), decision.confirmed ? "Association personally confirmed; clip verification is separate" : "Pending personal review", decision.confirmed, decision.display_eligible, decision.display_reason, isReviewedAssociationEvidence(row), row.association_review_basis ?? (isDatedConfirmation(row) ? "Owner-confirmed instance" : "Unreviewed candidate")]);
  }
  for (const row of source.observations ?? []) evidenceRows.push([row.officer_id ?? "", "", row.date, row.talkgroup, row.clips.join("; "), row.evidence, row.officer_id ? row.status : "unassigned", "", source.officers[row.officer_id]?.name ?? "Unassigned observation", "", row.original_assessment, row.review_status, "", row.record_id, ...(source.ai_reviews ?? []).filter(r=>r.source_record_ids.includes(row.record_id)).reduce((out,r)=>[out[0] ? out[0]+"; "+r.report_id : r.report_id,out[1] ? out[1]+"; "+r.ai_assessment+": "+r.evidence : r.ai_assessment+": "+r.evidence], ["",""]), "Pending personal review"]);
  for (const row of source.review_leads ?? []) evidenceRows.push(["", "", row.date, row.talkgroup, row.clips.join("; "), row.evidence, "unassigned AI search lead", "", (row.candidate_officer_ids ?? []).filter(id=>!source.excluded_candidates?.[id]).map(id=>source.officers[id].name).join(" / "), row.name_heard, row.ai_assessment, row.review_status, "", row.record_id, row.report_id, row.ai_assessment, "Pending personal review"]);
  for(const row of historicalContext) evidenceRows.push([row.officer_id,"",row.date,row.talkgroup,row.clips.join("; "),`Historical source radio ${row.radio_id}; superseded by owner evidence selection. ${row.evidence}`,"historical context; not counted","",source.officers[row.officer_id].name,row.name_heard,"","","",row.record_id,"","","Owner-reviewed active evidence is listed separately"]);
  return { labels: { schema_version: 4, profiles, generated_from: "data/officer-association-evidence.json", days, associations, withheld_dates: source.withheld_dates ?? {},
    ...(Object.keys(exclusions).length ? { association_exclusions: exclusions } : {}),
    ...(conflicts.length ? { association_exclusion_conflicts: conflicts } : {}),
    ...(Object.keys(clipOverrides).length ? { clip_overrides: clipOverrides } : {}),
    evidence_policy: "reviewed-only", production_baseline: source.production_association_baseline ? {file:"data/production-officer-association-baseline.json",source_url:source.production_association_baseline.source_url,source_sha256:source.production_association_baseline.source_sha256,captured_at:source.production_association_baseline.captured_at} : undefined }, summaryCsv: csv(summaryRows), evidenceCsv: csv(evidenceRows) };
}

export function buildOfficerAssociations(root = process.cwd()) {
  const source = loadAssociationEvidence(root);
  const result = compileOfficerAssociations(source);
  for (const { date, radio_id, officer_id } of result.labels.association_exclusion_conflicts ?? []) {
    console.warn(`Association exclusion conflicts with day confirmation: ${date}/${radio_id}/${officer_id}`);
  }
  const directory = path.join(root, "public/records/openmhz");
  const outputs = { "officer-associations.json": JSON.stringify(result.labels, null, 2) + "\n", "afpd-radio-officer-ids.csv": result.summaryCsv, "officer-association-evidence.csv": result.evidenceCsv };
  for (const [filename, content] of Object.entries(outputs)) {
    const file = path.join(directory, filename);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content);
  }
  return result;
}
