import importlib.util,json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('campaign',Path(__file__).with_name('learning_state.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
TEST_ROOT=c.ROOT/'.learning-work/test-tmp'

class CampaignChecks(unittest.TestCase):
 def setUp(self):
  TEST_ROOT.mkdir(parents=True,exist_ok=True)
  self.tmp=tempfile.TemporaryDirectory(dir=TEST_ROOT);self.root=Path(self.tmp.name)
  assert self.root.resolve().is_relative_to(TEST_ROOT.resolve())
  self.saved=(c.ROOT,c.DOC,c.WORK,c.MANIFEST,c.git_head)
  self.addCleanup(self.cleanup_state)
  c.ROOT=self.root;c.DOC=self.root/'docs/learning-quality';c.WORK=self.root/'.learning-work';c.MANIFEST=c.DOC/'manifest.json';c.git_head=lambda:'test-head'
  for d in ['content','build/topics','build/fundamentals']:(self.root/d).mkdir(parents=True)
  (self.root/'content/fundamentals.json').write_text('{}');(self.root/'build/make-fundamentals.js').write_text('// protected')
  source=[]
  for n in range(1,21):
   ts=[]
   for track in ['LLD','HLD','AI']:
    md='## Problem\n\nA case.\n\n## Requirements\n\nA rule.\n'
    ts.append({'category':track,'number':n,'title':f'{track} {n}','markdown':md,'diagram':{}})
    source.append(f'=== {track} {n} ===\nN|a|Owner|0|0\n---\n'+md+'\n')
   (self.root/f'content/day-{n:02d}.json').write_text(json.dumps({'topics':ts}))
  (self.root/'build/topics/all.txt').write_text(''.join(source))
  c.init()
 def cleanup_state(self):
  c.ROOT,c.DOC,c.WORK,c.MANIFEST,c.git_head=self.saved
  assert self.root.resolve().is_relative_to(TEST_ROOT.resolve())
  self.tmp.cleanup()
 def command(self,*args):
  with patch.object(sys,'argv',['learning_state.py',*args]):return c.main()
 def claim(self):return self.command('claim','--run','test')['token']
 def assemble(self,*args,**kwargs):
  for key,(_,_,_,_,_,md) in c.sources().items():
   track,n=key.split('-');p=self.root/f'content/day-{int(n):02d}.json';d=json.loads(p.read_text());next(t for t in d['topics'] if t['category']==track)['markdown']=md;p.write_text(json.dumps(d))
 def test_inventory_and_separate_progress(self):
  s=self.command('status');self.assertEqual((s['required'],s['written'],s['validated'],s['complete']),(57,0,0,0));self.assertEqual(s['stale'],[])
 def test_source_archive_bytes_are_preserved(self):
  p=self.root/'source.zip';payload=b'PK\x03\x04\x00\xff\xca\xfe';c.atomic(p,payload);self.assertEqual(p.read_bytes(),payload)
 def test_busy_and_expired_writer_is_fenced(self):
  old=self.claim();self.assertEqual(self.command('claim')['status'],'busy')
  owner=c.read_json(c.WORK/'lease.json');owner['expires']=time.time()-1;c.atomic(c.WORK/'lease.json',owner)
  new=self.claim();self.assertNotEqual(old,new)
  with self.assertRaises(ValueError):self.command('renew','--token',old)
 def test_human_edit_is_not_overwritten(self):
  token=self.claim();source=self.root/'build/topics/all.txt';old=c.digest(source.read_bytes());source.write_text(source.read_text()+'human note\n')
  draft=self.root/'draft.md';draft.write_text('## Problem\n\nCase\n\n## Requirements\n\nRule\n')
  with self.assertRaises(ValueError):self.command('apply','--token',token,'--topic','LLD-4','--markdown-file',str(draft),'--expected-sha256',old)
  self.assertIn('human note',source.read_text())
 def test_written_is_not_validated_or_complete(self):
  token=self.claim();source=self.root/'build/topics/all.txt';draft=self.root/'draft.md';draft.write_text('## Problem\n\nA different case.\n\n## Requirements\n\nRule\n')
  before=c.topics()['LLD-1']
  with patch.object(c.subprocess,'run',side_effect=self.assemble):self.command('apply','--token',token,'--topic','LLD-4','--markdown-file',str(draft),'--expected-sha256',c.digest(source.read_bytes()))
  s=self.command('status');self.assertEqual((s['written'],s['validated'],s['complete']),(1,0,0));self.assertEqual(c.topics()['LLD-1'],before)
 def test_protected_fundamentals(self):
  (self.root/'content/fundamentals.json').write_text('{"changed":true}')
  with self.assertRaises(ValueError):self.command('status')
 def test_review_requires_current_validation(self):
  token=self.claim();e=self.root/'review.json';e.write_text(json.dumps({'topic':'LLD-4','content_hash':c.digest(c.topics()['LLD-4']),'known_critical_issues':[],'criteria':{k:{'status':'passed','evidence':'case'} for k in c.CRITERIA}}))
  with self.assertRaises(ValueError):self.command('review','--token',token,'--topic','LLD-4','--evidence-file',str(e))
 def test_interrupted_write_detects_unexpected_edit(self):
  token=self.claim();p=self.root/'build/topics/all.txt';c.atomic(c.WORK/'transaction.json',{'topic':'LLD-4','source':'build/topics/all.txt','old_hash':'old','new_hash':'new'})
  with self.assertRaises(ValueError):self.command('recover','--token',token)
 def test_external_topic_edit_is_preserved_even_with_a_fresh_file_hash(self):
  token=self.claim();p=self.root/'build/topics/all.txt';text=p.read_text();start=text.index('=== LLD 4 ===');text=text[:start]+text[start:].replace('A case.','Human improvement.',1);p.write_text(text)
  draft=self.root/'draft.md';draft.write_text('## Problem\n\nOverwrite\n\n## Requirements\n\nRule\n')
  with self.assertRaises(ValueError):self.command('apply','--token',token,'--topic','LLD-4','--markdown-file',str(draft),'--expected-sha256',c.digest(p.read_bytes()))
  self.assertIn('Human improvement.',p.read_text())
 def test_stale_validation_is_selected_for_recheck(self):
  token=self.claim();artifact=self.root/'artifact.txt';artifact.write_text('old');m=c.read_json(c.MANIFEST);t=c.topic(m,'LLD-4')
  t.update(generation='written',validation='passed',review='passed',completion='complete',validation_inputs={'artifact.txt':c.digest(artifact.read_bytes())});c.save(m);artifact.write_text('new')
  self.assertEqual(self.command('status')['complete'],0)
  selected=self.command('select','--token',token);self.assertEqual(selected['id'],'LLD-4');self.assertEqual(selected['validation'],'not_run')

if __name__=='__main__':unittest.main()
