"""Export an already-tested Maven demo, exact source files and its recorded API trace."""
from pathlib import Path
import json,shutil,zipfile,xml.etree.ElementTree as ET
from learning_state import ROOT,digest
project=ROOT/'examples/learning-spring-ai';report=project/'target/surefire-reports'
results=[ET.parse(p).getroot() for p in report.glob('TEST-*.xml')]
assert results and sum(int(r.attrib['tests']) for r in results)>=14
assert all(int(r.attrib['failures'])==0 and int(r.attrib['errors'])==0 for r in results)
out=ROOT/'public/reference-code/learning/spring-ai';out.mkdir(parents=True,exist_ok=True)
files=[project/'pom.xml',project/'README.md',*sorted((project/'src').rglob('*'))]
files=[p for p in files if p.is_file()]
for p in files:
    target=out/p.relative_to(project);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
archive=out.parent/'spring-ai-chatclient.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in files:
        info=zipfile.ZipInfo(p.relative_to(project).as_posix(),date_time=(2026,10,26,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())
trace=project/'target/chatclient-trace.json';data=json.loads(trace.read_text(encoding='utf-8'))
assert len(data['scenarios'])==3
target=ROOT/'public/learning-labs/chatclient.json';target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'PASS: Spring demo archive, {len(files)} exact source/config downloads and three executed API traces exported')
