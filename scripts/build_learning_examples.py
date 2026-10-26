"""Compile/run offline Java mechanisms and export exact source copies and recorded traces."""
from pathlib import Path
import json, shutil, subprocess, os
ROOT=Path(__file__).resolve().parents[1]
JAVA=Path(os.environ.get('JAVA_HOME','C:/Users/07pal/.sdkman/candidates/java/21-oracle'))/'bin'
JAVA_RUN=[str(JAVA/'java'),'-Dstdout.encoding=UTF-8','-Dfile.encoding=UTF-8']
source=ROOT/'examples/learning-java/src';out=ROOT/'.qa-campaign/java'
out.mkdir(parents=True,exist_ok=True)
files=sorted(source.rglob('*.java'))
subprocess.run([str(JAVA/'javac'),'-encoding','UTF-8','-d',str(out),*[str(p) for p in files]],check=True)
mechanisms={
    'booking':('BookingChecks','BookingTrace','booking.json',[]),
    'ratelimit':('RatelimitChecks','RatelimitTrace','ratelimit.json',[]),
    'tictactoe':('TicTacToeChecks','TicTacToeTrace','tictactoe-traces.json',[]),
    'shortener':('ShortenerChecks','ShortenerTrace','shortener-traces.json',[]),
    'atm':('AtmChecks','AtmDemo','atm-traces.json',['--json']),
    'cache':('CacheChecks','CacheTrace','distributed-cache-traces.json',[]),
    'library':('LibraryChecks','LibraryDemo','library-traces.json',['--json']),
    'notification':('NotificationChecks','NotificationTrace','notification-traces.json',[])
}
for package,(checks,export,filename,export_args) in mechanisms.items():
    subprocess.run([*JAVA_RUN,'-ea','-cp',str(out),'kb.'+package+'.'+checks],check=True)
    trace=subprocess.check_output([*JAVA_RUN,'-cp',str(out),'kb.'+package+'.'+export,*export_args],encoding='utf-8')
    data=json.loads(trace)
    target=ROOT/'public/learning-labs'/filename
    target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
subprocess.run([*JAVA_RUN,'-ea','-cp',str(out),'kb.aifundamentals.AiFundamentals'],check=True)
for p in files:
    target=ROOT/'public/reference-code/learning'/p.relative_to(source)
    target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
redis_source=ROOT/'examples/learning-redis/token-bucket.lua'
redis_target=ROOT/'public/reference-code/learning/token-bucket.lua'
shutil.copyfile(redis_source,redis_target)
print('PASS: source downloads and visual traces exported from checked Java')
