import fs from "node:fs";
import path from "node:path";
import { verifiedR2 } from "./build-radio-index.js";
import { clipDialogueEvidence, filterAssociationContext, loadAssociationEvidence } from "./association-context-review.js";
const media = "https://media.afpd-accountability.com";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const time = new Intl.DateTimeFormat("en-US", {timeZone:"America/Denver", hour:"numeric", minute:"2-digit", second:"2-digit"});
const dayLabel = new Intl.DateTimeFormat("en-US", {timeZone:"UTC", month:"long", day:"numeric", year:"numeric"});
const folderFor = (date,tg) => `openmhz-afpd-${tg===6001 ? "car-to-car" : "law-2"}-${date}`;
const stableId = (date,tg,filename) => `${tg}:${date}:${filename}`;

export function selectAssociationReview(source, readManifest, audioAvailable = () => true) {
  source = filterAssociationContext(source);
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
  const link = (text, href) => `<a href="${escape(href)}">${escape(text)}</a>`;
  const selections = review.people.flatMap(person=>person.days.flatMap(day=>day.calls.map(call=>({
    officer_id:person.id,clip_id:call.id,date:day.date,talkgroup:day.talkgroup,number:call.number,
    ...clipDialogueEvidence(source,person.id,day,call),
    transmitter_radio_ids:call.radioIds.split(", ").filter(Boolean),
    source_record_ids:day.evidence.filter(record=>record.clips.includes(call.number) || record.ai_reviews.some(r=>r.clip_references.some(ref=>ref.number===call.number && ref.date===day.date && ref.talkgroup===day.talkgroup))).map(record=>record.record_id)
  }))));
  const selectionMap=new Map(selections.map(c=>[JSON.stringify([c.officer_id,c.clip_id]),c]));
  const sections = review.people.map(person => `<template data-person="person-${escape(person.id)}"><section class="person" data-person-id="${escape(person.id)}" id="person-${escape(person.id)}">
<h2>${escape(person.name)}</h2><p class="person-meta">${person.days.length} dated talkgroups · ${person.days.reduce((n,d)=>n+d.calls.length,0)} selected clips · ${link("Back to people", "#people")}</p>
<section class="review-player" aria-label="Audio player">
<div class="player-heading"><p class="current" aria-live="polite">Choose a clip to listen</p><div class="player-actions"><button type="button" data-action="show-current" disabled>Show Current Clip</button><label>Speed <select data-speed aria-label="Playback speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div></div>
<div class="playback"><button type="button" data-action="play" aria-label="Play selected clip" disabled>Play</button><div class="progress"><input type="range" data-seek aria-label="Position in clip" min="0" max="0" step="0.1" value="0" disabled><div class="times"><span data-elapsed>0:00</span><span data-duration>0:00</span></div></div></div>
<p class="message" role="status"></p><p class="attribution" hidden></p><audio preload="none" aria-label="${escape(person.name)} recordings"></audio>
<div class="transcript" hidden><p class="transcript-status"></p><p class="transcript-text"></p><button type="button" data-action="edit-transcript">Edit transcript</button><div class="transcript-editor" hidden><label>Transcript<textarea rows="4" aria-label="Transcript text"></textarea></label><button type="button" data-action="save-transcript">Save</button> <button type="button" data-action="cancel-transcript">Cancel</button></div></div>
</section>
<p class="evidence-help">Checked = evidence for the indicated radio ID. The radio shown beside the time is the transmitter, which may be the person calling this officer. Unanswered calls and ambiguous exchanges stay as unchecked context. All clips remain playable and exportable.</p>
${person.days.map(day => {
    const id = `${person.id}-${day.date}-${day.talkgroup}`;
    const calls = day.calls.map(call => {
      const selection=selectionMap.get(JSON.stringify([person.id,call.id])),evidence=selection.evidence;
      const target=selection.evidence_radio_ids.length?`for ${selection.evidence_radio_ids.join(" / ")}`:"ID unresolved";
      const tentative=selection.dialogue_exchanges.some(e=>e.confidence!=="clear");
      return `<li class="clip-row"><button type="button" class="clip" id="${escape(id)}-clip-${call.number}" data-clip-id="${escape(call.id)}" data-number="${call.number}" data-source="${escape(call.source)}" data-transcript="${escape(call.transcript)}" data-note="${escape(call.note)}" data-verified="${call.verified}"><span>${escape(call.time)} · <strong>Clip ${call.number}</strong></span><span>${escape(call.radioIds || "Radio ID unavailable")} · ${call.seconds} sec</span></button><label class="clip-evidence"><input type="checkbox" data-clip-evidence aria-label="Clip ${call.number}: evidence for ${escape(person.name)}" ${evidence ? "checked" : ""}> Evidence <small class="evidence-radio">${escape(target)}${tentative ? " · tentative" : ""}</small></label></li>`;
    }).join("\n");
    return `<details class="day" id="${escape(id)}" data-day data-date="${day.date}" data-talkgroup="${day.talkgroup}">
<summary><h3>${escape(dayLabel.format(new Date(`${day.date}T12:00:00Z`)))} · ${day.talkgroup===5922 ? "Law 2 · 5922" : "Car-to-car · 6001"}</h3><span>${day.calls.length} clips</span></summary>
<div class="day-content"><ol class="clips">${calls}</ol><p>${link(`Open full ${day.talkgroup} day`,`https://afpd-accountability.com/${day.talkgroup===5922 ? "law-2-radio" : "police-radio"}/?date=${day.date}`)}</p></div></details>`;
  }).join("\n")}</section></template>`).join("\n");
  const payload=JSON.stringify({source,clips:review.clipCatalog,clip_selections:selections}).replaceAll("<","\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Officer association listening review</title><style>${styles}</style></head><body><main><header><p class="eyebrow">AFPD public media · 6001 and Law 2 · 5922</p><h1>Officer association listening review</h1><p>${review.people.length} people and unresolved names · ${review.personDays} dated sections · ${review.selections} clip selections</p><p class="notice">${escape(source.review_notice ?? "AI-assisted evidence. Personal verification is pending; associations remain provisional.")}</p><p>New search hits are listening leads, not confirmed identities. Context clips do not identify the next transmitter automatically. Times are Mountain Time.</p><div class="review-tools"><label>Reviewer name <input id="reviewer-name" type="text" placeholder="Your name" autocomplete="name"></label><button type="button" id="export-review">Export all data and changes (JSON)</button><p id="review-save-status" role="status"></p><p>Evidence checkboxes save automatically in this browser. The export includes all recordings, checked evidence clips, unchecked context clips, your changes, original and edited transcripts, and prior review history. Checking Evidence selects a clip for this person; it does not verify its transcript or identify the transmitting radio. Export regularly to keep a portable copy.</p></div></header><div id="people"><label for="person-select">Officer or unresolved name</label><select id="person-select" aria-controls="officer-clips">${review.people.map(p=>`<option value="person-${escape(p.id)}">${escape(p.name)}</option>`).join("\n")}</select><p id="selection-status" role="status"></p></div><div id="officer-clips">${sections}</div><noscript><p>JavaScript is needed for editing and export. Open the police radio or Law 2 archive to listen without JavaScript.</p></noscript></main><script type="application/json" id="review-data">${payload}</script><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>\n`;
}

export function buildAssociationReview(root = process.cwd()) {
  const source = filterAssociationContext(loadAssociationEvidence(root));
  const directory = path.join(root,"public/records/openmhz");
  const review = selectAssociationReview(source, (date,tg) => JSON.parse(fs.readFileSync(path.join(directory,folderFor(date,tg),"calls.json"),"utf8")), (call,date,tg) => verifiedR2(call,folderFor(date,tg)) || fs.existsSync(path.join(directory,folderFor(date,tg),call.original_filename)));
  const html = renderAssociationReview(review,source,fs.readFileSync(path.join(root,"public/css/officer-association-review.css"),"utf8"),fs.readFileSync(path.join(root,"public/js/association-review-state.js"),"utf8")+"\n"+fs.readFileSync(path.join(root,"public/js/officer-association-review.js"),"utf8"));
  const output = path.join(root,"public/officer-association-review.html");
  if (!fs.existsSync(output) || fs.readFileSync(output,"utf8") !== html) fs.writeFileSync(output,html);
  return {output,people:review.people.length,days:review.personDays,clips:review.selections,uniqueClips:Object.keys(review.clipCatalog).length};
}
