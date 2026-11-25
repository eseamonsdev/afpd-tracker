const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
const json = (value,status=200) => Response.json(value,{status,headers});
const validId = value => typeof value==='string' && /^[\w.-]{1,150}$/.test(value);
const validTalkgroup = value => [6001,5922,6036].includes(value);
const validNumbers = value => typeof value==='string' && /^\d+(,\d+)*$/.test(value) &&
  value.split(',').length<=250 && value.split(',').every(n=>Number.isSafeInteger(Number(n)) && Number(n)>0);
const groupSelect = `SELECT e.*, a.officer_key, a.officer_name, a.radio_id, a.source_status
  FROM radio_association_evidence e JOIN radio_associations a ON a.id=e.association_id`;
const clipSelect = `SELECT c.id,c.clip_number,c.archive_date,c.talkgroup_number,c.timestamp_utc,
  c.original_filename,c.archive_path,c.displayed_seconds,c.audio_duration_seconds,c.audio_key,
  c.transcript,c.transcript_validated,
  (SELECT group_concat(radio_id) FROM radio_clip_radio_ids WHERE clip_id=c.id) AS radio_ids
  FROM radio_clips c`;
function clipJson(row) {
  const folder = row.archive_path.replace(/^public\//,'').replace(/\/calls\.json$/,'');
  if (!/^records\/openmhz\/[\w.-]+$/.test(folder) || !/^[\w.-]+\.m4a$/.test(row.original_filename||'')) {
    throw new Error('Invalid recording path');
  }
  return { id:row.id, clip_number:row.clip_number, archive_date:row.archive_date,
    talkgroup:row.talkgroup_number, epoch:Date.parse(row.timestamp_utc)/1000,
    original_filename:row.original_filename, displayed_seconds:row.displayed_seconds,
    audio_duration_seconds:row.audio_duration_seconds,
    source:`/${folder}/${encodeURIComponent(row.original_filename)}`,
    audio_status:row.audio_key ? 'available' : 'unavailable',
    transcript:row.transcript, validated:row.transcript_validated===1,
    radio_ids:row.radio_ids ? row.radio_ids.split(',') : [],
    speaker_confirmed:row.speaker_confirmed===1 };
}
async function evidenceDetail(db,id) {
  const group = await db.prepare(`${groupSelect} WHERE e.id=?`).bind(id).first();
  if (!group) return null;
  const {results} = await db.prepare(`${clipSelect}
    JOIN radio_association_evidence_clips m ON m.clip_id=c.id
    WHERE m.evidence_id=? ORDER BY m.position,c.clip_number`).bind(id).all();
  // Selecting membership's checkbox explicitly keeps it separate from the
  // recording's transcript verification, even when groups share a recording.
  const membership = await db.prepare('SELECT clip_id,speaker_confirmed FROM radio_association_evidence_clips WHERE evidence_id=?').bind(id).all();
  const flags = new Map(membership.results.map(m=>[m.clip_id,m.speaker_confirmed]));
  return { ...group, reviewed:group.reviewed===1,
    source_records:JSON.parse(group.source_json), source_json:undefined,
    clips:results.map(c=>clipJson({...c,speaker_confirmed:flags.get(c.id)})),
    missing_clip_ids:membership.results.filter(m=>!results.some(c=>c.id===m.clip_id)).map(m=>m.clip_id) };
}

async function deleteEvidenceGroup(db,body,adminEmail){
  if(!validId(body.id)||!Number.isSafeInteger(body.revision)||body.revision<0)
    return json({error:'Invalid evidence group deletion'},400);
  const current=await db.prepare(`${groupSelect} WHERE e.id=?`).bind(body.id).first();
  if(!current)return json({error:'Evidence group not found'},404);
  if(current.revision!==body.revision)return json({error:'This group changed. Reload before deleting it.'},409);
  const membership=await db.prepare('SELECT clip_id,position,speaker_confirmed FROM radio_association_evidence_clips WHERE evidence_id=? ORDER BY position,clip_id').bind(body.id).all();
  const association=await db.prepare('SELECT * FROM radio_associations WHERE id=?').bind(current.association_id).first();
  const {officer_key,officer_name,radio_id,source_status,...group}=current;
  const archive={deleted_at:new Date().toISOString(),deleted_by:adminEmail,association,group,clips:membership.results};
  try{
    const results=await db.batch([
      db.prepare('UPDATE radio_association_evidence SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE id=?').bind(body.revision,body.id),
      db.prepare(`INSERT INTO radio_association_assignments (id,kind,source_json)
        SELECT ?,'deleted-evidence-group',? WHERE EXISTS (SELECT 1 FROM radio_association_evidence WHERE id=? AND revision=?)
        ON CONFLICT(id) DO UPDATE SET source_json=excluded.source_json`).bind('deleted-evidence-'+body.id,JSON.stringify(archive),body.id,body.revision+1),
      db.prepare('DELETE FROM radio_association_evidence_clips WHERE evidence_id=?').bind(body.id),
      db.prepare('DELETE FROM radio_association_evidence WHERE id=?').bind(body.id),
      db.prepare('DELETE FROM radio_associations WHERE id=? AND NOT EXISTS (SELECT 1 FROM radio_association_evidence WHERE association_id=?)').bind(current.association_id,current.association_id)
    ]);
    if(results[0].meta?.changes!==1)return json({error:'Evidence group no longer exists'},404);
  }catch(error){
    if(/CHECK constraint failed|revision/i.test(String(error)))return json({error:'This group changed while deleting it. Reload before continuing; nothing was deleted.'},409);
    throw error;
  }
  return json({deleted:true,id:body.id});
}

export async function associationEvidence(request,url,db,adminEmail) {
  if (!db) return json({error:'Database unavailable'},503);
  try {
    if (request.method==='GET') {
      const id=url.searchParams.get('evidence');
      if (id) {
        if (!validId(id)) return json({error:'Invalid evidence ID'},400);
        const group=await evidenceDetail(db,id);
        if (!group) return json({error:'Evidence group not found'},404);
        const numbers=url.searchParams.get('clips');
        if (numbers!==null) {
          const talkgroup=url.searchParams.has('talkgroup')?Number(url.searchParams.get('talkgroup')):group.talkgroup_number;
          if(!validTalkgroup(talkgroup))return json({error:'Invalid talkgroup'},400);
          if (!validNumbers(numbers)) return json({error:'Enter comma-separated clip numbers (up to 250)'},400);
          const values=[...new Set(numbers.split(',').map(Number))];
          const {results}=await db.prepare(`${clipSelect} WHERE c.system='dcfems' AND c.archive_date=? AND c.talkgroup_number=?
            AND c.clip_number IN (SELECT value FROM json_each(?)) ORDER BY c.clip_number`).bind(group.archive_date,talkgroup,JSON.stringify(values)).all();
          return json({clips:results.map(clipJson),missing:values.filter(n=>!results.some(c=>c.clip_number===n))});
        }
        return json({group});
      }
      const status=url.searchParams.get('status')||'unreviewed';
      const scope=url.searchParams.get('scope')||'website';
      const officer=url.searchParams.get('officer')||'';
      const query=(url.searchParams.get('q')||'').trim();
      const offset=Number(url.searchParams.get('offset')||0);
      if (!['all','reviewed','unreviewed'].includes(status) || !['website','all'].includes(scope) ||
          (officer && !validId(officer)) || query.length>150 || !Number.isSafeInteger(offset) || offset<0) return json({error:'Invalid filter'},400);
      const filters=[],values=[];
      if(officer){filters.push('a.officer_key=?');values.push(officer);}
      if(scope==='website')filters.push('e.website_visible=1');
      if(query){filters.push('(a.officer_name LIKE ? OR a.officer_key LIKE ? OR a.radio_id LIKE ?)');values.push(...Array(3).fill(`%${query}%`));}
      const base=filters.length?filters.join(' AND '):'1=1';
      const stats=await db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(e.reviewed),0) AS reviewed
        FROM radio_association_evidence e JOIN radio_associations a ON a.id=e.association_id WHERE ${base}`).bind(...values).first();
      if(status!=='all')filters.push(`e.reviewed=${status==='reviewed'?1:0}`);
      const where=filters.length?filters.join(' AND '):'1=1';
      const {results}=await db.prepare(`SELECT e.id,e.archive_date,e.talkgroup_number,e.reviewed,e.correction_notes,e.website_visible,
        a.radio_id,a.officer_key,a.officer_name,a.source_status,
        (SELECT group_concat(c.clip_number,', ') FROM radio_association_evidence_clips m JOIN radio_clips c ON c.id=m.clip_id WHERE m.evidence_id=e.id ORDER BY m.position) AS clip_numbers,
        (SELECT COUNT(*) FROM radio_association_evidence_clips m WHERE m.evidence_id=e.id AND m.speaker_confirmed=1) AS confirmed_clips
        FROM radio_association_evidence e JOIN radio_associations a ON a.id=e.association_id
        WHERE ${where} ORDER BY a.radio_id,a.officer_name,e.archive_date,e.talkgroup_number,e.id LIMIT 101 OFFSET ?`).bind(...values,offset).all();
      const officers=await db.prepare(`SELECT a.officer_key,MIN(a.officer_name) AS officer_name
        FROM radio_associations a WHERE EXISTS (SELECT 1 FROM radio_association_evidence e WHERE e.association_id=a.id)
        GROUP BY a.officer_key ORDER BY officer_name COLLATE NOCASE,a.officer_key`).bind().all();
      return json({groups:results.slice(0,100),has_more:results.length>100,offset,officers:officers.results,
        counts:{...stats,unreviewed:stats.total-stats.reviewed}});
    }
    if (request.method!=='POST')return new Response(null,{status:405,headers:{...headers,Allow:'GET, POST'}});
    if(request.headers.get('Origin')!==url.origin || !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json({error:'Same-origin JSON request required'},403);
    if(Number(request.headers.get('Content-Length')||0)>500000)return json({error:'Request too large'},413);
    const text=await request.text();if(text.length>500000)return json({error:'Request too large'},413);
    const body=JSON.parse(text);
    if(body.action==='delete')return await deleteEvidenceGroup(db,body,adminEmail);
    if(body.action!==undefined)return json({error:'Unknown evidence action'},400);
    if(!validId(body.id) || !Number.isSafeInteger(body.revision) || body.revision<0 ||
       (body.talkgroup_number!==undefined && !validTalkgroup(body.talkgroup_number)) ||
       typeof body.reviewed!=='boolean' || typeof body.correction_notes!=='string' || body.correction_notes.length>20000 ||
       !Array.isArray(body.clips) || body.clips.length>1000 || body.clips.some(c=>!validId(c.id)||typeof c.speaker_confirmed!=='boolean') ||
       new Set(body.clips.map(c=>c.id)).size!==body.clips.length ||
       !Array.isArray(body.transcripts) || body.transcripts.length>100 || body.transcripts.some(c=>!validId(c.id)||
         typeof c.transcript!=='string'||c.transcript.length>30000||typeof c.validated!=='boolean'||
         !(c.expected_transcript===null||typeof c.expected_transcript==='string')||typeof c.expected_validated!=='boolean') ||
       new Set(body.transcripts.map(c=>c.id)).size!==body.transcripts.length) return json({error:'Invalid evidence changes'},400);
    const current=await evidenceDetail(db,body.id);
    if(!current)return json({error:'Evidence group not found'},404);
    if(current.revision!==body.revision)return json({error:'This group changed. Reload before saving. Your edits have not been saved.'},409);
    const talkgroup=body.talkgroup_number??current.talkgroup_number;
    const talkgroupChanged=talkgroup!==current.talkgroup_number;
    if(talkgroupChanged){
      const conflict=await db.prepare('SELECT id FROM radio_association_evidence WHERE association_id=? AND archive_date=? AND talkgroup_number=? AND id!=?')
        .bind(current.association_id,current.archive_date,talkgroup,current.id).first();
      if(conflict)return json({error:'An evidence group already exists for this officer, radio, date and talkgroup. Open that group instead; neither group was changed.',conflict_evidence_id:conflict.id},409);
    }
    const selectedIds=body.clips.map(c=>c.id);
    const allowedTranscriptIds=new Set([...selectedIds,...current.clips.map(c=>c.id)]);
    if(body.transcripts.some(c=>!allowedTranscriptIds.has(c.id)))return json({error:'Transcript is outside this evidence group'},400);
    let selected=[];
    if(selectedIds.length){
      const result=await db.prepare(`SELECT id,archive_date,talkgroup_number,system,clip_number FROM radio_clips WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(selectedIds)).all();
      selected=result.results;
    }
    if(selected.length!==selectedIds.length || selected.some(c=>c.archive_date!==current.archive_date||c.talkgroup_number!==talkgroup||c.system!=='dcfems'))return json({error:'Selected clips must belong to this group’s date and selected talkgroup. Choose new clips when changing talkgroup.'},400);
    const records=[...current.source_records];
    if(talkgroupChanged)records.push({source:'admin-talkgroup-correction',previous_talkgroup:current.talkgroup_number,
      talkgroup,corrected_at:new Date().toISOString(),corrected_by:adminEmail,previous_reviewed:current.reviewed,
      previous_clips:current.clips.map(c=>({id:c.id,clip_number:c.clip_number,speaker_confirmed:c.speaker_confirmed})),
      evidence:`Talkgroup corrected from ${current.talkgroup_number} to ${talkgroup}. Previous clips: ${current.clips.map(c=>c.clip_number).join(', ')||'none'}. Group reset to Unreviewed.`});
    const reviewed=talkgroupChanged?false:body.reviewed;
    // The CHECK constraint makes a failed compare-and-swap abort the entire D1
    // transaction, including membership, notes, reviewed status and transcripts.
    const guard=`NOT EXISTS (SELECT 1 FROM json_each(?) t LEFT JOIN radio_clips c ON c.id=json_extract(t.value,'$.id')
      WHERE c.id IS NULL OR c.transcript IS NOT json_extract(t.value,'$.expected_transcript') OR c.transcript_validated != json_extract(t.value,'$.expected_validated'))`;
    const statements=[db.prepare(`UPDATE radio_association_evidence SET revision=CASE WHEN revision=? AND ${guard} THEN revision+1 ELSE -1 END,
      reviewed=?,correction_notes=?,talkgroup_number=?,source_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by=? WHERE id=?`).bind(
        body.revision,JSON.stringify(body.transcripts),Number(reviewed),body.correction_notes,talkgroup,JSON.stringify(records),adminEmail,body.id)];
    statements.push(db.prepare('DELETE FROM radio_association_evidence_clips WHERE evidence_id=?').bind(body.id));
    for(const c of body.clips)statements.push(db.prepare(`INSERT INTO radio_association_evidence_clips (evidence_id,clip_id,position,speaker_confirmed) VALUES (?,?,?,?)`).bind(
      body.id,c.id,selected.find(row=>row.id===c.id).clip_number,Number(c.speaker_confirmed)));
    for(const c of body.transcripts)statements.push(db.prepare('UPDATE radio_clips SET transcript=?,transcript_validated=? WHERE id=?').bind(c.transcript,Number(c.validated),c.id));
    try{await db.batch(statements);}catch(error){
      if(/CHECK constraint failed|revision/i.test(String(error)))return json({error:'The group or a transcript changed since you opened it. Reload before saving.'},409);
      if(/UNIQUE constraint failed/i.test(String(error)))return json({error:'A group for that date and talkgroup was created while saving. Reload before continuing; no changes were saved.'},409);
      throw error;
    }
    return json({saved:true,revision:body.revision+1,talkgroup_number:talkgroup,reviewed,source_records:records});
  }catch(error){
    if(error instanceof SyntaxError)return json({error:'Invalid JSON'},400);
    console.error('Association evidence database error',error);
    return json({error:'Unable to load or save evidence. Your unsaved changes are still here.'},503);
  }
}
