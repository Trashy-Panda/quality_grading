import sys, anthropic
key = sys.argv[1] if len(sys.argv) > 1 else None
client = anthropic.Anthropic(api_key=key)
r = client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=10,
    messages=[{'role':'user','content':'say hi'}])
print('KEY WORKS:', r.content[0].text)
