"""Exact-match replacements: python -I tools/replace.py FILE OLD NEW [OLD NEW ...]; each OLD must occur once.
Escapes: \\n in arguments becomes a newline."""
import sys

path = sys.argv[1]
args = [a.replace('\\n', '\n') for a in sys.argv[2:]]
text = open(path, encoding='utf-8').read()
for old, new in zip(args[0::2], args[1::2]):
    count = text.count(old)
    if count != 1:
        sys.exit(f'{path}: {count} matches for {old!r}')
    text = text.replace(old, new)
open(path, 'w', encoding='utf-8', newline='').write(text)
print('ok', path)
