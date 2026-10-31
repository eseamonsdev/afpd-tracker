import fs from "node:fs";
import path from "node:path";
import { verifiedR2 } from "./build-radio-index.js";
const media = "https://media.afpd-accountability.com";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const time = new Intl.DateTimeFormat("en-US", {timeZone:"America/Denver", hour:"numeric", minute:"2-digit", second:"2-digit"});
const dayLabel = new Intl.DateTimeFormat("en-US", {timeZone:"UTC", month:"long", day:"numeric", year:"numeric"});

export function selectAssociationReview(source, readManifest, audioAvailable = () => true) {
  const grouped = new Map(), manifests = new Map();
  for (const record of source.associations) {
    if (record.talkgroup !== 6001 || record.status === "rejected" || !record.clips?.length) continue;
    const officer = source.officers[record.officer_id];
    if (!officer) throw new Error(`Unknown association candidate ${record.officer_id}`);
    if (!grouped.has(record.officer_id)) grouped.set(record.officer_id, {id:record.officer_id, name:officer.name, days:new Map()});
    const person = grouped.get(record.officer_id);
    if (!person.days.has(record.date)) person.days.set(record.date, {date:record.date, numbers:new Set(), evidence:[]});
    const day = person.days.get(record.date);
    record.clips.forEach(number => day.numbers.add(number));
    day.evidence.push(record);
  }
  const people = [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name)).map(person => ({...person,
    days:[...person.days.values()].sort((a,b) => a.date.localeCompare(b.date)).map(day => {
      if (!manifests.has(day.date)) {
        const manifest = readManifest(day.date);
        if (manifest.date !== day.date || manifest.talkgroup !== 6001 || !Array.isArray(manifest.calls)) throw new Error(`Invalid 6001 manifest ${day.date}`);
        manifests.set(day.date, [...manifest.calls].sort((a,b) => a.epoch-b.epoch));
      }
      const calls = manifests.get(day.date);
      return {...day, calls:[...day.numbers].sort((a,b) => a-b).map(number => {
        const call = calls[number-1];
        if (!Number.isInteger(number) || number < 1 || !call || !/^dcfems-6001-\d+\.m4a$/.test(call.original_filename) || !Number.isFinite(call.epoch)) throw new Error(`Missing 6001 clip ${number} on ${day.date}`);
        if (!audioAvailable(call, day.date)) throw new Error(`Audio unavailable for ${day.date} clip ${number}`);
        const folder = `openmhz-afpd-car-to-car-${day.date}`;
        const source = verifiedR2(call, folder) && call.audio_storage.bucket === "afpd-public-media"
          ? `${media}/${call.audio_storage.key}` : `https://afpd-accountability.com/records/openmhz/${folder}/${call.original_filename}`;
        const ids = [...new Set([...(call.radio_ids ?? []), ...(call.srcList ?? []).map(s => s.src)].filter(Boolean).map(String))];
        return {number, source, time:time.format(new Date(call.epoch*1000)), seconds:call.displayed_seconds ?? 0, radioIds:ids.join(", "), transcript:typeof call.transcript === "string" ? call.transcript : "", note:call.note ?? "", verified:call.validated === true};
      })};
    })
  }));
  return {people, personDays:people.reduce((n,p) => n+p.days.length,0), selections:people.reduce((n,p) => n+p.days.reduce((s,d)=>s+d.calls.length,0),0)};
}

export function renderAssociationReview(review, source, styles, script) {
  const link = (text, href) => `<a href="${escape(href)}">${escape(text)}</a>`;
  const sections = review.people.map(person => `<section class="person" id="person-${escape(person.id)}" data-search="${escape((person.name+" "+person.days.flatMap(d=>d.evidence.map(e=>e.radio_id)).join(" ")).toLowerCase())}">
<h2>${escape(person.name)}</h2><p class="person-meta">${person.days.length} ${person.days.length === 1 ? "date" : "dates"} · ${person.days.reduce((n,d)=>n+d.calls.length,0)} selected clips · ${link("Back to people", "#people")}</p>
${person.days.map(day => {
    const id = `${person.id}-${day.date}`;
    const calls = day.calls.map(call => `<li><button type="button" class="clip" id="${escape(id)}-clip-${call.number}" data-number="${call.number}" data-source="${escape(call.source)}" data-transcript="${escape(call.transcript)}" data-note="${escape(call.note)}" data-verified="${call.verified}"><span>${escape(call.time)} · <strong>Clip ${call.number}</strong></span><span>${escape(call.radioIds || "Radio ID unavailable")} · ${call.seconds} sec</span></button></li>`).join("\n");
    const notes = day.evidence.map(record => `<li><strong>Radio ${escape(record.radio_id)}</strong> · Clips ${record.clips.map(n=>link(n,`#${id}-clip-${n}`)).join(", ")}${record.name_heard ? ` · Name heard: ${escape(record.name_heard)}` : ""}<p>${escape(record.evidence)}</p>${record.candidate_officer_ids?.length > 1 ? `<p>Possible people: ${escape(record.candidate_officer_ids.map(key=>source.officers[key].name).join(" / "))}</p>` : ""}</li>`).join("\n");
    return `<details class="day" id="${escape(id)}" data-day>
<summary><h3>${escape(dayLabel.format(new Date(`${day.date}T12:00:00Z`)))}</h3><span>${day.calls.length} clips</span></summary>
<div class="day-content"><div class="controls"><p class="current" aria-live="polite">Choose a clip</p><audio controls preload="none" aria-label="${escape(person.name)} · ${day.date}"></audio><div class="actions"><button type="button" data-action="play-day">Play day</button><button type="button" data-action="previous" disabled>Previous</button><button type="button" data-action="next" disabled>Next</button><label><input type="checkbox" data-autoplay> Autoplay next clip</label><label>Speed <select data-speed aria-label="Playback speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" data-action="transcript" aria-pressed="false">Transcript: Off</button></div><p class="message" role="status"></p><a class="recording" href="#" hidden>Open selected recording</a><div class="transcript" hidden><p class="transcript-status"></p><p class="transcript-text"></p><p class="call-note"></p></div></div>
<details class="evidence"><summary>Evidence notes (${day.evidence.length} ${day.evidence.length === 1 ? "entry" : "entries"})</summary><ul>${notes}</ul></details><ol class="clips">${calls}</ol><p>${link("Open full 6001 day",`https://afpd-accountability.com/police-radio/?date=${day.date}`)}</p></div></details>`;
  }).join("\n")}</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Officer association listening review</title><style>${styles}</style></head><body><main><header><p class="eyebrow">AFPD radio · 6001</p><h1>Officer association listening review</h1><p>${review.people.length} people and unresolved names · ${review.personDays} dated sections · ${review.selections} clip selections</p><p>Listen to the evidence by person, then date. Original uncertainty and alternative candidates are retained. Times are Mountain Time. Only dates with referenced 6001 clips are included.</p><p>Clips are chronological within each date. A clip shared by two candidates appears under both. Audio loads only when selected. Autoplay follows the selected date's clips.</p><label class="search">Find a person or radio ID <input id="person-search" type="search" placeholder="Name or radio ID" autocomplete="off"></label><p id="search-status" role="status"></p></header><nav id="people" aria-label="People">${review.people.map(p=>link(p.name,`#person-${p.id}`)).join("\n")}</nav>${sections}<noscript><p>JavaScript is needed for the review controls. Use the full-day links to listen in the archive.</p></noscript></main><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>\n`;
}

export function buildAssociationReview(root = process.cwd()) {
  const source = JSON.parse(fs.readFileSync(path.join(root,"data/officer-association-evidence.json"),"utf8"));
  const directory = path.join(root,"public/records/openmhz");
  const review = selectAssociationReview(source, date => JSON.parse(fs.readFileSync(path.join(directory,`openmhz-afpd-car-to-car-${date}/calls.json`),"utf8")), (call,date) => verifiedR2(call,`openmhz-afpd-car-to-car-${date}`) || fs.existsSync(path.join(directory,`openmhz-afpd-car-to-car-${date}`,call.original_filename)));
  const html = renderAssociationReview(review,source,fs.readFileSync(path.join(root,"public/css/officer-association-review.css"),"utf8"),fs.readFileSync(path.join(root,"public/js/officer-association-review.js"),"utf8"));
  const output = path.join(root,"public/officer-association-review.html");
  if (!fs.existsSync(output) || fs.readFileSync(output,"utf8") !== html) fs.writeFileSync(output,html);
  return {output,people:review.people.length,days:review.personDays,clips:review.selections};
}
