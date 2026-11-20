// Convert a completed browser collection into the audio downloader's source format.
// No audio downloads, queue requests, or archive changes.
function prepareMetadata(data, summary) {
  const names = {6001: 'American Fork PD Car to Car', 5922: 'Law 2 Northeast', 6036: 'American Fork Police'};
  const zone = 'America/Denver', day = data.date, tg = data.talkgroup;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0,10) !== day)
    throw Error('Invalid calendar date');
  if (data.system !== 'dcfems' || data.timezone !== zone || !names[tg] || !Array.isArray(data.calls))
    throw Error('Unsupported collection identity');
  if (summary.status !== 'complete' || !summary.olderBoundaryReached || !summary.newerBoundaryReached ||
      summary.date !== day || summary.talkgroup !== tg || summary.system !== data.system ||
      summary.timezone !== zone || summary.count !== data.calls.length)
    throw Error('Collection must be complete and match its summary');
  function midnight(date) {
    const target = Date.parse(date + 'T00:00:00Z');
    let value = target;
    const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
    for (let i=0; i<4; i++) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(value)).map(x=>[x.type,x.value]));
      value += target - Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'Z');
    }
    return value;
  }
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
  const start = midnight(day), end = midnight(next);
  if (end > Date.now()) throw Error('Cannot publish unfinished day');
  const ids = new Set();
  const calls = data.calls.map(c => {
    const ms = Date.parse(c.time), epoch = Math.floor(ms/1000);
    if (!Number.isFinite(ms) || ms < start || ms >= end || c.talkgroupNum !== tg ||
        typeof c._id !== 'string' || !c._id || ids.has(c._id) ||
        typeof c.len !== 'number' || !Number.isFinite(c.len) || c.len < 0)
      throw Error('Invalid, duplicate, or out-of-day call');
    ids.add(c._id);
    const filename = 'dcfems-'+tg+'-'+epoch+'.m4a';
    const mediaBase = String(c.url).split('?')[0];
    if (String(c.url).includes('#') ||
        !['https://media.openmhz.com/media/dcfems/','https://media2.openmhz.com/media/dcfems/']
          .some(base => mediaBase === base+tg+'/'+filename))
      throw Error('Unexpected source audio URL');
    const radioIds = [...new Set((c.srcList || []).filter(s => s && /^\d+$/.test(String(s.src)) &&
      Number.isSafeInteger(Number(s.src)) && Number(s.src)>1).map(s => String(s.src)))];
    return {...c, id:c._id, epoch, displayed_seconds:c.len, talkgroup:tg,
      original_filename:filename, media_url:c.url, media_url_source:'OpenMHz browser call metadata',
      call_link:'https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code='+tg+
        '&call-id='+encodeURIComponent(c._id)+'&time='+ms,
      radio_ids:radioIds, source_api_time:c.time, source_api_filename:c.filename,
      frequency_hz:c.freq, timestamp_utc:new Date(ms).toISOString(), talkgroup_name:names[tg],
      original_transcript:null};
  }).sort((a,b)=>a.epoch-b.epoch || a.id.localeCompare(b.id));
  return {schema_version:1, date:day, timezone:zone, system:'dcfems', talkgroup:tg,
    talkgroup_name:names[tg], count:calls.length, source_call_count:calls.length,
    coverage:'complete', coverage_note:'Browser collection reached both Mountain Time date boundaries.',
    start_utc:new Date(start).toISOString(), end_utc_exclusive:new Date(end).toISOString(),
    collected_through_utc:new Date(end).toISOString(),
    collection:{method:'OpenMHz browser page pagination', collected_at_utc:summary.finishedAt || null,
      date_window_paged:true, partial:false, audio_downloaded:false, list_requests:summary.listRequests,
      older_boundary_reached:true, newer_boundary_reached:true,
      buffer_after_response_ms:summary.bufferAfterResponseMs},
    calls};
}

module.exports = { prepareMetadata };
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const [input, summaryPath, output] = process.argv.slice(2);
  if (!input || !summaryPath || !output) throw Error('Usage: node prepare-metadata.cjs INPUT SUMMARY OUTPUT');
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (process.env.DATE && process.env.DATE !== data.date) throw Error('Requested date mismatch');
  if (process.env.TALKGROUP && Number(process.env.TALKGROUP) !== data.talkgroup) throw Error('Requested talkgroup mismatch');
  const result = prepareMetadata(data, summary);
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
  console.log('Prepared '+result.count+' calls for audio downloads: '+output);
}
