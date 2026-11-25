// Full-day admin integration. Appending evidence never replaces a selection.
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const validId=value=>typeof value==='string'&&/^[\w.-]{1,150}$/.test(value);
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validTalkgroup=value=>value===6001||value===5922;
const officerSql=`SELECT o.url_slug AS officer_key,n.name_text AS officer_name
  FROM officers o JOIN officer_names n ON n.id=o.display_name_id AND n.officer_id=o.id
  UNION ALL SELECT a.officer_key,MIN(a.officer_name) AS officer_name FROM radio_associations a
  WHERE NOT EXISTS (SELECT 1 FROM officers o WHERE o.url_slug=a.officer_key) GROUP BY a.officer_key`;

async function stableId(prefix,key){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  return prefix+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
}

async function appendEvidence(db,body,adminEmail){
  const officer=await db.prepare(`SELECT * FROM (${officerSql}) WHERE officer_key=? LIMIT 1`).bind(body.officer_key).first();
  if(!officer)return json({error:'Choose an officer from the evidence directory.'},400);
  const radio=await db.prepare('SELECT radio_id FROM radio_ids WHERE radio_id=?').bind(body.radio_id).first();
  if(!radio)return json({error:'That radio ID is not in the archive database.'},400);
  const selected=await db.prepare(`SELECT id,clip_number FROM radio_clips WHERE system='dcfems'
    AND archive_date=? AND talkgroup_number=? AND id IN (SELECT value FROM json_each(?)) ORDER BY clip_number`)
    .bind(body.date,body.talkgroup,JSON.stringify(body.clip_ids)).all();
  if(selected.results.length!==body.clip_ids.length)return json({error:'Every clip must belong to the selected day and talkgroup.'},400);
  const associationKey=`${body.officer_key}/${body.radio_id}`;
  const newAssociationId=await stableId('association-',associationKey);
  const newEvidenceId=await stableId('evidence-',`${associationKey}/${body.date}/${body.talkgroup}`);
  for(let attempt=0;attempt<3;attempt++){
    const association=await db.prepare('SELECT id FROM radio_associations WHERE officer_key=? AND radio_id=?')
      .bind(body.officer_key,body.radio_id).first();
    const associationId=association?.id||newAssociationId;
    const group=await db.prepare(`SELECT id,revision,reviewed,source_json FROM radio_association_evidence
      WHERE association_id=? AND archive_date=? AND talkgroup_number=?`)
      .bind(associationId,body.date,body.talkgroup).first();
    const evidenceId=group?.id||newEvidenceId;
    const membership=group?await db.prepare('SELECT clip_id FROM radio_association_evidence_clips WHERE evidence_id=?').bind(evidenceId).all():{results:[]};
    const existing=new Set(membership.results.map(row=>row.clip_id));
    const additions=selected.results.filter(clip=>!existing.has(clip.id));
    if(!additions.length)return json({evidence_id:evidenceId,added:0,total:existing.size,created:false,reviewed:group.reviewed===1});
    const records=group?JSON.parse(group.source_json):[];
    records.push({source:'admin-full-day-evidence',added_by:adminEmail,added_at:new Date().toISOString(),
      date:body.date,talkgroup:body.talkgroup,clip_ids:additions.map(c=>c.id),clips:additions.map(c=>c.clip_number),
      association_reviewed:false,evidence:`Added from the full-day admin editor: ${body.date}, talkgroup ${body.talkgroup}, clips ${additions.map(c=>c.clip_number).join(', ')}. Pending personal evidence review.`});
    const statements=[
      db.prepare(`INSERT OR IGNORE INTO radio_associations
        (id,officer_key,officer_name,radio_id,source_status,website_visible,source_json) VALUES (?,?,?,?,?,1,?)`)
        .bind(newAssociationId,body.officer_key,officer.officer_name,body.radio_id,'Pending evidence review',JSON.stringify({source:'admin-full-day-evidence',general_confirmed:false})),
      db.prepare(`INSERT OR IGNORE INTO radio_association_evidence
        (id,association_id,archive_date,talkgroup_number,website_visible,source_json) VALUES (?,?,?,?,1,'[]')`)
        .bind(newEvidenceId,associationId,body.date,body.talkgroup),
      // A failed compare-and-swap violates revision's CHECK and rolls the whole
      // D1 batch back. Retry against the newer notes, flags and membership.
      db.prepare(`UPDATE radio_association_evidence SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END,
        reviewed=0,source_json=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by=? WHERE id=?`)
        .bind(group?.revision||0,JSON.stringify(records),adminEmail,evidenceId),
      db.prepare(`INSERT OR IGNORE INTO radio_association_evidence_clips (evidence_id,clip_id,position,speaker_confirmed)
        SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.clip_number'),0 FROM json_each(?)`)
        .bind(evidenceId,JSON.stringify(additions))
    ];
    try{
      const results=await db.batch(statements);
      if(results[2].meta?.changes!==1)continue;
      return json({evidence_id:evidenceId,added:additions.length,total:existing.size+additions.length,created:!group,reviewed:false});
    }catch(error){
      if(/CHECK constraint failed|revision|UNIQUE constraint|FOREIGN KEY constraint/i.test(String(error)))continue;
      throw error;
    }
  }
  return json({error:'The evidence group changed while adding clips. Try again; existing reviews have been preserved.'},409);
}

export async function radioEvidence(request,url,db,adminEmail){
  if(!db)return json({error:'Evidence database unavailable'},503);
  try{
    if(request.method==='GET'){
      const date=url.searchParams.get('date'),talkgroup=Number(url.searchParams.get('talkgroup'));
      if(!validDay(date)||!validTalkgroup(talkgroup))return json({error:'Invalid day or talkgroup'},400);
      const [officers,memberships,radios]=await Promise.all([
        db.prepare(`SELECT * FROM (${officerSql}) ORDER BY officer_name COLLATE NOCASE,officer_key`).bind().all(),
        db.prepare(`SELECT m.clip_id,e.id AS evidence_id,a.officer_key,a.officer_name,a.radio_id
          FROM radio_clips c JOIN radio_association_evidence_clips m ON m.clip_id=c.id
          JOIN radio_association_evidence e ON e.id=m.evidence_id JOIN radio_associations a ON a.id=e.association_id
          WHERE c.system='dcfems' AND c.archive_date=? AND c.talkgroup_number=?
          ORDER BY c.clip_number,a.officer_name,a.radio_id,e.id`).bind(date,talkgroup).all(),
        db.prepare(`SELECT DISTINCT r.radio_id FROM radio_clips c JOIN radio_clip_radio_ids r ON r.clip_id=c.id
          WHERE c.system='dcfems' AND c.archive_date=? AND c.talkgroup_number=? ORDER BY r.radio_id`).bind(date,talkgroup).all()
      ]);
      return json({officers:officers.results,memberships:memberships.results,radio_ids:radios.results.map(r=>r.radio_id)});
    }
    if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,Allow:'GET, POST'}});
    if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json({error:'Same-origin JSON request required'},403);
    if(Number(request.headers.get('Content-Length')||0)>100000)return json({error:'Request too large'},413);
    const text=await request.text();if(text.length>100000)return json({error:'Request too large'},413);
    const body=JSON.parse(text);
    if(body.action!=='append'||!validId(body.officer_key)||typeof body.radio_id!=='string'||!/^[1-9]\d{0,19}$/.test(body.radio_id)||
      !validDay(body.date)||!validTalkgroup(body.talkgroup)||!Array.isArray(body.clip_ids)||body.clip_ids.length<1||body.clip_ids.length>250||
      body.clip_ids.some(id=>!validId(id))||new Set(body.clip_ids).size!==body.clip_ids.length)return json({error:'Invalid evidence selection'},400);
    return await appendEvidence(db,body,adminEmail);
  }catch(error){
    if(error instanceof SyntaxError)return json({error:'Invalid JSON'},400);
    console.error('Full-day evidence error',error);
    return json({error:'Unable to load or add evidence. Transcript editing and playback are separate.'},503);
  }
}
