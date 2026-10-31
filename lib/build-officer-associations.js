import fs from "node:fs";
import path from "node:path";

const labels = { strong: "Strong association", possible: "Possible association", dated: "Confirmed dates only", supporting: "Supporting evidence only" };
const csv = rows => rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
const sortedDates = rows => [...new Set(rows.map(row => row.date))].sort();
const held = (source, row) => source.withheld_dates?.[row.date]?.includes(row.radio_id);

export function compileOfficerAssociations(source) {
  if (source.schema_version !== 1 || !source.officers || !Array.isArray(source.associations)) throw new Error("Invalid officer association evidence source");
  const groups = new Map();
  for (const row of source.associations) {
    if (!source.officers[row.officer_id] || !/^[1-9]\d*$/.test(row.radio_id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0,10) !== row.date ||
        ![6001, 5922, 6036].includes(row.talkgroup) || !["confirmed", "supporting"].includes(row.status) ||
        typeof row.evidence !== "string" || !row.evidence.trim() || !Array.isArray(row.clips) ||
        row.clips.some(clip => !Number.isInteger(clip) || clip < 1)) throw new Error(`Invalid association evidence: ${JSON.stringify(row)}`);
    const key = `${row.officer_id}/${row.radio_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);

  }
  const days = {}, associations = {}, summaryRows = [["Name heard", "Roster candidate", "Radio ID", "Confirmed days", "Association", "Evidence dates", "Evidence", "Profile", "Officer ID"]];
  const evidenceRows = [["Officer ID", "Radio ID", "Date", "Talkgroup", "Clips", "Evidence", "Status", "Confirmed by"]];
  for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [officerId, radioId] = key.split("/"), officer = source.officers[officerId];
    const confirmed = rows.filter(row => row.status === "confirmed" && !held(source, row));
    const dates = sortedDates(confirmed), count = dates.length;
    const status = count >= 4 ? "strong" : count === 3 ? "possible" : count ? "dated" : "supporting";
    const entry = { officer_id: officerId, name: officer.name, status, evidence_days: count, evidence_dates: dates };
    if (status === "strong" || status === "possible") {
      associations[radioId] ??= [];
      associations[radioId].push(entry);
    }
    for (const date of dates) {
      const evidence = confirmed.filter(row => row.date === date);
      days[date] ??= {};
      days[date][radioId] ??= [];
      days[date][radioId].push({ ...entry, status: "confirmed", confirmed_dates: [date],
        evidence: evidence.map(row => ({ talkgroup: row.talkgroup, clips: row.clips, evidence: row.evidence, confirmed_by: row.confirmed_by ?? null })) });
    }
    summaryRows.push([officer.heard, officer.name, radioId, count, labels[status], dates.join("; "), rows.map(row => `${row.date} (${row.status}${held(source,row) ? ", held" : ""}; talkgroup ${row.talkgroup}${row.clips.length ? `; clips ${row.clips.join(", ")}` : ""}): ${row.evidence}`).join("\n"), officer.url, officerId]);
    for (const row of rows) evidenceRows.push([officerId, radioId, row.date, row.talkgroup, [...new Set(row.clips)].join("; "), row.evidence, row.status, row.confirmed_by]);
  }
  return { labels: { schema_version: 3, generated_from: "data/officer-association-evidence.json", days, associations, withheld_dates: source.withheld_dates ?? {} }, summaryCsv: csv(summaryRows), evidenceCsv: csv(evidenceRows) };
}

export function buildOfficerAssociations(root = process.cwd()) {
  const source = JSON.parse(fs.readFileSync(path.join(root, "data/officer-association-evidence.json"), "utf8"));
  const result = compileOfficerAssociations(source);
  const directory = path.join(root, "public/records/openmhz");
  const outputs = { "officer-associations.json": JSON.stringify(result.labels, null, 2) + "\n", "afpd-radio-officer-ids.csv": result.summaryCsv, "officer-association-evidence.csv": result.evidenceCsv };
  for (const [filename, content] of Object.entries(outputs)) {
    const file = path.join(directory, filename);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content);
  }
  return result;
}
