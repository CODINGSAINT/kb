"""Start the owned loopback-only offline demo, exercise its HTTP contracts, then stop it."""
from pathlib import Path
import json,os,re,subprocess,time,urllib.request,urllib.error
from learning_state import ROOT,DOC,WORK,atomic,digest,now
java=Path(os.environ.get('JAVA_HOME','C:/Users/07pal/.sdkman/candidates/java/21-oracle'))/'bin/java.exe'
jar=ROOT/'examples/learning-spring-ai/target/learning-spring-ai-1.0.0.jar'
log=WORK/'spring-http.log';checks=[]
with log.open('wb') as stream:
    process=subprocess.Popen([str(java),'-jar',str(jar),'--server.port=0'],cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT)
    try:
        for _ in range(240):
            text=log.read_text(encoding='utf-8',errors='replace');match=re.search(r'Netty started on port (\d+)',text)
            if match:break
            if process.poll() is not None:raise RuntimeError('Application failed to start: '+text[-1800:])
            time.sleep(.15)
        else:raise TimeoutError('No local application readiness within 36 seconds')
        base='http://127.0.0.1:'+match[1]
        def post(path,question):
            data=json.dumps({'text':question}).encode('utf-8')
            request=urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'},method='POST')
            try:
                with urllib.request.urlopen(request,timeout=10) as response:return response.status,response.read().decode('utf-8')
            except urllib.error.HTTPError as error:return error.code,error.read().decode('utf-8')
        status,body=post('/answer','Explain encapsulation');answer=json.loads(body)
        assert status==200 and answer['text'].startswith('Offline fixture:') and answer['inputTokens']==12 and answer['outputTokens']==8
        checks.append('POST /answer: one response with text and fixture token metadata')
        status,body=post('/answer','What does "concept" mean?')
        assert status==200 and json.loads(body)['text'].startswith('Offline fixture:')
        checks.append('POST /answer: user field-name text cannot select the fixture response shape')
        status,body=post('/card','Explain encapsulation');card=json.loads(body)
        assert status==200 and card['concept']=='Offline fixture: encapsulation' and len(card['steps'])==2
        checks.append('POST /card: valid converted and checked record')
        status,body=post('/stream','Explain encapsulation')
        assert status==200 and 'data:Keep state private.' in body and 'data:Use methods to preserve its rules.' in body
        checks.append('POST /stream: SSE chunks delivered without a remote model')
        status,body=post('/answer',' ')
        assert status==400 and '1..2000' in body
        checks.append('POST /answer: invalid question returns 400')
        status,body=post('/card','x'*2001)
        assert status==400
        checks.append('POST /card: input length checked before model invocation')
        atomic(DOC/'evidence/AI-7-http.json',{'checked_at':now(),'jar_sha256':digest(jar.read_bytes()),'checks':checks,'count':len(checks),'provider_calls':0,'limitations':['Loopback offline fixture only','No authentication, provider network, load test or model-quality evaluation']})
        print(f'PASS Spring Boot HTTP: {len(checks)} checks; loopback only, offline fixture')
    finally:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
