"""Check dated browser/service evidence and local Maven test results; no provider calls."""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import xml.etree.ElementTree as ET
from learning_state import ROOT, DOC, read_json, topics, digest, atomic, now


def main():
    manifest = read_json(DOC/'manifest.json')
    current = topics()
    observations = []
    definition = digest((DOC/'browser/lot.js').read_bytes())
    for key in manifest['review_batch']['topics']:
        report = read_json(DOC/'evidence'/(key+'-browser.json'))
        assert report['content_hash'] == digest(current[key]), 'stale browser content: '+key
        assert report['definition_sha256'] == definition and report['exit_code'] == 0
        expected = {(p,t,w) for p in ['article','walkthrough'] for t in ['light','dark'] for w in [1280,390]}
        assert {(r['page'],r['theme'],r['width']) for r in report['observations']} == expected
        for row in report['observations']:
            assert not row['overflow'] and not row['brokenImages']
            assert row['minTableContrast'] is None or row['minTableContrast'] >= 4.5
        observations.extend(report['observations'])
    modules = {'learning-spring-ai':19, 'learning-spring-fundamentals':6,
               'learning-spring-structured-output':15}
    suites = []
    for module, count in modules.items():
        files = sorted((ROOT/'examples'/module/'target/surefire-reports').glob('TEST-*.xml'))
        assert files, 'Run the offline Maven tests first: '+module
        actual = 0
        for path in files:
            suite = ET.parse(path).getroot()
            assert all(int(suite.get(k,'0')) == 0 for k in ['errors','failures','skipped']), path
            actual += int(suite.attrib['tests'])
            suites.append({'module':module, 'suite':suite.attrib['name'], 'tests':int(suite.attrib['tests']),
                           'errors':0, 'failures':0, 'skipped':0,
                           'report_sha256':digest(path.read_bytes()),
                           'report_modified_utc':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()})
        assert actual == count, (module, actual)
    redis = read_json(DOC/'evidence/HLD-2-redis.json')
    assert redis['count'] == 19 and redis['script_sha256'] == digest((ROOT/'examples/learning-redis/token-bucket.lua').read_bytes())
    http = read_json(DOC/'evidence/AI-7-http.json')
    jar = ROOT/'examples/learning-spring-ai/target/learning-spring-ai-1.0.0.jar'
    assert http['count'] == 6 and http['provider_calls'] == 0 and http['jar_sha256'] == digest(jar.read_bytes())
    js = [ROOT/'public/app.js', *sorted((ROOT/'public/learning-labs').glob('*.js'))]
    for path in js:
        subprocess.run(['node','--check',str(path)],cwd=ROOT,check=True,capture_output=True)
    for path in (ROOT/'scripts').glob('*learning*.py'):
        compile(path.read_text(encoding='utf-8-sig'),str(path),'exec')
    result = {'checked_at':now(), 'browser_states':len(observations), 'spring_tests':suites,
              'spring_test_total':sum(s['tests'] for s in suites), 'redis_checks':19, 'offline_http_checks':6,
              'min_table_contrast':min(r['minTableContrast'] for r in observations if r['minTableContrast'] is not None),
              'javascript_files_syntax_checked':len(js),
              'limits':['Maven results are parsed from actual existing Surefire runs, not rerun by this checker.',
                        'Redis evidence is an earlier execution of the unchanged Lua script.',
                        'Browser and HTTP reports are dated observations; no paid model, payment or message-provider calls.',
                        'No distributed database/broker failover, production load or model-quality evaluation.']}
    atomic(DOC/'evidence/lot-runtime.json',result)
    print(f"PASS runtime evidence: {len(observations)} browser states, 40 actual Spring tests, 19 earlier Redis checks, 6 loopback HTTP checks, {len(js)} JS syntax checks")


if __name__ == '__main__':
    main()
