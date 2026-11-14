import json
import urllib.request
import urllib.error

s = json.load(open('data/ai_settings.json', encoding='utf-8'))
key = s.get('api_key')
models = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-pro',
    'gemini-pro-latest'
]

for m in models:
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}'
    payload = json.dumps({
        'contents': [{'parts': [{'text': 'Responde solo un JSON: {"test": true}'}]}],
        'generationConfig': {'responseMimeType': 'application/json'}
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            ans = data['candidates'][0]['content']['parts'][0]['text'].strip()
            print(f'{m}: SUCCESS -> {ans}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:140]
        print(f'{m}: HTTP {e.code} -> {body}')
    except Exception as ex:
        print(f'{m}: ERROR -> {ex}')
