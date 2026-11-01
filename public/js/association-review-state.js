/* Shared by the static page and the export tests. No server writes. */
globalThis.AFPDReviewState = class AFPDReviewState {
  constructor(payload, saved = {}) {
    this.payload = payload;
    this.state = {schema_version:2,reviewer:typeof saved.reviewer==="string" ? saved.reviewer : "",transcripts:{},confirmations:{},clip_reviews:{},evidence_reviews:{},dialogue_policy_revision:1};
    this.selections=new Set((payload.clip_selections ?? []).map(c=>JSON.stringify([c.officer_id,c.clip_id])));
    for(const [key,change] of Object.entries(saved.clip_reviews ?? {})) {
      if(change && key===JSON.stringify([change.officer_id,change.clip_id]) && this.selections.has(key) && ["removed","confirmed"].includes(change.status)) this.state.clip_reviews[key]=change;
    }
    this.selectionDetails=new Map((payload.clip_selections ?? []).map(c=>[JSON.stringify([c.officer_id,c.clip_id]),c]));
    for(const [key,change] of Object.entries(saved.evidence_reviews ?? {})) {
      if(change && key===JSON.stringify([change.officer_id,change.clip_id]) && this.selections.has(key) && typeof change.included==="boolean") this.state.evidence_reviews[key]=change;
    }
    // Bring prior removals, clip confirmations and association evidence selections forward.
    for(const item of Object.values(this.state.clip_reviews)) {
      const key=JSON.stringify([item.officer_id,item.clip_id]);
      if(!this.state.evidence_reviews[key]) this.state.evidence_reviews[key]={officer_id:item.officer_id,clip_id:item.clip_id,included:item.status==="confirmed",reviewed_at:item.reviewed_at,reviewed_by:item.reviewed_by,migrated_from:item.status};
    }
    for(const confirmation of Object.values(saved.confirmations ?? {})) {
      if(confirmation?.confirmed!==true || !Array.isArray(confirmation.clip_ids) || !this.eligibleRecord(confirmation)) continue;
      for(const id of confirmation.clip_ids) {
        const key=JSON.stringify([confirmation.officer_id,id]);
        if(this.selections.has(key) && !this.state.evidence_reviews[key]) this.state.evidence_reviews[key]={officer_id:confirmation.officer_id,clip_id:id,included:true,reviewed_at:confirmation.confirmed_at,reviewed_by:confirmation.confirmed_by,migrated_from:"association_confirmation"};
      }
    }
    // A one-time policy migration clears stale checked context without deleting review history.
    if(saved.dialogue_policy_revision!==1) for(const selection of payload.clip_selections ?? []) {
      if(selection.evidence===false && ["transcript_dialogue","unassigned_context"].includes(selection.attribution_basis)) {
        const key=JSON.stringify([selection.officer_id,selection.clip_id]);
        const previous=this.state.evidence_reviews[key];
        if(previous?.included) this.state.evidence_reviews[key]={officer_id:selection.officer_id,clip_id:selection.clip_id,included:false,reviewed_by:null,reviewed_at:null,reason:selection.context_reason,policy_migration:"Unanswered or unresolved context is unchecked",previous_choice:previous};
      }
    }
    for(const [id,change] of Object.entries(saved.transcripts ?? {})) {
      if(payload.clips[id] && typeof change?.text === "string" && typeof change.original_transcript === "string") this.state.transcripts[id]=change;
    }
    for(const [key,confirmation] of Object.entries(saved.confirmations ?? {})) {
      if(confirmation?.confirmed===true && Array.isArray(confirmation.clip_ids) && confirmation.clip_ids.every(id=>payload.clips[id] && (!this.selections.has(JSON.stringify([confirmation.officer_id,id])) || this.evidenceSelected(confirmation.officer_id,id))) && payload.source.officers[confirmation.officer_id] && !payload.source.excluded_candidates?.[confirmation.officer_id] && this.eligibleRecord(confirmation)) this.state.confirmations[key]=confirmation;
    }
  }
  evidenceSelected(officerId,clipId) {
    const key=JSON.stringify([officerId,clipId]);
    return this.state.evidence_reviews[key]?.included ?? this.selectionDetails.get(key)?.evidence ?? false;
  }
  setEvidence(officerId,clipId,included,at=new Date().toISOString()) {
    const key=JSON.stringify([officerId,clipId]);
    if(!this.selections.has(key)) throw new Error("Unknown officer clip selection.");
    if(typeof included!=="boolean") throw new Error("Evidence choice must be checked or unchecked.");
    this.state.evidence_reviews[key]={officer_id:officerId,clip_id:clipId,included,reviewed_at:at,reviewed_by:this.state.reviewer.trim() || null};
    if(!included) for(const [id,confirmation] of Object.entries(this.state.confirmations)) {
      if(confirmation.officer_id===officerId && confirmation.clip_ids.includes(clipId)) delete this.state.confirmations[id];
    }
  }
  clipReview(officerId,clipId) { return this.state.clip_reviews[JSON.stringify([officerId,clipId])] ?? null; }
  markClip(officerId,clipId,status,at=new Date().toISOString()) {
    const key=JSON.stringify([officerId,clipId]);
    if(!this.selections.has(key)) throw new Error("Unknown officer clip selection.");
    if(!["pending","removed","confirmed"].includes(status)) throw new Error("Invalid clip review status.");
    if(status==="pending") delete this.state.clip_reviews[key];
    else this.state.clip_reviews[key]={officer_id:officerId,clip_id:clipId,status,reviewed_by:this.state.reviewer.trim() || null,reviewed_at:at};
    if(status==="pending") delete this.state.evidence_reviews[key];
    else this.setEvidence(officerId,clipId,status==="confirmed",at);
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
    const clipReviews=(this.payload.clip_selections ?? []).map(c=>({...c,status:this.evidenceSelected(c.officer_id,c.clip_id)?"evidence":"context",previous_clip_review:this.clipReview(c.officer_id,c.clip_id),reviewed_by:this.state.evidence_reviews[JSON.stringify([c.officer_id,c.clip_id])]?.reviewed_by ?? null,reviewed_at:this.state.evidence_reviews[JSON.stringify([c.officer_id,c.clip_id])]?.reviewed_at ?? null,evidence_selected:this.evidenceSelected(c.officer_id,c.clip_id),originally_evidence:c.evidence===true,evidence_review:this.state.evidence_reviews[JSON.stringify([c.officer_id,c.clip_id])] ?? null}));
    const radioGroups=new Map();
    for(const row of clipReviews.filter(r=>r.evidence_selected)) for(const radioId of row.evidence_radio_ids ?? []) {
      const key=JSON.stringify([row.officer_id,radioId,row.date,row.talkgroup]);
      if(!radioGroups.has(key))radioGroups.set(key,{officer_id:row.officer_id,radio_id:radioId,date:row.date,talkgroup:row.talkgroup,clip_ids:[],exchange_ids:[],assessment:"Provisional evidence; personal verification is separate."});
      const group=radioGroups.get(key);group.clip_ids.push(row.clip_id);
      group.exchange_ids=[...new Set([...group.exchange_ids,...(row.dialogue_exchanges??[]).filter(e=>e.target_radio_id===radioId).map(e=>e.exchange_id)])];
    }
    const radioEvidence=[...radioGroups.values()];
    const reviewsByClip=new Map();
    for(const item of clipReviews) {if(!reviewsByClip.has(item.clip_id)) reviewsByClip.set(item.clip_id,[]);reviewsByClip.get(item.clip_id).push(item);}
    const clips=Object.fromEntries(Object.entries(this.payload.clips).map(([id,c])=>[id,{...c,original_transcript:c.transcript,transcript:this.transcript(id),transcript_changed:!!this.state.transcripts[id],transcript_change:this.state.transcripts[id] ?? null,personal_clip_reviews:reviewsByClip.get(id) ?? [],confirmed_in_evidence:confirmed.filter(r=>r.clip_ids.includes(id)).map(r=>({record_id:r.record_id,officer_id:r.officer_id,radio_id:r.radio_id,confirmed_by:r.confirmed_by,confirmed_at:r.confirmed_at}))}]));
    for(const record of [...source.associations,...source.review_leads??[],...source.observations??[]]) {
      record.personal_reviews=confirmed.filter(c=>c.record_id===record.record_id);
      record.evidence_transcript_changes=changes.filter(c=>{const clip=clips[c.clip_id];return clip.date===record.date && clip.talkgroup===record.talkgroup && record.clips.includes(clip.number);});
    }
    return {export_schema_version:4,radio_evidence:radioEvidence,evidence_clips:clipReviews.filter(r=>r.evidence_selected),context_clips:clipReviews.filter(r=>!r.evidence_selected),evidence_changes:Object.values(this.state.evidence_reviews),removed_from_evidence_clips:clipReviews.filter(r=>r.originally_evidence && !r.evidence_selected),clip_reviews:clipReviews,legacy_clip_reviews:Object.values(this.state.clip_reviews),removed_clips:clipReviews.filter(r=>!r.evidence_selected && (r.originally_evidence || r.previous_clip_review?.status==="removed")),confirmed_clips:clipReviews.filter(r=>r.evidence_selected && r.previous_clip_review?.status==="confirmed"),exported_at:at,reviewer:this.state.reviewer,notice:"AI assessments and prior source confirmations are preserved separately. Personal confirmations are locally recorded reviewer assertions, not authenticated server updates.",source,clips,transcript_changes:changes,confirmed_associations:confirmed};
  }
};
