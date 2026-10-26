"""Copy a finished isolated draft's owned assets, preserving unexpected human edits, then apply its article."""
from pathlib import Path
import argparse,subprocess
from learning_state import ROOT,WORK,DOC,lease,mutex,protected,read_json,MANIFEST,atomic,digest
p=argparse.ArgumentParser();p.add_argument('--topic',required=True);p.add_argument('--token',required=True);a=p.parse_args()
stage=WORK/'parallel'/a.topic
if not (stage/'integration.md').is_file():raise ValueError('Finished integration handoff required')
with mutex():
    lease(a.token);protected(read_json(MANIFEST))
    for folder in ['examples','public']:
        for src in sorted((stage/folder).rglob('*')):
            if not src.is_file():continue
            rel=src.relative_to(stage).as_posix()
            if any(part in {'target','out','.checks','.check-classes','.mechanism-classes','node_modules'} for part in Path(rel).parts):continue
            if rel.startswith('public/designs/'):continue # Canonical overview is rebuilt from the topic header.
            if a.topic=='LLD-16':
                rel=rel.replace('public/lessons/lld-16-flow.svg','public/learning-figures/tictactoe-flow.svg').replace('public/lessons/lld-16-failure.svg','public/learning-figures/tictactoe-failure.svg')
            dst=ROOT/rel;data=src.read_bytes()
            if dst.exists() and dst.read_bytes()!=data:
                original=subprocess.run(['git','show','HEAD:'+rel],cwd=ROOT,capture_output=True)
                if original.returncode or original.stdout!=dst.read_bytes():raise ValueError('Unexpected existing edit: '+rel)
                backup=WORK/'backups'/(digest(dst.read_bytes())+'-'+dst.name);backup.parent.mkdir(exist_ok=True);backup.write_bytes(dst.read_bytes())
            atomic(dst,data)
    article=(stage/'article.md').read_text(encoding='utf-8')
    if a.topic=='LLD-16':article=article.replace('lessons/lld-16-flow.svg','learning-figures/tictactoe-flow.svg').replace('lessons/lld-16-failure.svg','learning-figures/tictactoe-failure.svg')
    draft=WORK/(a.topic+'-integrating.md');atomic(draft,article)
    atomic(DOC/'integration'/(a.topic+'.md'),(stage/'integration.md').read_text(encoding='utf-8'))
argv=['python','-X','utf8','-B','scripts/apply_learning_article.py','--token',a.token,'--topic',a.topic,'--draft',str(draft),'--header',str(stage/'header.txt')]
subprocess.run(argv,cwd=ROOT,check=True)
print('Integrated staged assets and article:',a.topic)
