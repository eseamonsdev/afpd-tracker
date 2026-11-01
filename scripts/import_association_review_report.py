#!/usr/bin/env python3
"""Merge the expanded AI report without changing any original association verdict.
Usage: python scripts/import_association_review_report.py REPORT.html [ROOT]
New search hits are review leads, not inferred radio assignments.
"""
import sys, json, re, hashlib
from pathlib import Path
from html.parser import HTMLParser
class Node:
 def __init__(self,tag='',attrs=(),parent=None):self.tag=tag;self.attrs=dict(attrs);self.children=[];self.parent=parent
 def text(self):return ''.join(c if isinstance(c,str) else c.text() for c in self.children)
 def find(self,pred):
  for c in self.children:
   if isinstance(c,Node):
    if pred(c):yield c
    yield from c.find(pred)
class Parser(HTMLParser):
 def __init__(self,text):
  super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.feed(text)
 def handle_starttag(self,t,a):
  n=Node(t,a,self.stack[-1]);self.stack[-1].children.append(n)
  if t not in ['br','hr','meta','link','input','img','source','wbr']:self.stack.append(n)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,d):self.stack[-1].children.append(d)

def merge(report_path, root):
 raw=report_path.read_bytes()
 report=Parser(raw.decode()).root
 file=root/'data/officer-association-evidence.json'
 source=json.loads(file.read_text())
 manifests={}
 def clips_for(element):
  refs=[]
  for clip in element.find(lambda n:'clip' in n.attrs.get('class','').split()):
   head=next(clip.find(lambda n:'cliphead' in n.attrs.get('class','').split()),None)
   if not head:continue
   m=re.match(r'(6001|5922):(\d{4}-\d{2}-\d{2}):(\d+)',head.text())
   if not m:continue
   tg,date,oldnumber=int(m[1]),m[2],int(m[3])
   key=(tg,date)
   if key not in manifests:
    folder=f"openmhz-afpd-{'car-to-car' if tg==6001 else 'law-2'}-{date}"
    calls=json.loads((root/'public/records/openmhz'/folder/'calls.json').read_text())['calls']
    manifests[key]=sorted(calls,key=lambda c:c['epoch'])
   calls=manifests[key]
   match=re.search(r'dcfems-\d+-\d+\.m4a',clip.text())
   if not match:raise ValueError('No recording filename: '+head.text())
   number=next((i+1 for i,c in enumerate(calls) if c['original_filename']==match[0]),None)
   if number is None:raise ValueError('Missing recording '+match[0])
   refs.append({'talkgroup':tg,'date':date,'number':number,'report_number':oldnumber,'filename':match[0]})
  return refs
 reviews=[];leads=[]
 for e in report.find(lambda n:re.fullmatch(r'[ANVO]\d+',n.attrs.get('id',''))):
  id=e.attrs['id'];summary=next(c for c in e.children if isinstance(c,Node) and c.tag=='summary')
  detail=next(c for c in e.children if isinstance(c,Node) and c.tag=='div')
  paras=[c.text() for c in detail.children if isinstance(c,Node) and c.tag=='p']
  badge=next(summary.find(lambda n:'badge' in n.attrs.get('class','').split()),None)
  refs=clips_for(e)
  item={'report_id':id,'summary':summary.text(),'ai_assessment':badge.text() if badge else '',
        'evidence':paras[0] if paras else '', 'report_notes':[p for p in paras[1:] if not p.startswith('Search-matched full-name candidates: ')], 'original_report_notes':paras[1:], 'clip_references':refs,'review_status':'pending'}
  if id.startswith(('A','O')):
   item['source_record_ids']=[n.text() for n in e.find(lambda n:n.tag=='strong') if any(r.get('record_id')==n.text() for r in source['associations']+source.get('observations',[]))]
   if id.startswith('O'):
    ordinal=int(id[1:])-1
    if ordinal<len(source.get('observations',[])):item['source_record_ids']=[source['observations'][ordinal]['record_id']]
   reviews.append(item);continue
  cue=re.search(r'(6001|5922):(\d{4}-\d{2}-\d{2}):(\d+) · (.*)',summary.text().split(badge.text())[0] if badge else summary.text())
  if not cue:raise ValueError('Missing cue '+id)
  tg,date=int(cue[1]),cue[2]
  cue_ref=next(r for r in refs if r['talkgroup']==tg and r['date']==date)
  names=[]
  for p in paras:
   if p.startswith('Search-matched full-name candidates: '):names=p.split(': ',1)[1].split('; ')
  candidate_ids=[]
  for name in names:
   slug=next((k for k,v in source['officers'].items() if v['name'].casefold()==name.casefold()),None)
   if not slug:
    slug=re.sub('[^a-z0-9]+','-',name.lower()).strip('-')
    source['officers'].setdefault(slug,{'name':name,'heard':cue[4],'url':'','candidate_source':'AI report search match; roster identity unverified'})
   if slug!='philip-w-s-craig' and slug not in source.get('excluded_candidates',{}):candidate_ids.append(slug)
  if not candidate_ids:
   family=cue[4].removeprefix('search family ').strip()
   # Search families remain hypotheses, including similarly spelled roster names.
   terms=[t.lower() for t in re.split(r'[/ ]',family) if len(t)>2]
   candidate_ids=[k for k,v in source['officers'].items() if k!='philip-w-s-craig' and k not in source.get('excluded_candidates',{}) and any(t in v['name'].lower() for t in terms)]
  if not candidate_ids:
   slug='unresolved-cue-'+re.sub('[^a-z0-9]+','-',cue[4].lower()).strip('-')
   source['officers'].setdefault(slug,{'name':cue[4]+' (unresolved search cue)','heard':cue[4],'url':''})
   candidate_ids=[slug]
  calls=manifests[(tg,date)];number=cue_ref['number']
  context=list(range(max(1,number-2),min(len(calls),number+2)+1))
  item.update(record_id='ai-report-'+id, date=date,talkgroup=tg,clips=context,cue_clips=[number],
       name_heard=cue[4],candidate_officer_ids=candidate_ids,
       candidate_radio_ids=sorted(set(str(r) for n in context for r in ((calls[n-1].get('radio_ids') or [])+[v['src'] for v in (calls[n-1].get('srcList') or [])]) if str(r).isdigit())),
       status='unassigned',source='ai_report_search_lead')
  leads.append(item)
 source['ai_reviews']=reviews
 source['review_leads']=leads
 source.setdefault('excluded_candidates',{}).setdefault('philip-w-s-craig','Excluded by author: left the department years before these recordings. Original records preserved for provenance only.')
 source['review_notice']='This table contains officer–radio associations compiled and reviewed with AI assistance. Personal verification by the site’s author is pending. Unless explicitly marked personally verified, associations remain provisional and may include errors, conflicting evidence, or alternative identities.'
 source['ai_report_import']={'filename':report_path.name,'sha256':hashlib.sha256(raw).hexdigest(),'original_associations':len(source['associations']),'existing_claim_reviews':sum(r['report_id'].startswith('A') for r in reviews),'exception_reviews':sum(r['report_id'].startswith('O') for r in reviews),'new_search_hits':sum(r['report_id'].startswith('N') for r in leads),'variant_hits':sum(r['report_id'].startswith('V') for r in leads),'note':'AI search leads do not count toward association thresholds. Context uses adjacent current-manifest recordings, matched by stable filename, not the next transmitter as an identity.'}
 file.write_text(json.dumps(source,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps(source['ai_report_import'],indent=2))
if __name__=='__main__':merge(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv)>2 else Path.cwd())
