"""Compile/run offline Java mechanisms and export exact source copies and recorded traces."""
from pathlib import Path
import json, shutil, subprocess, os, re, html
from decimal import Decimal
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
    'notification':('NotificationChecks','NotificationTrace','notification-traces.json',[]),
    'rental':('RentalChecks','RentalDemo','rental-traces.json',['--json']),
    'splitwise':('SplitChecks','SplitTrace','splitwise-traces.json',[]),
    'feed':('FeedChecks','FeedTrace','news-feed-traces.json',[]),
    'cab':('CabChecks','CabDemo','cab-traces.json',['--json'])
}
for package,(checks,export,filename,export_args) in mechanisms.items():
    subprocess.run([*JAVA_RUN,'-ea','-cp',str(out),'kb.'+package+'.'+checks],check=True)
    trace=subprocess.check_output([*JAVA_RUN,'-cp',str(out),'kb.'+package+'.'+export,*export_args],encoding='utf-8')
    data=json.loads(trace)
    target=ROOT/'public/learning-labs'/filename
    target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if package=='splitwise':
        sections=[]
        for case in data['scenarios']:
            rows=[]
            for step in case['steps']:
                balances='; '.join(f'{key}: INR {Decimal(value)/100:.2f}' for key,value in sorted(step['balances'].items()))
                rows.append('<li><strong>'+html.escape(step['title'])+'</strong>. '+html.escape(step['note'])+' '+html.escape(balances)+'.</li>')
            sections.append('<h3>'+html.escape(case['label'])+'</h3><ol>'+''.join(rows)+'</ol>')
        page=ROOT/'public/learning-labs/splitwise.html'
        fallback='<section id="fallback"><h2>Read all recorded cases without the player</h2>'+''.join(sections)+'</section>'
        text=page.read_text(encoding='utf-8')
        text=re.sub(r'(?<=<!-- BEGIN SPLITWISE FALLBACK -->)[\s\S]*?(?=<!-- END SPLITWISE FALLBACK -->)','\n'+fallback+'\n',text)
        page.write_text(text,encoding='utf-8')
subprocess.run([*JAVA_RUN,'-ea','-cp',str(out),'kb.aifundamentals.AiFundamentals'],check=True)
for main in ['kb.prompting.PromptEngineering','kb.llmparameters.RequestControls','kb.semanticsearch.SemanticSearch']:
    subprocess.run([*JAVA_RUN,'-ea','-cp',str(out),main],check=True)
for p in files:
    target=ROOT/'public/reference-code/learning'/p.relative_to(source)
    target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
redis_source=ROOT/'examples/learning-redis/token-bucket.lua'
redis_target=ROOT/'public/reference-code/learning/token-bucket.lua'
shutil.copyfile(redis_source,redis_target)
print('PASS: source downloads and visual traces exported from checked Java')
