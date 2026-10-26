"""Expand exact Java excerpts then use the campaign's guarded source transaction."""
from pathlib import Path
import argparse,re,subprocess
from learning_state import ROOT,WORK,sources,digest
p=argparse.ArgumentParser();p.add_argument('--token',required=True);p.add_argument('--topic',required=True);p.add_argument('--draft',required=True);p.add_argument('--header')
a=p.parse_args();text=Path(a.draft).read_text(encoding='utf-8')
def excerpt(m):
    rel,tag=m.group(1).split('#');source=(ROOT/rel).read_text(encoding='utf-8')
    block=source.split('// BEGIN '+tag+'\n',1)[1].split('// END '+tag,1)[0].rstrip()
    # Remove only the common class indentation, preserving nested indentation.
    import textwrap
    return '```java\n'+textwrap.dedent(block)+'\n```'
text=re.sub(r'\{\{excerpt:([^}]+)\}\}',excerpt,text)
out=WORK/(a.topic+'-expanded.md');out.write_text(text,encoding='utf-8')
argv=['python','-X','utf8','-B',str(ROOT/'scripts/learning_state.py'),'apply','--token',a.token,'--topic',a.topic,'--markdown-file',str(out),'--expected-sha256',digest(sources()[a.topic][0].read_bytes())]
if a.header:argv+=['--header-file',a.header]
subprocess.run(argv,cwd=ROOT,check=True)
