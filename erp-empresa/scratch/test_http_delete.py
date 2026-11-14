import urllib.request
import json
import sqlite3

conn = sqlite3.connect('data/erp_database.db')
cur = conn.cursor()
cur.execute("INSERT INTO business_folders (code, title, client_name, client_rut, company_id) VALUES ('CN-API-DEL-1', 'Carpeta Test API Delete', 'Test API', '76.111.222-3', 1)")
fid = cur.lastrowid
conn.commit()
print("Carpeta insertada:", fid)

req = urllib.request.Request(f'http://127.0.0.1:8000/api/folders/{fid}', method='DELETE')
req.add_header('Cookie', 'erp_token=SGNYkohaGlsH8ZhZe0qusm4zfeoyEJGYHZf9gFeq0J8; erp_company=1')
with urllib.request.urlopen(req) as resp:
    print("HTTP DELETE Status:", resp.status)
    print("HTTP Response:", resp.read().decode())

cur.execute('SELECT COUNT(*) FROM business_folders WHERE id = ?', (fid,))
print("Queda en BD:", cur.fetchone()[0])
assert cur.fetchone() is None
print("VERIFICACION HTTP DELETE EXITOSA")
