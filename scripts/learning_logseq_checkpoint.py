"""Record a checked local review handoff through Logseq's guarded writer."""
from pathlib import Path
from datetime import datetime, timezone
import importlib.util, json, re, subprocess, sys
import learning_state
ROOT=learning_state.ROOT
GRAPH=Path('C:/Users/07pal/development/logseq')

def main():
    m=learning_state.read_json(ROOT/'docs/learning-quality/manifest.json')
    a=learning_state.read_json(ROOT/'docs/learning-quality/automation.json')
    rows=[t for t in m['topics'] if t['id'] in m['review_batch']['topics']]
    stale=learning_state.stale_topics(m)
    counts=[sum(t['generation']=='written' for t in rows),sum(t['validation']=='passed' and t['id'] not in stale for t in rows),sum(t['completion']=='complete' and t['id'] not in stale for t in rows)]
    def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True,encoding='utf-8').strip()
    head,branch=git('rev-parse','HEAD'),git('branch','--show-current')
    if counts!=[12,12,12] or m['review_batch']['status']!='complete' or head==m['base_head'] or a['state']!='DELETED':
        raise ValueError('Final handoff requires the checked twelve articles, actual local commit and stopped continuation.')
    stamp=datetime.now(timezone.utc).isoformat(timespec='seconds')
    next_action=sys.argv[1] if len(sys.argv)>1 else 'Owner reviews the local twelve-article commit; wait for a new request before further topics or publication.'
    handoff='Brain/Handoff 2026-10-26 KB learning quality'
    summary=f'''- # Twelve-article local review handoff - {stamp}
  - Latest owner scope: finish this lot, update Logseq, make one local commit and stop for review. No push, PR, merge or publication. Earlier uncommitted/all-topic execution instructions are superseded for this handoff.
  - Canonical review worktree: {ROOT.as_posix()}. Branch `{branch}`; LOCAL commit `{head}`. Original checkout `C:/Users/07pal/Downloads/studykb/studykb` and deployed website were not updated by this lot.
  - Written 12/12, validated 12/12, rubric-reviewed 12/12: {', '.join(m['review_batch']['topics'])}. Remaining 45 first-pass topics deferred; Fundamentals and accepted Chess/Parking/Elevator unchanged. The broad campaign is incomplete and stopped for owner review.
  - Checks: Java mechanisms; 40 Spring JUnit tests; six loopback HTTP checks; 19 earlier pinned Redis checks with unchanged Lua hash; 96 article/walkthrough browser states across light/dark and desktop/mobile; source/download/excerpt/link parity, static build and ten writer-state tests. Exact commands, evidence and limits: `docs/learning-quality/REPORT.md` and `evidence/`.
  - Corrected defects include request-row creation before locking, late/conflicting booking receipts, sampled-clock rate bounds, empty streams/fixture modes, and read-only notification lookup after uncertainty. Local checks do not verify real providers, database/broker failover, production load or model quality. Reviews are Codex readings, with separate readers on selected topics; no human/Claude acceptance is claimed.
  - Preview when running: http://127.0.0.1:8790/ ; startup/routes in `docs/learning-quality/LOCAL-REVIEW.md`. Java 21 / Spring AI 1.1.8 / Boot 3.5.15 baseline. Runnable examples and source ZIPs are local.
  - Native continuation `{a['id']}` is {a['state']}. Heartbeat 2026-10-26T21:17:23.993Z resumed actual work after capacity returned; this was a periodic retry, not quota detection. All article writers stopped.
  - Next: {next_action}
'''
    entry=f'  - {stamp}: 12/12 written, validated and reviewed. Local `{branch}` at `{head}`; no push/PR/publication; 45 deferred. Next: {next_action}'
    preference='- **KB review stop, owner-confirmed 2026-10-26:** finish only the current twelve-article lot, save a local commit and Logseq handoff, then stop for owner review. No push, PR, merge or publication. This supersedes the earlier uncommitted/all-topic execution scope; remaining 45 topics are deferred.\n'
    pages={'pages/Projects___KB.md':summary,'pages/Brain___Tasks.md':entry,'pages/Brain___Handoffs.md':f'- [[{handoff}]] - {stamp}: twelve articles checked; LOCAL `{head}` on `{branch}`; continuation deleted; 45 topics deferred; awaiting owner review.\n','pages/Brain___Preferences.md':preference,'pages/Brain___Handoff 2026-10-26 KB learning quality.md':summary}
    spec=importlib.util.spec_from_file_location('shared_brain',GRAPH/'tools/brain.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);brain=module.Brain(GRAPH)
    claim=brain.claim('codex','KB-REVIEW-HANDOFF-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S'));saved=[]
    try:
        for rel,addition in pages.items():
            inspection=brain.inspect(rel);path=GRAPH/rel
            before=path.read_text(encoding='utf-8') if path.exists() else f'title:: {handoff}\nbrain-id:: kb-learning-quality-handoff\nknowledge-kind:: verified-handoff\n'
            if rel.endswith('Preferences.md') and addition.strip() in before:continue
            if rel.endswith('Tasks.md'):
                # Combine only duplicate helper-created task blocks, retaining their history and any editor IDs.
                blocks=list(re.finditer(r'(?m)^- TODO Complete KB learning-quality campaign locally\n(?:(?!^- ).*(?:\n|$))*',before))
                owned=[b for b in blocks if '  task-id:: KB-QUALITY-20261026\n' in b.group()]
                if len(owned)>1 and all(not re.search(r'^\s+id::',b.group(),re.M) for b in owned):
                    history=[line for b in owned for line in b.group().splitlines() if line.startswith('  - ')]
                    merged='- WAITING Review twelve-article KB lot before further work\n  task-id:: KB-QUALITY-20261026\n  project:: [[Projects/KB]]\n  owner:: codex\n'+'\n'.join(dict.fromkeys(history))+'\n'+entry+'\n'
                    for b in reversed(owned[1:]):before=before[:b.start()]+before[b.end():]
                    b=owned[0];before=before[:b.start()]+merged+before[b.end():]
                else:
                    lines=before.splitlines();positions=[i for i,line in enumerate(lines) if line.strip()=='task-id:: KB-QUALITY-20261026']
                    if not positions:raise ValueError('Existing KB task not found; preserve graph for manual reconciliation.')
                    end=next((i for i in range(positions[-1]+1,len(lines)) if lines[i].startswith('- ')),len(lines));lines.insert(end,entry);before='\n'.join(lines)+'\n'
                addition=''
            merged=before.rstrip()+'\n\n'+addition
            if re.search(r'^updated-at::.*$',merged,re.M):merged=re.sub(r'^updated-at::.*$','updated-at:: '+stamp,merged,count=1,flags=re.M)
            else:merged='updated-at:: '+stamp+'\n'+merged
            result=brain.write(claim['token'],rel,inspection['sha256'],merged.encode('utf-8'));saved.append(rel);print(json.dumps({'path':rel,'changed':result['changed']}))
        brain.checkpoint(claim['token'],'Twelve KB articles handed off at local commit '+head+'; no publication.',next_action)
    except Exception:
        brain.checkpoint(claim['token'],'Partial KB note update: '+', '.join(saved),'Re-read graph hashes and finish remaining handoff pages; preserve human edits.');raise
    finally:brain.release(claim['token'],'handoff','KB handoff pages saved: '+', '.join(saved),next_action)

if __name__=='__main__':main()
