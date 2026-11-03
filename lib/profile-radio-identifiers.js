// Build-time view only: profile radio IDs come from the shared association compiler.
export function withProfileRadioIdentifiers(page, profiles) {
  if(page.type!=="officer-page")return page;
  const slug=/^\/officers\/([^/]+)\/$/.exec(page.url??"")?.[1];
  const identifiers=profiles[slug]??[];
  const hasVisibleIdentifiers=identifiers.length>0||(page.observed_officer_ids??[]).some(row=>row.type==="call-sign");
  const sections=(page.sections??[]).filter(section=>section.id!=="observed-agency-ids"||hasVisibleIdentifiers);
  if(identifiers.length&&!sections.some(s=>s.id==="observed-agency-ids")) {
    const afterOverview=sections.findIndex(s=>s.id==="overview")+1;
    sections.splice(afterOverview,0,{id:"observed-agency-ids",title:"Observed Officer IDs"});
  }
  return {...page,sections,radio_identifiers:identifiers};
}
