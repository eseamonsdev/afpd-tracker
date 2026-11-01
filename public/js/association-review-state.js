/* Shared by the static page and the export tests. No server writes. */
globalThis.AFPDReviewState = class AFPDReviewState {
  constructor(payload, saved = {}) {
    this.payload = payload;
    this.state = {schema_version:1,reviewer:typeof saved.reviewer==="string" ? saved.reviewer : "",transcripts:{},confirmations:{},clip_reviews:{}};
    this.selections=new Set((payload.clip_selections ?? []).map(c=>JSON.stringify([c.officer_id,c.clip_id])));
    for(const [key,change] of Object.entries(saved.clip_reviews ?? {})) {
      if(change && key===JSON.stringify([change.officer_id,change.clip_id]) && this.selections.has(key) && ["removed","confirmed"].includes(change.status)) this.state.clip_reviews[key]=change;
    }
    for(const [id,change] of Object.entries(saved.transcripts ?? {})) {
      if(payload.clips[id] && typeof change?.text === "string" && typeof change.original_transcript === "string") this.state.transcripts[id]=change;
    }
    for(const [key,confirmation] of Object.entries(saved.confirmations ?? {})) {
      if(confirmation?.confirmed===true && Array.isArray(confirmation.clip_ids) && confirmation.clip_ids.every(id=>payload.clips[id] && this.clipReview(confirmation.officer_id,id)?.status!=="removed") && payload.source.officers[confirmation.officer_id] && !payload.source.excluded_candidates?.[confirmation.officer_id] && this.eligibleRecord(confirmation)) this.state.confirmations[key]=confirmation;
    }
  }
  clipReview(officerId,clipId) { return this.state.clip_reviews[JSON.stringify([officerId,clipId])] ?? null; }
  markClip(officerId,clipId,status,at=new Date().toISOString()) {
    const key=JSON.stringify([officerId,clipId]);
    if(!this.selections.has(key)) throw new Error("Unknown officer clip selection.");
    if(!["pending","removed","confirmed"].includes(status)) throw new Error("Invalid clip review status.");
    if(status==="pending") delete this.state.clip_reviews[key];
    else this.state.clip_reviews[key]={officer_id:officerId,clip_id:clipId,status,reviewed_by:this.state.reviewer.trim() || null,reviewed_at:at};
    if(status==="removed") for(const [id,confirmation] of Object.entries(this.state.confirmations)) {
      if(confirmation.officer_id===officerId && confirmation.clip_ids.includes(clipId)) delete this.state.confirmations[id];
    }
  }
  eligibleRecord(record) {
    const exclusion=this.payload.source.context_review_exclusions?.records?.[record.record_id];
    return !exclusion || !!(exclusion.officer_ids && !exclusion.officer_ids.includes(record.officer_id));
  }
  transcript(id) { return this.state.transcripts[id]?.text ?? this.payload.clips[id].transcript; }
  saveTranscript(id,text,at=new Date().toISOString()) {
    const clip=this.payload.clips[id];if(!clip) throw new Error("Unknown clip");
    if(text===clip.transcript) delete this.state.transcripts[id];
    else this.state.transcripts[id]={text,original_transcript:clip.transcript,edited_at:at,edited_by:this.state.reviewer.trim() || null};
  }
  confirm(key,record,at=new Date().toISOString()) {
    const {source,clips}=this.payload;
    if(!this.state.reviewer.trim()) throw new Error("Enter your reviewer name at the top before confirming.");
    if(!source.officers[record.officer_id] || source.excluded_candidates?.[record.officer_id]) throw new Error("Choose an eligible person.");
    if(!this.eligibleRecord(record)) throw new Error("This match was removed after transcript context review.");
    if(!/^[1-9]\d*$/.test(record.radio_id)) throw new Error("Enter the radio ID you have verified.");
    if(record.clip_ids.some(id=>this.clipReview(record.officer_id,id)?.status==="removed")) throw new Error("Restore removed clips before using them as confirmation evidence.");
    if(!record.clip_ids.length || record.clip_ids.some(id=>!clips[id] || clips[id].date!==record.date || clips[id].talkgroup!==record.talkgroup)) throw new Error("Select at least one evidence clip from this date and talkgroup.");
    this.state.confirmations[key]={...record,confirmed:true,confirmed_by:this.state.reviewer.trim(),confirmed_at:at};
  }
  unconfirm(key) { delete this.state.confirmations[key]; }
  export(at=new Date().toISOString()) {
    const source=JSON.parse(JSON.stringify(this.payload.source));
    const confirmed=Object.values(this.state.confirmations);
    const changes=Object.entries(this.state.transcripts).map(([id,c])=>({clip_id:id,...c,current_source_transcript:this.payload.clips[id].transcript,source_changed_since_edit:c.original_transcript!==this.payload.clips[id].transcript}));
    const clipReviews=(this.payload.clip_selections ?? []).map(c=>({...c,status:"pending",reviewed_by:null,reviewed_at:null,...this.clipReview(c.officer_id,c.clip_id)}));
    const reviewsByClip=new Map();
    for(const item of clipReviews) {if(!reviewsByClip.has(item.clip_id)) reviewsByClip.set(item.clip_id,[]);reviewsByClip.get(item.clip_id).push(item);}
    const clips=Object.fromEntries(Object.entries(this.payload.clips).map(([id,c])=>[id,{...c,original_transcript:c.transcript,transcript:this.transcript(id),transcript_changed:!!this.state.transcripts[id],transcript_change:this.state.transcripts[id] ?? null,personal_clip_reviews:reviewsByClip.get(id) ?? [],confirmed_in_evidence:confirmed.filter(r=>r.clip_ids.includes(id)).map(r=>({record_id:r.record_id,officer_id:r.officer_id,radio_id:r.radio_id,confirmed_by:r.confirmed_by,confirmed_at:r.confirmed_at}))}]));
    for(const record of [...source.associations,...source.review_leads??[],...source.observations??[]]) {
      record.personal_reviews=confirmed.filter(c=>c.record_id===record.record_id);
      record.evidence_transcript_changes=changes.filter(c=>{const clip=clips[c.clip_id];return clip.date===record.date && clip.talkgroup===record.talkgroup && record.clips.includes(clip.number);});
    }
    return {export_schema_version:2,clip_reviews:clipReviews,removed_clips:clipReviews.filter(r=>r.status==="removed"),confirmed_clips:clipReviews.filter(r=>r.status==="confirmed"),exported_at:at,reviewer:this.state.reviewer,notice:"AI assessments and prior source confirmations are preserved separately. Personal confirmations are locally recorded reviewer assertions, not authenticated server updates.",source,clips,transcript_changes:changes,confirmed_associations:confirmed};
  }
};
