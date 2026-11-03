"""Screen existing Law 2 checkpoints for directory-backed date confirmations.

Read-only: writes /tmp/law2-directory-reviewed.json for explicit review/import.
Requires an existing accepted officer/radio pair, stable directory call sign,
two calls separated by a minute, single-transmitter metadata, and matching
self-identification across original, filtered, and context model passes.
This does not verify audio or represent personal listening confirmation.
"""
import json,re,glob,collections,itertools
from pathlib import Path
ROOT=Path.cwd()
source=json.load(open('data/officer-association-evidence.json'))
labels=json.load(open('public/records/openmhz/officer-associations.json'))
directories=json.load(open('data/officer-call-sign-assignments.json'))['profiles']
pattern=re.compile(r'(?<![A-Za-z0-9])5\s*[- ]?\s*J\s*[- ]?\s*(\d{1,3})(?!\d)',re.I)
self_action=re.compile(r'^[\s.,:-]*(?:traffic\b|arriv\w*\b|clear\b|off[- ]duty\b|10[- ]?(?:8|14|15|21|23|41|42|85)\b|104[12]\b|en[- ]route\b|return\w*\b|in the area\b|citizen contact\b|I(?:[’\x27]ll| am|[’\x27]m)\b|out (?:at|with)\b|area\b)',re.I)
def self_id(text):
 if not isinstance(text,str) or any(x in text.lower() for x in ['[','?', 'uncertain','unintelligible','unclear']): return None
 matches=list(pattern.finditer(text))
 if not matches or matches[0].start()!=0 or len({'5J'+m[1] for m in matches})!=1:return None
 if not self_action.match(text[matches[0].end():]):return None
 return '5J'+matches[0][1]
stable={}
for slug,rows in directories.items():
 bydate={date:{r['call_sign'] for r in rows if any(s['date']==date for s in r['sources'])} for date in ['2026-08-17','2026-09-28']}
 if len(bydate['2026-08-17'])==1 and bydate['2026-08-17']==bydate['2026-09-28']:stable[next(iter(bydate['2026-08-17']))]=slug
checkpoints={}
for f in sorted(glob.glob('transcription-work/5922/*/batch-*.json')):
 d=json.load(open(f))
 for filename,c in d.get('clips',{}).items():checkpoints[(d['date'],filename)]=(c,f)
known={(slug,p['radio_id']):p for slug,ps in labels['profiles'].items() for p in ps}
conflicts={}
for date,radios in labels['days'].items():
 for rid,rows in radios.items():conflicts[(date,rid)]={r['officer_id'] for r in rows}
excluded=set()
for slug,review in source.get('owner_evidence_reviews',{}).items():
 for row in source['associations']:
  for selection in row.get('owner_clip_selections',[]):
   if selection.get('officer_id')==slug and not selection.get('included'):excluded.add((slug,row['date'],selection.get('clip_id')))
groups=collections.defaultdict(list);stats=collections.Counter()
for f in sorted(glob.glob('public/records/openmhz/openmhz-afpd-law-2-*/calls.json')):
 d=json.load(open(f));date=d['date']
 for i,c in enumerate(d['calls'],1):
  sign=self_id(c.get('transcript'));slug=stable.get(sign)
  if not slug:continue
  stats['final_self_id']+=1
  if len(c.get('radio_ids',[]))!=1:continue
  rid=str(c['radio_ids'][0]); pair=known.get((slug,rid))
  if not pair or (slug,date,c['id']) in excluded:continue
  if source.get('withheld_dates',{}).get(date) and rid in source['withheld_dates'][date]:continue
  if conflicts.get((date,rid),set())-{slug}:continue
  src={str(r['src']) for r in c.get('srcList',[])}
  if src!={rid} or not c.get('srcList') or c['srcList'][0].get('pos')!=0:continue
  cp=checkpoints.get((date,c['original_filename']))
  if not cp:continue
  cp,file=cp
  if cp.get('sha256')!=c.get('sha256'):continue
  passes=cp.get('passes',{})
  if not all(key in passes for key in ['original','filtered','context']):continue
  if any(self_id(passes[key].get('text'))!=sign for key in ['original','filtered','context']):continue
  if any(passes[key].get('prompt') for key in ['original','filtered']):continue
  safe=True
  for key in ['original','filtered','context']:
   p=passes[key]
   if p.get('token_cap_reached') or not p.get('segments'):safe=False
   for seg in p.get('segments',[]):
    if seg.get('avg_logprob',-99)<-1 or seg.get('no_speech_prob',1)>.25 or seg.get('compression_ratio',99)>2.4:safe=False
  if not safe:continue
  storage=c.get('audio_storage',{})
  if not storage.get('verified') or storage.get('sha256')!=c['sha256']:continue
  stats['three_pass_agreement']+=1
  groups[(slug,rid,date)].append({'clip':i,'id':c['id'],'epoch':c['epoch'],'text':c['transcript'],'call_sign':sign,'sha256':c['sha256'],'checkpoint':file,'passes':{key:passes[key]['text'] for key in ['original','filtered','context']}})
selected=[]
for (slug,rid,date),clips in sorted(groups.items()):
 if len(clips)<2 or clips[-1]['epoch']-clips[0]['epoch']<60:continue
 p=known[(slug,rid)]
 if date in p.get('prior_source_confirmed_dates',[]):continue
 selected.append({'officer_id':slug,'radio_id':rid,'date':date,'call_sign':clips[0]['call_sign'],'clips':[clips[0],clips[-1]],'already_counted':date in p['evidence_dates']})
Path('/tmp/law2-directory-reviewed.json').write_text(json.dumps(selected,indent=2)+'\n')
print('Screened',len(stable),'stable-directory officers;',stats,'selected pairdays',len(selected),'new count days',sum(not x['already_counted'] for x in selected))
for row in selected: print(row['officer_id'],row['radio_id'],row['date'],'existing' if row['already_counted'] else 'NEW',[(c['clip'],c['text']) for c in row['clips']])
