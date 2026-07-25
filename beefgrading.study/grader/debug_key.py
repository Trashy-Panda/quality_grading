import sys, os
key = sys.argv[1] if len(sys.argv) > 1 else ''
key = key.strip()
print(f'Length: {len(key)}')
print(f'First 12 chars: {key[:12]}')
print(f'Last 4 chars: {repr(key[-4:])}')
print(f'Has spaces: {" " in key}')
print(f'Has newlines: {chr(10) in key or chr(13) in key}')

import anthropic
r = anthropic.Anthropic(api_key=key).messages.create(
    model='claude-haiku-4-5-20251001', max_tokens=5,
    messages=[{'role':'user','content':'hi'}])
print('SUCCESS:', r.content[0].text)
