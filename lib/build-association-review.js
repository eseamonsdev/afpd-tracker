import fs from "node:fs";
import path from "node:path";
import { verifiedR2 } from "./build-radio-index.js";
const media = "https://media.afpd-accountability.com";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const time = new Intl.DateTimeFormat("en-US", {timeZone:"America/Denver", hour:"numeric", minute:"2-digit", second:"2-digit"});
const dayLabel = new Intl.DateTimeFormat("en-US", {timeZone:"UTC", month:"long", day:"numeric", year:"numeric"});
const folderFor = (date,tg) => `openmhz-afpd-${tg===6001 ? "car-to-car" : "law-2"}-${date}`;
const stableId = (date,tg,filename) => `${tg}:${date}:${filename}`;

export function selectAssociationReview(source, readManifest, audioAvailable = () => true) {
  const grouped = new Map(), manifests = new Map(), clipCatalog = {};
  const reviews = new Map();
  for (const review of source.ai_reviews ?? []) for (const id of review.source_record_ids) {
    if (!reviews.has(id)) reviews.set(id,[]);
    reviews.get(id).push(review);
  }
  function add(record, officerId) {
    if (![6001,5922].includes(record.talkgroup) || !record.clips?.length) return;
    const officer = source.officers[officerId] ?? (officerId==="unassigned-observations" ? {name:"Unassigned observations and exceptions"} : null);
    if (!officer) throw new Error(`Unknown association candidate ${officerId}`);
    if (!grouped.has(officerId)) grouped.set(officerId, {id:officerId, name:officer.name, days:new Map()});
    const person = grouped.get(officerId), key=`${record.date}/${record.talkgroup}`;
    if (!person.days.has(key)) person.days.set(key, {date:record.date,talkgroup:record.talkgroup,numbers:new Set(),evidence:[]});
    const day = person.days.get(key), aiReviews=reviews.get(record.record_id) ?? [];
    record.clips.forEach(number => day.numbers.add(number));
    for(const review of aiReviews) for(const ref of review.clip_references) if(ref.date===day.date&&ref.talkgroup===day.talkgroup) day.numbers.add(ref.number);
    day.evidence.push({...record,officer_id:record.officer_id ?? officerId,ai_reviews:aiReviews});
  }
  source.associations.forEach((record,index) => add({...record,record_id:record.record_id ?? `original-${index}`},record.officer_id));
  for(const record of source.review_leads ?? []) {
    const candidates = record.candidate_officer_ids.filter(id=>!source.excluded_candidates?.[id]);
    if (candidates.length) for(const officerId of candidates) add({...record,candidate_officer_ids:candidates},officerId);
    else add({...record,officer_id:"unassigned-observations",candidate_officer_ids:[]},"unassigned-observations");
  }
  for(const record of source.observations ?? []) add(record,"unassigned-observations");
  const allPeople = [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name)).map(person => ({...person,
    days:[...person.days.values()].sort((a,b) => a.date.localeCompare(b.date)||a.talkgroup-b.talkgroup).map(day => {
      const key=`${day.date}/${day.talkgroup}`;
      if (!manifests.has(key)) {
        const manifest = readManifest(day.date,day.talkgroup);
        if (manifest.date !== day.date || manifest.talkgroup !== day.talkgroup || !Array.isArray(manifest.calls)) throw new Error(`Invalid ${day.talkgroup} manifest ${day.date}`);
        manifests.set(key, [...manifest.calls].sort((a,b) => a.epoch-b.epoch));
      }
      const calls = manifests.get(key);
      return {...day, calls:[...day.numbers].sort((a,b) => a-b).map(number => {
        const call = calls[number-1], tg=day.talkgroup;
        if (!Number.isInteger(number) || number < 1 || !call || !new RegExp(`^dcfems-${tg}-\\d+\\.m4a$`).test(call.original_filename) || !Number.isFinite(call.epoch)) throw new Error(`Missing ${tg} clip ${number} on ${day.date}`);
        if (!audioAvailable(call, day.date,tg)) throw new Error(`Audio unavailable for ${day.date} clip ${number}`);
        const folder = folderFor(day.date,tg);
        const url = verifiedR2(call, folder) && call.audio_storage.bucket === "afpd-public-media"
          ? `${media}/${call.audio_storage.key}` : `https://afpd-accountability.com/records/openmhz/${folder}/${call.original_filename}`;
        const ids = [...new Set([...(call.radio_ids ?? []), ...(call.srcList ?? []).map(s => s.src)].filter(Boolean).map(String))];
        const result={id:stableId(day.date,tg,call.original_filename),number,talkgroup:tg,date:day.date,filename:call.original_filename,epoch:call.epoch,source:url,time:time.format(new Date(call.epoch*1000)),seconds:call.displayed_seconds ?? call.duration ?? 0,radioIds:ids.join(", "),transcript:typeof call.transcript === "string" ? call.transcript : "",note:call.note ?? "",verified:call.validated === true};
        clipCatalog[result.id]=result;
        return result;
      })};
    })
  }));
  const people = allPeople.filter(person=>!source.excluded_candidates?.[person.id]);
  return {people,clipCatalog,personDays:people.reduce((n,p) => n+p.days.length,0),selections:people.reduce((n,p) => n+p.days.reduce((s,d)=>s+d.calls.length,0),0)};
}

export function renderAssociationReview(review, source, styles, script) {
  const evidenceText = value => {
    let text = String(value ?? "");
    for (const id of Object.keys(source.excluded_candidates ?? {})) {
      const name = source.officers[id]?.name;
      if (name) text = text.replaceAll(name, `${name} (excluded from AFPD association candidates: employment ended before these recordings)`);
    }
    return escape(text);
  };
  const link = (text, href) => `<a href="${escape(href)}">${escape(text)}</a>`;
  const officers=Object.entries(source.officers).filter(([id])=>!source.excluded_candidates?.[id]);
  const sections = review.people.map(person => `<section class="person" id="person-${escape(person.id)}" data-search="${escape((person.name+" "+person.days.flatMap(d=>d.evidence.flatMap(e=>[e.radio_id,...e.candidate_radio_ids??[]])).join(" ")).toLowerCase())}">
<h2>${escape(person.name)}</h2><p class="person-meta">${person.days.length} dated talkgroups · ${person.days.reduce((n,d)=>n+d.calls.length,0)} selected clips · ${link("Back to people", "#people")}</p>
${person.days.map(day => {
    const id = `${person.id}-${day.date}-${day.talkgroup}`;
    const calls = day.calls.map(call => `<li><button type="button" class="clip" id="${escape(id)}-clip-${call.number}" data-clip-id="${escape(call.id)}" data-number="${call.number}" data-source="${escape(call.source)}" data-transcript="${escape(call.transcript)}" data-note="${escape(call.note)}" data-verified="${call.verified}"><span>${escape(call.time)} · <strong>Clip ${call.number}</strong></span><span>${escape(call.radioIds || "Radio ID unavailable")} · ${call.seconds} sec</span></button></li>`).join("\n");
    const notes = day.evidence.map(record => {
      const lead=!record.radio_id, key=`${record.record_id}/${person.id}`;
      const selectable=day.calls.filter(c=>record.clips.includes(c.number) || record.ai_reviews.some(r=>r.clip_references.some(ref=>ref.number===c.number && ref.date===day.date && ref.talkgroup===day.talkgroup)));
      return `<li data-evidence-key="${escape(key)}" data-record-id="${escape(record.record_id)}" data-officer-id="${escape(person.id)}" data-date="${day.date}" data-talkgroup="${day.talkgroup}"><strong>${lead ? "Search lead / observation · choose identity and radio after listening" : `Radio ${escape(record.radio_id)}`}</strong> · ${escape(record.record_id)}
<p>${evidenceText(record.evidence)}</p>${record.ai_assessment ? `<p class="ai-review">AI review: ${escape(record.ai_assessment)}. ${evidenceText(record.report_notes?.join(" "))}</p>` : ""}${record.ai_reviews.map(r=>`<p class="ai-review"><strong>${escape(r.report_id)} · AI review: ${escape(r.ai_assessment)}</strong> ${evidenceText(r.evidence)}</p>`).join("")}
${record.candidate_officer_ids?.length > 1 ? `<p>Possible people: ${escape(record.candidate_officer_ids.filter(key=>!source.excluded_candidates?.[key]).map(key=>source.officers[key].name).join(" / "))}</p>` : ""}
<div class="confirmation"><label>Person <select data-confirm-person ${lead ? "" : "disabled"}>${(lead ? (person.id==="unassigned-observations" ? officers : officers.filter(([key])=>(record.candidate_officer_ids??[person.id]).includes(key))) : officers.filter(([key])=>key===person.id)).map(([key,o])=>`<option value="${escape(key)}" ${key===person.id ? "selected" : ""}>${escape(o.name)}</option>`).join("")}</select></label><label>Radio ID <input data-confirm-radio inputmode="numeric" pattern="[1-9][0-9]*" value="${escape(record.radio_id ?? "")}" ${lead ? 'placeholder="Choose after listening"' : "readonly"}></label>${lead ? `<p>Nearby radios (context only): ${escape((record.candidate_radio_ids??[]).join(", "))}</p>` : ""}<fieldset><legend>Clips supporting this association</legend>${selectable.map(c=>`<label><input type="checkbox" data-evidence-clip="${escape(c.id)}" value="${c.number}" ${(record.cue_clips??record.clips).includes(c.number) ? "checked" : ""}> ${link(`Clip ${c.number}`,`#${id}-clip-${c.number}`)}</label>`).join(" ")}</fieldset><label class="confirm"><input type="checkbox" data-confirm> I personally confirm this person–radio association using the selected clips</label><p class="confirmation-status" role="status">${record.status==="confirmed" ? "Prior source confirmation retained; this review is pending." : "Pending personal verification"}</p></div></li>`;
    }).join("\n");
    return `<details class="day" id="${escape(id)}" data-day>
<summary><h3>${escape(dayLabel.format(new Date(`${day.date}T12:00:00Z`)))} · ${day.talkgroup===5922 ? "Law 2 · 5922" : "Car-to-car · 6001"}</h3><span>${day.calls.length} clips</span></summary>
<div class="day-content"><div class="controls"><p class="current" aria-live="polite">Choose a clip</p><audio controls preload="none" aria-label="${escape(person.name)} · ${day.date} · ${day.talkgroup}"></audio><div class="actions"><button type="button" data-action="play-day">Play day</button><button type="button" data-action="previous" disabled>Previous</button><button type="button" data-action="next" disabled>Next</button><label><input type="checkbox" data-autoplay> Autoplay next clip</label><label>Speed <select data-speed aria-label="Playback speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" data-action="transcript" aria-pressed="false">Transcript: Off</button></div><p class="message" role="status"></p><a class="recording" href="#" hidden>Open selected recording</a><div class="transcript" hidden><p class="transcript-status"></p><button type="button" data-action="edit-transcript" disabled aria-label="Edit selected transcript">✎ Edit transcript</button><p class="transcript-text"></p><div class="transcript-editor" hidden><label>Edit transcript<textarea rows="6" aria-label="Transcript text"></textarea></label><button type="button" data-action="save-transcript">Save</button> <button type="button" data-action="cancel-transcript">Cancel</button></div><p class="call-note"></p></div></div>
<details class="evidence"><summary>Evidence notes and confirmation (${day.evidence.length} entries)</summary><ul>${notes}</ul></details><ol class="clips">${calls}</ol><p>${link(`Open full ${day.talkgroup} day`,`https://afpd-accountability.com/${day.talkgroup===5922 ? "law-2-radio" : "police-radio"}/?date=${day.date}`)}</p></div></details>`;
  }).join("\n")}</section>`).join("\n");
  const payload=JSON.stringify({source,clips:review.clipCatalog}).replaceAll("<","\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Officer association listening review</title><style>${styles}</style></head><body><main><header><p class="eyebrow">AFPD public media · 6001 and Law 2 · 5922</p><h1>Officer association listening review</h1><p>${review.people.length} people and unresolved names · ${review.personDays} dated sections · ${review.selections} clip selections</p><p class="notice">${escape(source.review_notice ?? "AI-assisted evidence. Personal verification is pending; associations remain provisional.")}</p><p>Candidates whose AFPD employment ended before these recordings are excluded from association choices. Original records are retained in the export for provenance; excluded attributions are not active associations. New search hits are listening leads, not confirmed identities. Context clips do not identify the next transmitter automatically. Times are Mountain Time.</p><div class="review-tools"><label>Reviewer name <input id="reviewer-name" type="text" placeholder="Your name" autocomplete="name"></label><button type="button" id="export-review">Export all data and changes (JSON)</button><p id="review-save-status" role="status"></p><p>Save records changes in this browser. Export includes the complete underlying evidence, all review clips, original and edited transcripts, and personally confirmed associations with selected evidence clips. Export regularly to keep a portable copy. Editing a transcript does not confirm an association.</p></div><label class="search">Find a person or radio ID <input id="person-search" type="search" placeholder="Name or radio ID" autocomplete="off"></label><p id="search-status" role="status"></p></header><nav id="people" aria-label="People">${review.people.map(p=>link(p.name,`#person-${p.id}`)).join("\n")}</nav>${sections}<noscript><p>JavaScript is needed for editing and export. Use the full-day links to listen in the archive.</p></noscript></main><script type="application/json" id="review-data">${payload}</script><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>\n`;
}

export function buildAssociationReview(root = process.cwd()) {
  const source = JSON.parse(fs.readFileSync(path.join(root,"data/officer-association-evidence.json"),"utf8"));
  const directory = path.join(root,"public/records/openmhz");
  const review = selectAssociationReview(source, (date,tg) => JSON.parse(fs.readFileSync(path.join(directory,folderFor(date,tg),"calls.json"),"utf8")), (call,date,tg) => verifiedR2(call,folderFor(date,tg)) || fs.existsSync(path.join(directory,folderFor(date,tg),call.original_filename)));
  const html = renderAssociationReview(review,source,fs.readFileSync(path.join(root,"public/css/officer-association-review.css"),"utf8"),fs.readFileSync(path.join(root,"public/js/association-review-state.js"),"utf8")+"\n"+fs.readFileSync(path.join(root,"public/js/officer-association-review.js"),"utf8"));
  const output = path.join(root,"public/officer-association-review.html");
  if (!fs.existsSync(output) || fs.readFileSync(output,"utf8") !== html) fs.writeFileSync(output,html);
  return {output,people:review.people.length,days:review.personDays,clips:review.selections,uniqueClips:Object.keys(review.clipCatalog).length};
}
