"""Run the browser CLI definition and save actual observations, failing on missing results."""
from pathlib import Path
import argparse,json,re,subprocess
from learning_state import ROOT,DOC,WORK,atomic,digest,topics,now
p=argparse.ArgumentParser();p.add_argument('--topic');p.add_argument('--batch',nargs='+');p.add_argument('--definition',required=True);a=p.parse_args()
targets=a.batch or [a.topic]
if not all(targets):raise ValueError('Topic or batch required')
hashes={key:digest(topics()[key]) for key in targets}
definition=(ROOT/a.definition).resolve()
if not definition.is_relative_to(ROOT) or not definition.is_file():raise ValueError('Definition must be in this worktree')
argv=['C:/Program Files/nodejs/npx.cmd','--offline','--yes','--package','@playwright/cli','playwright-cli','-s=kb-quality','run-code','--filename='+str(definition)]
proc=subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=300)
log=proc.stdout+proc.stderr;atomic(WORK/((a.topic or 'lot')+'-browser.log'),log)
match=re.search(r'### Result\s*\n(\[[^\n]+\])',log)
if proc.returncode or not match:raise RuntimeError('Browser checks did not return successful observations. See .learning-work browser log.')
observations=json.loads(match.group(1))
if len(observations)<4:raise RuntimeError('Incomplete browser matrix')
for key in targets:
    rows=observations if len(targets)==1 else [r for r in observations if r.get('topic')==key]
    if len(rows)<4 or digest(topics()[key])!=hashes[key]:raise RuntimeError('Incomplete matrix or content changed: '+key)
    report={'topic':key,'checked_at':now(),'content_hash':hashes[key],'command':argv,'exit_code':proc.returncode,'definition_sha256':digest(definition.read_bytes()),'observations':rows}
    atomic(DOC/'evidence'/(key+'-browser.json'),report)
    print(f'PASS {key}: {len(rows)} browser states')
