"""Run an explicit local command list and retain actual results. Never invokes a shell."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,subprocess,sys
from learning_state import ROOT,DOC,WORK,atomic,topics,digest

def main():
 p=argparse.ArgumentParser();p.add_argument('--topic',required=True);p.add_argument('--commands-file',required=True);p.add_argument('--inputs',nargs='+',required=True);a=p.parse_args()
 definitions=json.loads(Path(a.commands_file).read_text(encoding='utf-8'))
 inputs={}
 for rel in a.inputs:
  f=(ROOT/rel).resolve()
  if not f.is_relative_to(ROOT) or not f.is_file():raise ValueError('Invalid input path: '+rel)
  inputs[rel]=digest(f.read_bytes())
 content_hash=digest(topics()[a.topic]);commands=[];WORK.mkdir(exist_ok=True)
 for i,argv in enumerate(definitions):
  if not isinstance(argv,list) or not all(isinstance(v,str) for v in argv):raise ValueError('Use argument arrays, not shell strings.')
  proc=subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
  log=proc.stdout+proc.stderr;log_path=WORK/f'{a.topic}-check-{i}.log';atomic(log_path,log)
  commands.append({'argv':argv,'exit_code':proc.returncode,'output_sha256':digest(log.encode('utf-8')),'log':log_path.relative_to(ROOT).as_posix(),'tail':log[-1800:]})
  if proc.returncode:break
 changed=[rel for rel,sha in inputs.items() if digest((ROOT/rel).read_bytes())!=sha]
 if changed:raise ValueError('Inputs changed while checks ran: '+', '.join(changed))
 report={'topic':a.topic,'checked_at':datetime.now(timezone.utc).isoformat(),'content_hash':content_hash,'inputs':inputs,'commands':commands,'status':'passed' if len(commands)==len(definitions) and all(c['exit_code']==0 for c in commands) else 'failed'}
 target=DOC/'evidence'/(a.topic+'-checks.json');atomic(target,report)
 print(json.dumps({'topic':a.topic,'status':report['status'],'report':target.relative_to(ROOT).as_posix()},indent=2))
 return 0 if report['status']=='passed' else 1
if __name__=='__main__':sys.exit(main())
