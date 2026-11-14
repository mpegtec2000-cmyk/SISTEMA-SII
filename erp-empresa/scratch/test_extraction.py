import json
import urllib.request
import urllib.error

s = json.load(open('data/ai_settings.json', encoding='utf-8'))
key = s.get('api_key')

sample_doc = """
LICITACIÓN ID: 2450-12-LR26
MUNICIPALIDAD DE SANTIAGO
ADQUISICIÓN DE VESTUARIO REFLECTANTE Y ELEMENTOS DE PROTECCIÓN
Presupuesto Estimado: $9.500.000 Exento de IVA.
Productos solicitados:
1. Chaqueta Micropolar Térmica Alta Visibilidad: Cantidad 150 UND. Color Naranjo Flúor, tela micropolar 300 gr/m2 antipilling, con cintas reflectantes 3M de 2 pulgadas bajo norma EN ISO 20471. Tallas S a XXL.
2. Pantalón Cargo Reflectante Gabardina: Cantidad 150 UND. Color Azul Marino con cintas reflectantes en perneras, tela gabardina 65% poliéster 35% algodón 240 gr.
Documentos requeridos:
- Anexo N° 1: Declaración Jurada Simple de Ausencia de Incompatibilidades (firmada).
- Anexo N° 3: Formulario de Oferta Económica (firmado).
- Certificado de Vigencia de la Sociedad.
Criterios de Evaluación: Precio 60%, Plazo de Entrega 20%, Cumplimiento Técnico 20%.
Garantía de seriedad: Boleta de garantía por $500.000.
Fecha de cierre: 2026-10-25 15:00.
"""

from app.services.ai_provider import PROMPT

payload = {
    'contents': [{'parts': [
        {'text': 'DOCUMENTO:\n' + sample_doc},
        {'text': PROMPT}
    ]}],
    'generationConfig': {
        'responseMimeType': 'application/json',
        'temperature': 0.1
    }
}

for m in ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash']:
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}'
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            txt = data['candidates'][0]['content']['parts'][0]['text']
            parsed = json.loads(txt)
            print(f"=== {m} SUCCESS ===")
            print(f"Products ({len(parsed.get('products', []))}):", [p.get('name') for p in parsed.get('products', [])])
            print(f"Docs ({len(parsed.get('documents', []))}):", [d.get('title') for d in parsed.get('documents', [])])
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:120]
        print(f"{m}: HTTP {e.code} -> {body}")
    except Exception as ex:
        print(f"{m}: ERROR -> {ex}")
