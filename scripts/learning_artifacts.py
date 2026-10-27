"""Bind a topic to its own implementation/visual inputs, not unrelated source neighbours."""
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from learning_state import ROOT, DOC, topics, digest

PUBLIC = ROOT/'public'


def artifact_inputs(key):
    md = topics()[key]['markdown']
    files, pending = set(), []

    def add(path):
        path = path.resolve()
        if path.is_relative_to(ROOT) and path.is_file() and path not in files:
            files.add(path)
            if path.suffix in {'.html','.css','.js'} and path.is_relative_to(PUBLIC/'learning-labs'):
                pending.append(path)

    def local(base, url):
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return
        path = (base/unquote(parsed.path)).resolve()
        if path.is_relative_to(PUBLIC):
            add(path)

    for url in re.findall(r'\]\(([^)]+)\)',md):
        local(PUBLIC,url)
    add(PUBLIC/'designs'/(key.lower()+'.svg'))
    for path in PUBLIC.glob('*.css'):
        add(path)
    add(PUBLIC/'app.js')
    for name in {'LLD-4':'booking','HLD-2':'ratelimit','AI-7':'chatclient'}.get(key,'').split():
        add(PUBLIC/'learning-labs'/(name+'.json'))
    while pending:
        path = pending.pop()
        text = path.read_text(encoding='utf-8')
        urls = re.findall(r'(?:src|href)=["\']([^"\']+)',text)
        urls += re.findall(r'fetch\(["\']([^"\']+)',text)
        urls += re.findall(r'url\(["\']?([^\)"\']+)',text)
        for url in urls:
            local(path.parent,url)
    for path in list(files):
        if path.suffix == '.java' and path.is_relative_to(PUBLIC/'reference-code/learning/kb'):
            relative = path.relative_to(PUBLIC/'reference-code/learning')
            for source in (ROOT/'examples/learning-java/src'/relative.parent).glob('*.java'):
                add(source)
                add(PUBLIC/'reference-code/learning'/source.relative_to(ROOT/'examples/learning-java/src'))
    modules = {'AI-6':('learning-spring-fundamentals','spring-fundamentals'),
               'AI-7':('learning-spring-ai','spring-ai'),
               'AI-8':('learning-spring-structured-output','spring-structured-output')}
    if key in modules:
        example,download = modules[key]
        base = ROOT/'examples'/example
        for path in [base/'pom.xml',base/'README.md',*(base/'src').rglob('*')]:
            if path.is_file():
                add(path)
                add(PUBLIC/'reference-code/learning'/download/path.relative_to(base))
    if key == 'HLD-2':
        add(ROOT/'examples/learning-redis/token-bucket.lua')
    add(DOC/'evidence'/(key+'-browser.json'))
    return {p.relative_to(ROOT).as_posix():digest(p.read_bytes()) for p in sorted(files)}
