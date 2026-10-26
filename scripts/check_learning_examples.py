"""Verify published source/excerpt/trace integrity, separate from the Java behavior checks."""
from pathlib import Path
import json,re,textwrap
from learning_state import ROOT,topics
count=0
for source in (ROOT/'examples/learning-java/src').rglob('*.java'):
    target=ROOT/'public/reference-code/learning'/source.relative_to(ROOT/'examples/learning-java/src')
    assert target.read_bytes()==source.read_bytes(),f'download differs: {source}'
    count+=1
booking=topics()['LLD-4']['markdown']
source=(ROOT/'examples/learning-java/src/kb/booking/BookingService.java').read_text(encoding='utf-8')
for tag in ['hold','payment','expiry']:
    block=source.split('// BEGIN '+tag+'\n',1)[1].split('// END '+tag,1)[0].rstrip()
    assert '```java\n'+textwrap.dedent(block)+'\n```' in booking,f'article excerpt differs: {tag}'
trace=json.loads((ROOT/'public/learning-labs/booking.json').read_text(encoding='utf-8'))
assert len(trace['scenarios'])==3
for case in trace['scenarios']:
    assert len(case['steps'])>=4
    for step in case['steps']:
        assert len(step['seats'])==3 and step['title'] and step['note']
        assert all((s['state']=='AVAILABLE')==(s['owner']=='') for s in step['seats'])
late=trace['scenarios'][-1]['steps']
assert late[-1]['seats']==late[-2]['seats']
assert late[-1]['facts']==late[-2]['facts']==['Pending refund intents: 1']
assert all(s['owner']=='B' for s in late[-1]['seats'][:2])
rate_source=(ROOT/'examples/learning-java/src/kb/ratelimit/TokenBucket.java').read_text(encoding='utf-8')
block=rate_source.split('// BEGIN decision\n',1)[1].split('// END decision',1)[0].rstrip()
assert '```java\n'+textwrap.dedent(block)+'\n```' in topics()['HLD-2']['markdown']
assert (ROOT/'examples/learning-redis/token-bucket.lua').read_bytes()==(ROOT/'public/reference-code/learning/token-bucket.lua').read_bytes()
print(f'PASS: {count} Java downloads + Lua, 4 exact excerpts, 3 source-generated booking scenarios')
