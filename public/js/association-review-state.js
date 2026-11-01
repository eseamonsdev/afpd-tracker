/* Shared by the static page and the export tests. No server writes. */
globalThis.AFPDReviewState = class AFPDReviewState {
  constructor(payload, saved = {}) {
    this.payload = payload;
    this.state = {schema_version:1,reviewer:typeof saved.reviewer==="string" ? saved.reviewer : "",transcripts:{},confirmations:{}};
    for(const [id,change] of Object.entries(saved.transcripts ?? {})) {
      if(payload.clips[id] && typeof change?.text === "string" && typeof change.original_transcript === "string") this.state.transcripts[id]=change;
    }
    for(const [key,confirmation] of Object.entries(saved.confirmations ?? {})) {
      if(confirmation?.confirmed===true && Array.isArray(confirmation.clip_ids) && confirmation.clip_ids.every(id=>payload.clips[id]) && payload.source.officers[confirmation.officer_id] && !payload.source.excluded_candidates?.[confirmation.officer_id]) this.state.confirmations[key]=confirmation;
    }
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
    if(!/^[1-9]\d*$/.test(record.radio_id)) throw new Error("Enter the radio ID you have verified.");
    if(!record.clip_ids.length || record.clip_ids.some(id=>!clips[id] || clips[id].date!==record.date || clips[id].talkgroup!==record.talkgroup)) throw new Error("Select at least one evidence clip from this date and talkgroup.");
    this.state.confirmations[key]={...record,confirmed:true,confirmed_by:this.state.reviewer.trim(),confirmed_at:at};
  }
  unconfirm(key) { delete this.state.confirmations[key]; }
  export(at=new Date().toISOString()) {
    const source=JSON.parse(JSON.stringify(this.payload.source));
    const confirmed=Object.values(this.state.confirmations);
    const changes=Object.entries(this.state.transcripts).map(([id,c])=>({clip_id:id,...c,current_source_transcript:this.payload.clips[id].transcript,source_changed_since_edit:c.original_transcript!==this.payload.clips[id].transcript}));
    const clips=Object.fromEntries(Object.entries(this.payload.clips).map(([id,c])=>[id,{...c,original_transcript:c.transcript,transcript:this.transcript(id),transcript_changed:!!this.state.transcripts[id],transcript_change:this.state.transcripts[id] ?? null,confirmed_in_evidence:confirmed.filter(r=>r.clip_ids.includes(id)).map(r=>({record_id:r.record_id,officer_id:r.officer_id,radio_id:r.radio_id,confirmed_by:r.confirmed_by,confirmed_at:r.confirmed_at}))}]));
    for(const record of [...source.associations,...source.review_leads??[],...source.observations??[]]) {
      record.personal_reviews=confirmed.filter(c=>c.record_id===record.record_id);
      record.evidence_transcript_changes=changes.filter(c=>{const clip=clips[c.clip_id];return clip.date===record.date && clip.talkgroup===record.talkgroup && record.clips.includes(clip.number);});
    }
    return {export_schema_version:1,exported_at:at,reviewer:this.state.reviewer,notice:"AI assessments and prior source confirmations are preserved separately. Personal confirmations are locally recorded reviewer assertions, not authenticated server updates.",source,clips,transcript_changes:changes,confirmed_associations:confirmed};
  }
};
