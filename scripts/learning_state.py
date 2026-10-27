"""Local-only campaign ledger. Fenced leases, guarded source writes and independent statuses.
No command in this module commits, pushes, publishes, calls a model or changes user data.
"""
from pathlib import Path
from datetime import datetime, timezone
from contextlib import contextmanager
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, time, uuid

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/learning-quality'
WORK = ROOT / '.learning-work'
MANIFEST = DOC / 'manifest.json'
CRITERIA = ['clarity','scope','contracts','correctness','failure_handling','code','visual_learning','tradeoffs','rendering']

def now(): return datetime.now(timezone.utc).isoformat(timespec='seconds')
def digest(value):
    if not isinstance(value, bytes): value = json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8')
    return hashlib.sha256(value).hexdigest()
def read_json(path, default=None):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not isinstance(content, (str,bytes)): content = json.dumps(content, indent=2, ensure_ascii=False) + '\n'
    fd, temporary = tempfile.mkstemp(prefix=path.name+'.', dir=path.parent)
    try:
        options={} if isinstance(content,bytes) else {'encoding':'utf-8','newline':'\n'}
        with os.fdopen(fd, 'wb' if isinstance(content,bytes) else 'w', **options) as f:
            f.write(content); f.flush(); os.fsync(f.fileno())
        for attempt in range(6):
            try:
                os.replace(temporary, path); break
            except PermissionError as error:
                if os.name!='nt' or attempt==5 or getattr(error,'winerror',None) not in [5,32,33]:raise
                time.sleep(.02*(attempt+1)) # Brief antivirus/OneDrive handle contention; never overwrite non-atomically.
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

@contextmanager
def mutex():
    WORK.mkdir(exist_ok=True)
    with (WORK/'mutex').open('a+b') as f:
        if f.tell() == 0: f.write(b'0'); f.flush()
        f.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try: yield
        finally:
            f.seek(0)
            if os.name == 'nt': msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(f.fileno(), fcntl.LOCK_UN)

def git_head():
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, env=env, text=True).strip()
def topics():
    return {f"{t['category']}-{t['number']}":t for p in sorted((ROOT/'content').glob('day-*.json'))
            for t in read_json(p)['topics']}
def sources():
    result = {}
    for p in sorted((ROOT/'build/topics').glob('*.txt')):
        text = p.read_text(encoding='utf-8')
        matches = list(re.finditer(r'^=== (LLD|HLD|AI) (\d+) ===\s*$', text, re.M))
        for i,m in enumerate(matches):
            end = matches[i+1].start() if i+1<len(matches) else len(text)
            body = text[m.end():end]; header, markdown = body.split('\n---\n',1)
            result[f'{m[1]}-{int(m[2])}'] = (p,text,m.end(),end,header,markdown.strip()+'\n')
    return result
def event(kind, **values):
    WORK.mkdir(exist_ok=True)
    with (WORK/'events.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({'at':now(),'event':kind,**values},ensure_ascii=False)+'\n')
def lease(token, renew=True):
    owner = read_json(WORK/'lease.json')
    if not owner or owner['token'] != token: raise ValueError('Not the current writer; no changes made.')
    if owner['expires'] <= time.time(): raise ValueError('Lease expired; reacquire before writing.')
    if renew:
        owner['expires'] = time.time()+3600; atomic(WORK/'lease.json',owner)
    return owner
def protected(manifest):
    head=git_head()
    if head!=manifest['base_head']:
        policy=manifest['policy'];branch=subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()
        ancestor=subprocess.run(['git','merge-base','--is-ancestor',manifest['base_head'],head],cwd=ROOT,capture_output=True).returncode==0
        if not policy.get('allow_local_review_commit') or branch!=policy.get('review_branch') or not ancestor:
            raise ValueError('HEAD changed outside the authorized local review branch; reconcile before continuing.')
    for rel,expected in manifest['protected_files'].items():
        if digest((ROOT/rel).read_bytes())!=expected: raise ValueError('Protected Fundamentals file changed: '+rel)
    current=topics()
    for key,expected in manifest['protected_topics'].items():
        if digest(current[key])!=expected: raise ValueError('Baseline topic changed during first pass: '+key)

def stale_topics(manifest):
    current=topics();authored=sources()
    return [t['id'] for t in manifest['topics'] if t['content_hash']!=digest(current[t['id']])
        or authored[t['id']][-1]!=current[t['id']]['markdown']
        or (t['validation']=='passed' and not inputs_current(t.get('validation_inputs',{})))]
def checkpoint(manifest):
    required=[t for t in manifest['topics'] if t['required']]
    stale=stale_topics(manifest)
    done=[t['id'] for t in required if t['completion']=='complete' and t['id'] not in stale]
    pending=[t['id'] for t in sorted(required,key=lambda t:t['priority']) if t['completion']!='complete' or t['id'] in stale]
    content='# Learning campaign checkpoint\n\nUpdated: '+now()+'\n\n'
    content+='Objective: complete the owner-authorized KB reference scope. Fundamentals remain unchanged.\n\n'
    content+=f"Written: {sum(t['generation']=='written' for t in required)}/{len(required)}. Validated: {sum(t['validation']=='passed' and t['id'] not in stale for t in required)}/{len(required)}. Reviewed complete: {len(done)}/{len(required)}.\n\n"
    if stale:content+='Checks requiring refresh after an input change: '+', '.join(stale)+'\n\n'
    content+='Completed: '+(', '.join(done) or 'none')+'\n\nNext: '+manifest.get('next_action',(', '.join(pending[:8]) or 'final cross-topic review and owner handoff'))+'\n\n'
    if manifest.get('review_batch'):
        batch=manifest['review_batch'];selected=[t for t in required if t['id'] in batch['topics']]
        content+=f"Current authorized scope: {sum(t['generation']=='written' for t in selected)}/{len(selected)} written; {sum(t['completion']=='complete' and t['id'] not in stale for t in selected)}/{len(selected)} reviewed. See OWNER-SCOPE.md for the current instruction.\n\n"
    if manifest['policy'].get('push_authorized'):
        content+='Policy: current seven-article batch commit/push authorized; no PR, merge or publication. Remaining articles paused for 2 November.\n\n'
    elif manifest.get('owner_resume'):
        content+='Policy: owner resumed all remaining KB references after reviewing local commit ed62f0d. New changes stay local/uncommitted; no push, PR, merge or publishing.\n\n'
    else:
        content+='Policy: local review commit authorized for the current lot; no push, PR, merge or publishing. Stop expansion for owner review.\n\n' if manifest['policy'].get('allow_local_review_commit') else 'Policy: no commits, pushes, PRs, merges or publishing. Code and text stay local for owner verification.\n\n'
    content+='Decisions and benchmark: BENCHMARK.md, RUBRIC.md and PLAN.md. Resume: CONTINUE.md.\n\n'
    content+='Known issues: '+('; '.join(manifest.get('known_issues',[])) or 'none recorded')+'\n'
    atomic(DOC/'CHECKPOINT.md',content)
    rows=['# Topic checklist (generated from manifest.json)','', '| Topic | Generation | Validation | Review | Completion |','| --- | --- | --- | --- | --- |']
    for t in sorted(manifest['topics'],key=lambda t:(t['track'],t['number'])):
        rows.append(f"| {t['id']} · {t['title']} | {t['generation']} | {t['validation']} | {t['review']} | {t['completion']} |")
    atomic(DOC/'TOPICS.md','\n'.join(rows)+'\n')
def save(manifest):
    manifest['updated_at']=now(); atomic(MANIFEST,manifest); checkpoint(manifest)
def init():
    if MANIFEST.exists(): return {'status':'already_initialized'}
    DOC.mkdir(parents=True,exist_ok=True); src=sources(); current=topics()
    keep=[ROOT/'content/fundamentals.json',ROOT/'build/make-fundamentals.js',*(ROOT/'build/fundamentals').glob('*.md')]
    order=['LLD-4','HLD-2','AI-7','LLD-16','AI-1','HLD-1','LLD-9','AI-6']
    items=[]
    for key,t in current.items():
        required=key not in ['LLD-1','LLD-2','LLD-3']
        items.append({'id':key,'track':t['category'],'number':t['number'],'title':t['title'],
          'required':required,'priority':order.index(key) if key in order else 100+t['number']*3+['LLD','HLD','AI'].index(t['category']),
          'source':src[key][0].relative_to(ROOT).as_posix(),'initial_hash':digest(t),'content_hash':digest(t),
          'generation':'pending' if required else 'baseline_preserved','validation':'not_run','review':'not_started',
          'completion':'pending' if required else 'baseline_preserved','artifacts':[],'evidence':[]})
    manifest={'schema_version':1,'campaign':'KB-QUALITY-20261026','created_at':now(),'base_head':git_head(),
      'policy':{'local_only':True,'fundamentals':'read_only','initial_three':'preserve_first_pass; optional improvements permitted later by owner'},
      'versions':{'java':'21','spring_ai':'1.1.8','spring_boot':'3.5.15'},
      'protected_files':{p.relative_to(ROOT).as_posix():digest(p.read_bytes()) for p in keep},
      'protected_topics':{k:digest(current[k]) for k in ['LLD-1','LLD-2','LLD-3']},
      'known_issues':['Native scheduled run has not yet been observed; hourly retry is not a quota-restored event.'],
      'topics':items}
    save(manifest);event('initialized',required=sum(t['required'] for t in items));return {'status':'initialized','required':57,'baseline_preserved':3}
def topic(manifest,key): return next(t for t in manifest['topics'] if t['id']==key)
def inputs_current(inputs):
    return bool(inputs) and all((ROOT/rel).is_file() and digest((ROOT/rel).read_bytes())==sha for rel,sha in inputs.items())
def recover(manifest):
    journal=read_json(WORK/'transaction.json')
    if not journal:return None
    p=ROOT/journal['source'];current=digest(p.read_bytes())
    if current not in [journal['old_hash'],journal['new_hash']]:raise ValueError('Interrupted write overlaps an external edit; inspect the backup and source.')
    if current==journal['new_hash']:
        subprocess.run(['node','build/assemble.js'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
        t=topic(manifest,journal['topic']);t.update(generation='written',content_hash=digest(topics()[t['id']]),validation='not_run',review='not_started',completion='pending')
        save(manifest)
    (WORK/'transaction.json').unlink();event('recovered',topic=journal['topic']);return journal['topic']
def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['init','status','claim','renew','select','apply','validate','review','release','recover'])
    p.add_argument('--token');p.add_argument('--agent',default='codex');p.add_argument('--run');p.add_argument('--topic')
    p.add_argument('--markdown-file');p.add_argument('--header-file');p.add_argument('--expected-sha256');p.add_argument('--evidence-file');p.add_argument('--next',default='Continue the next incomplete topic.')
    args=p.parse_args()
    with mutex():
        if args.command=='init':return init()
        manifest=read_json(MANIFEST);protected(manifest)
        if args.command=='status':
            stale=stale_topics(manifest)
            owner=read_json(WORK/'lease.json');required=[t for t in manifest['topics'] if t['required']]
            batch=manifest.get('review_batch');allowed=set(batch['topics']) if batch else {t['id'] for t in required}
            return {'required':len(required),'written':sum(t['generation']=='written' for t in required),'validated':sum(t['validation']=='passed' and t['id'] not in stale for t in required),'complete':sum(t['completion']=='complete' and t['id'] not in stale for t in required),'stale':stale,'writer':{k:v for k,v in owner.items() if k!='token'} if owner else None,'next':[t['id'] for t in sorted(required,key=lambda t:t['priority']) if t['id'] in allowed and (t['completion']!='complete' or t['id'] in stale)][:8],'owner_next':manifest.get('next_action'),'deferred':len([t for t in required if t['id'] not in allowed and t['completion']!='complete'])}
        if args.command=='claim':
            old=read_json(WORK/'lease.json')
            if old and old['expires']>time.time():return {'status':'busy','run':old['run']}
            owner={'agent':args.agent,'run':args.run or str(uuid.uuid4()),'token':str(uuid.uuid4()),'expires':time.time()+3600,'claimed_at':now()}
            atomic(WORK/'lease.json',owner);event('claimed',run=owner['run'],expired_predecessor=bool(old));recover(manifest)
            return {'status':'claimed',**owner}
        owner=lease(args.token)
        if args.command=='renew':return {'status':'renewed','expires':owner['expires']}
        if args.command=='release':
            atomic(WORK/'lease.json',None);event('released',run=owner['run'],next=args.next);checkpoint(manifest);return {'status':'released'}
        if args.command=='recover':return {'recovered':recover(manifest)}
        if args.command=='select':
            stale=stale_topics(manifest)
            batch=manifest.get('review_batch');allowed=set(batch['topics']) if batch else {t['id'] for t in manifest['topics'] if t['required']}
            if args.topic and args.topic not in allowed:raise ValueError('Topic is deferred by owner scope; a new owner request is required.')
            candidates=sorted((t for t in manifest['topics'] if t['required'] and t['id'] in allowed and (t['completion']!='complete' or t['id'] in stale)),key=lambda t:t['priority'])
            t=topic(manifest,args.topic) if args.topic else (candidates[0] if candidates else None)
            if t is None:return {'status':'all_complete'}
            if not t['required']:raise ValueError('Preserved baseline is not part of the first pass.')
            if t['id'] in stale:t.update(validation='not_run',review='not_started',completion='pending')
            if t['generation']=='pending':t['generation']='drafting'
            save(manifest);return t
        t=topic(manifest,args.topic)
        if not t['required']:raise ValueError('Preserved baseline is not part of the first pass.')
        if args.command=='apply':
            src=sources()[t['id']];path,original,start,end,header,_=src
            if digest(path.read_bytes())!=args.expected_sha256:raise ValueError('Source changed; re-read and merge rather than overwrite.')
            current=topics()[t['id']]
            if digest(current)!=t['content_hash'] or src[-1]!=current['markdown']:
                raise ValueError('Topic was edited outside the transaction; preserve and reconcile that edit before applying a draft.')
            markdown=Path(args.markdown_file).read_text(encoding='utf-8').strip()+'\n'
            if not markdown.startswith('## Problem\n') or '\n## Requirements' not in markdown:raise ValueError('Keep the app problem/requirements split.')
            if args.header_file:header=Path(args.header_file).read_text(encoding='utf-8').strip()
            updated=original[:start]+'\n'+header.strip()+'\n---\n'+markdown+('\n'+original[end:] if end<len(original) else '')
            if updated==original:return {'status':'already_written','topic':t['id']}
            backup=WORK/'backups'/(digest(path.read_bytes())+'.txt');backup.parent.mkdir(exist_ok=True);backup.write_bytes(path.read_bytes())
            journal={'topic':t['id'],'source':path.relative_to(ROOT).as_posix(),'old_hash':args.expected_sha256,'new_hash':digest(updated.encode('utf-8'))}
            atomic(WORK/'transaction.json',journal);atomic(path,updated)
            subprocess.run(['node','build/assemble.js'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
            t.update(generation='written',content_hash=digest(topics()[t['id']]),validation='not_run',review='not_started',completion='pending')
            save(manifest);(WORK/'transaction.json').unlink();event('written',topic=t['id'],hash=t['content_hash']);return {'status':'written','topic':t['id'],'hash':t['content_hash']}
        evidence=read_json(Path(args.evidence_file));actual=digest(topics()[t['id']])
        if evidence['topic']!=t['id'] or evidence['content_hash']!=actual:raise ValueError('Evidence is stale or for another topic.')
        if args.command=='validate':
            if not evidence.get('commands') or any(c.get('exit_code')!=0 for c in evidence['commands']):raise ValueError('Validation failed; record failures without passing the topic.')
            if t['generation']!='written' or not inputs_current(evidence.get('inputs',{})):raise ValueError('Written content and current hashed test inputs required.')
            t['validation']='passed';t['validation_hash']=actual;t['validation_inputs']=evidence['inputs']
        elif args.command=='review':
            results=evidence.get('criteria',{})
            if set(results)!=set(CRITERIA):raise ValueError('Review must address every rubric criterion.')
            if any(v.get('status') not in ['passed','not_applicable'] or not v.get('evidence') for v in results.values()):raise ValueError('Unresolved or unsupported review criterion.')
            if evidence.get('known_critical_issues')!=[]:raise ValueError('Critical issues must be explicitly resolved.')
            if t['validation']!='passed' or t.get('validation_hash')!=actual:raise ValueError('Current content must be validated before completion.')
            if not inputs_current(t.get('validation_inputs',{})):raise ValueError('Tested implementation or visual changed; rerun checks.')
            t['review']='passed';t['completion']='complete'
        rel=str(Path(args.evidence_file).resolve().relative_to(ROOT));t['evidence'].append(rel);save(manifest);event(args.command,topic=t['id']);return {'status':args.command+'_recorded','topic':t['id']}

if __name__=='__main__':
    try: print(json.dumps(main(),ensure_ascii=False,indent=2))
    except (ValueError,OSError,subprocess.CalledProcessError,KeyError) as e:
        print(json.dumps({'error':str(e)}),file=sys.stderr);sys.exit(1)
