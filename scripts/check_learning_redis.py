"""Exercise the authored Lua in a disposable, network-isolated Redis container. No host mounts/ports."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,subprocess,time
from learning_state import ROOT,DOC,atomic,digest,now
DOCKER='C:/Program Files/Docker/Docker/resources/bin/docker.exe'
IMAGE='redis@sha256:02419de7eddf55aa5bcf49efb74e88fa8d931b4d77c07eff8a6b2144472b6952'
script=(ROOT/'examples/learning-redis/token-bucket.lua').read_text(encoding='utf-8')
container=None;checks=[]
def run(argv):return subprocess.check_output(argv,encoding='utf-8',errors='replace',timeout=30).strip()
def raw(*args):return run([DOCKER,'exec',container,'redis-cli','--json',*map(str,args)])
def command(*args):return json.loads(raw(*args))
def evaluate(key,capacity=5,rate=2,cost=1):return command('EVAL',script,1,key,capacity,rate,cost)
def check(value,label):
    if not value:raise AssertionError(label)
    checks.append(label)
try:
    container=run([DOCKER,'run','--rm','-d','--network','none','--label','codingsaint.kb=learning-quality-test',IMAGE,'redis-server','--save','','--appendonly','no'])
    if len(container)!=64 or any(c not in '0123456789abcdef' for c in container):raise RuntimeError('Unexpected container identity')
    for _ in range(30):
        try:
            if command('PING')=='PONG':break
        except subprocess.CalledProcessError:pass
        time.sleep(.1)
    else:raise RuntimeError('Redis did not start')
    version=raw('INFO','server')
    check('redis_version:7.4.2' in version,'Pinned Redis version is 7.4.2')
    first=evaluate('rl:{sample}:search:v3')
    check(first[0]==1 and first[1]==4000,'New bucket starts full and spends one token')
    check(first[3]>=501,'Idle expiry is at least the time to replenish the spent token')
    # Artificial future watermark stops refill while real concurrent Redis clients spend a shared balance.
    sec,usec=command('TIME');future=int(sec)*1000+int(usec)//1000+60000
    command('HSET','rl:{race}:search:v3','units',5000,'last_ms',future,'capacity',5,'rate',1)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results=list(pool.map(lambda _:evaluate('rl:{race}:search:v3',5,1,1),range(40)))
    check(sum(r[0] for r in results)==5,'40 competing clients spend exactly five tokens while refill is frozen by a future watermark')
    check(int(command('HGET','rl:{race}:search:v3','units'))==0,'No lost-update overspend')
    check(all(r[2]>0 for r in results if r[0]==0),'Denied clients receive a positive retry delay')
    check(int(command('HGET','rl:{race}:search:v3','last_ms'))==future,'Clock regression never moves watermark backwards')
    expiry=command('EVAL',"local t=redis.call('TIME');return {redis.call('PTTL',KEYS[1]),tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)}",1,'rl:{race}:search:v3')
    check(abs(expiry[0]-(future+5001-expiry[1]))<=2,'TTL includes the remaining clock debt and full refill horizon')
    slow=evaluate('rl:{slow}:v1',1000,1,1000)
    check(slow[0]==1 and slow[3]==1000001,'Slow refill is not erased by an arbitrary 60-second expiry')
    # Fractional balance: seed half a token and a future timestamp so the exact decision is deterministic.
    command('HSET','rl:{half}:v1','units',500,'last_ms',future,'capacity',5,'rate',2)
    half=evaluate('rl:{half}:v1')
    check(half[0]==0 and half[1]==500 and half[2]>250,'Fractional tokens retained under a rejected request')
    bad=raw('EVAL',script,1,'rl:{invalid}:v1',5,2,6)
    check('invalid bucket policy' in bad and command('EXISTS','rl:{invalid}:v1')==0,'Invalid cost cannot create or change a bucket')
    command('HSET','rl:{corrupt}:v1','units',1000)
    bad=raw('EVAL',script,1,'rl:{corrupt}:v1',5,2,1)
    check('corrupt bucket' in bad,'Partial state fails rather than silently minting a full bucket')
    bad=raw('EVAL',script,1,'rl:{slow}:v1',1001,1,1)
    check('policy version mismatch' in bad,'An existing key cannot silently change capacity')
    command('SET','unrelated-owner-data','keep')
    tiny=evaluate('rl:{idle}:v1',1,1000000,1);time.sleep(.03)
    check(command('EXISTS','rl:{idle}:v1')==0,'An idle fully-refilled bucket may disappear')
    check(evaluate('rl:{idle}:v1',1,1000000,1)[0]==1,'Recreating an expired full bucket preserves its semantics')
    check(command('GET','unrelated-owner-data')=='keep','Script touches only its declared key')
    sha=command('SCRIPT','LOAD',script)
    check(command('EVALSHA',sha,1,'rl:{cache}:v1',5,1,1)[0]==1,'Loaded script executes through EVALSHA')
    command('SCRIPT','FLUSH')
    check('NOSCRIPT' in raw('EVALSHA',sha,1,'rl:{cache}:v1',5,1,1),'Script-cache miss is observable for safe reload')
    check(evaluate('rl:{cache}:v1',5,1,1)[0]==1,'EVAL fallback executes the identical decision after cache loss')
    memory=command('MEMORY','USAGE','rl:{slow}:v1')
    report={'checked_at':now(),'redis_version':'7.4.2','image':IMAGE,'script_sha256':digest(script.encode('utf-8')),'checks':checks,'count':len(checks),'sample_key_memory_bytes':memory,'limitations':['Single Redis primary, not failover/partition/replication testing','Concurrency case deliberately freezes refill with a future watermark','Docker execution is functional validation, not a throughput benchmark']}
    atomic(DOC/'evidence/HLD-2-redis.json',report)
    print(f'PASS Redis: {len(checks)} checks, 40 competing clients; sample key memory {memory} bytes')
finally:
    if container and len(container)==64 and all(c in '0123456789abcdef' for c in container):
        subprocess.run([DOCKER,'stop','--time','1',container],check=True,capture_output=True,timeout=15)
