"""Single consolidated integrity pass for the owner's review lot. Does not infer editorial quality."""
from pathlib import Path
import re,json,textwrap,xml.etree.ElementTree as ET,zipfile
from learning_state import ROOT,MANIFEST,read_json,topics,protected,digest
m=read_json(MANIFEST);protected(m);all_topics=topics();lot=[t['id'] for t in m['topics'] if t['generation']=='written'];assets=set();excerpts=0
for row in m['topics']:
    if row['id'] not in lot:assert digest(all_topics[row['id']])==row['initial_hash'],'out-of-scope reference changed: '+row['id']
for key in lot:
    md=all_topics[key]['markdown']
    assert not '{{excerpt:' in md,key+': unexpanded code'
    for url in re.findall(r'\]\(([^)]+)\)',md):
        if url.startswith(('https:','http:','#')):continue
        relative=url.split('?',1)[0].split('#',1)[0];path=(ROOT/'public'/relative).resolve()
        assert path.is_relative_to(ROOT/'public') and path.is_file(),key+': broken local asset '+url
        assets.add(relative)
    stage=ROOT/'.learning-work/parallel'/key/'article.md'
    draft=stage if stage.exists() else ROOT/'.learning-work'/(key+'.md')
    assert draft.exists(),key+': missing authoring provenance'
    for source,tag in re.findall(r'\{\{excerpt:([^#}]+)#([^}]+)\}\}',draft.read_text(encoding='utf-8')):
        code=(ROOT/source).read_text(encoding='utf-8');block=code.split('// BEGIN '+tag+'\n',1)[1].split('// END '+tag,1)[0].rstrip()
        assert '```java\n'+textwrap.dedent(block)+'\n```' in md,key+': stale excerpt '+tag
        excerpts+=1
for relative in assets:
    file=ROOT/'public'/relative
    if file.suffix=='.svg':
        svg=ET.parse(file).getroot();ns={'s':'http://www.w3.org/2000/svg'}
        assert svg.find('s:title',ns) is not None and svg.find('s:desc',ns) is not None,relative
    if file.suffix=='.zip':
        with zipfile.ZipFile(file) as z:
            assert z.testzip() is None
            assert all(not n.startswith('/') and '..' not in Path(n).parts and '/target/' not in n for n in z.namelist())
            assert 'pom.xml' in z.namelist()
for source in (ROOT/'examples/learning-java/src').rglob('*.java'):
    target=ROOT/'public/reference-code/learning'/source.relative_to(ROOT/'examples/learning-java/src')
    assert source.read_bytes()==target.read_bytes(),'stale Java download: '+str(target)
for folder,public in [('learning-spring-ai','spring-ai'),('learning-spring-fundamentals','spring-fundamentals'),('learning-spring-structured-output','spring-structured-output')]:
    project=ROOT/'examples'/folder
    assert project.exists(),folder+' missing'
    for source in [project/'pom.xml',*(project/'src').rglob('*')]:
        if not source.is_file():continue
        target=ROOT/'public/reference-code/learning'/public/source.relative_to(project)
        assert target.exists() and source.read_bytes()==target.read_bytes(),'stale Spring source download: '+str(target)
print(f'PASS review lot: {len(lot)} topics, {len(assets)} unique local assets, {excerpts} exact source excerpts, Java/Spring download parity, ZIP safety and protected baseline')
