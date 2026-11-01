// Frozen production entries are retained by explicit author instruction. This
// imports no pending candidates and grants no new personal verification.
export function withProductionAssociationBaseline(source) {
  const baseline = source.production_association_baseline;
  if (!baseline) return source;
  if (baseline.schema_version !== 1 || !baseline.associations || !baseline.days) throw new Error('Invalid production association baseline');
  const rows = [], strongPairs = [];
  for (const [radio, entries] of Object.entries(baseline.associations)) for (const entry of entries) {
    if (entry.status !== 'strong' || !source.officers[entry.officer_id]) throw new Error('Invalid production strong association');
    const key = `${entry.officer_id}/${radio}`;
    strongPairs.push(key);
    for (const date of entry.evidence_dates) rows.push({
      record_id:`production-strong-${entry.officer_id}-${radio}-${date}`, officer_id:entry.officer_id, radio_id:radio,
      date, talkgroup:6001, clips:[], status:'supporting', confirmed_by:null,
      association_reviewed:true, production_baseline:true,
      association_review_basis:'Protected production strong association',
      evidence:`Production retained ${entry.name} as a strong association on radio ${radio}, with ${date} in its evidence dates. Original evidence and attribution are retained in data/production-officer-association-baseline.json.`,
      source_url:baseline.source_url
    });
  }
  for (const [date, radios] of Object.entries(baseline.days)) for (const [radio, entries] of Object.entries(radios)) for (const entry of entries) {
    if (entry.status !== 'confirmed' || !source.officers[entry.officer_id]) throw new Error('Invalid production dated confirmation');
    const evidence = entry.evidence?.length ? entry.evidence : [{talkgroup:6001,clips:[],evidence:'Confirmed dated association retained from production.',confirmed_by:null}];
    evidence.forEach((item,index)=>rows.push({
      record_id:`production-confirmed-${entry.officer_id}-${radio}-${date}-${index}`, officer_id:entry.officer_id, radio_id:radio,
      date, talkgroup:item.talkgroup, clips:item.clips ?? [], status:'confirmed', confirmed_by:item.confirmed_by ?? null,
      association_reviewed:true, production_baseline:true, production_confirmed:true,
      association_review_basis:'Protected production dated confirmation; original verifier attribution retained',
      evidence:item.evidence, source_url:baseline.source_url
    }));
  }
  const protectedDates = new Map();
  for (const [date, radios] of Object.entries(baseline.days)) for (const [radio, entries] of Object.entries(radios))
    protectedDates.set(`${date}/${radio}`, new Set(entries.map(entry => entry.officer_id)));
  const additions = source.associations.filter(row => !row.production_baseline).map(row => {
    const identities = protectedDates.get(`${row.date}/${row.radio_id}`);
    return identities && !identities.has(row.officer_id)
      ? {...row, production_date_conflict:true} : row;
  });
  return {...source, associations:[...additions,...rows],
    display_policy:{...source.display_policy,production_strong_pairs:strongPairs,
      accepted_general_pairs:[...new Set([...(source.display_policy?.accepted_general_pairs ?? []),...strongPairs])]},
    // Historical holds that production no longer applied must not hide the
    // preserved production labels. Dated confirmations still take precedence.
    withheld_dates:baseline.withheld_dates ?? {}};
}
