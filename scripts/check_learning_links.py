"""Check in-scope article asset links without making provider/network calls."""
import argparse,re
from pathlib import Path
from urllib.parse import urlsplit,unquote
from learning_state import ROOT,topics
p=argparse.ArgumentParser();p.add_argument('--topic',required=True);a=p.parse_args();count=0
for label,url in re.findall(r'\[([^\]]*)\]\(([^)]+)\)',topics()[a.topic]['markdown']):
    parsed=urlsplit(url)
    if parsed.scheme in ['http','https'] or url.startswith('#'):continue
    rel=unquote(parsed.path);target=(ROOT/'public'/rel).resolve()
    assert target.is_relative_to(ROOT/'public') and target.is_file(),f'Broken local link: {url}'
    count+=1
assert count>0
print(f'PASS {a.topic}: {count} internal figure/source/walkthrough links resolve')
