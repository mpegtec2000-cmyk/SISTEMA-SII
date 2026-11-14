import sqlite3
import sys
import uuid
sys.path.insert(0, ".")

code = "CN-DEL-" + str(uuid.uuid4())[:8]

# 1. Limpiar previa si quedó
conn = sqlite3.connect("data/erp_database.db")
cur = conn.cursor()
cur.execute("DELETE FROM business_folders WHERE code = 'CN-TEST-DELETE'")
conn.commit()

# 2. Crear carpeta de prueba
cur.execute("INSERT INTO business_folders (code, title, client_name, client_rut, company_id) VALUES (?, 'Carpeta Prueba Eliminacion', 'Cliente Test', '76.111.222-3', 1)", (code,))
folder_id = cur.lastrowid
conn.commit()
print("Carpeta creada con ID:", folder_id, "Code:", code)

# 3. Agregar registros dependientes de prueba
cur.execute("INSERT INTO folder_requested_items (folder_id, item_number, product_name) VALUES (?, 1, 'Prod Test')", (folder_id,))
cur.execute("INSERT INTO folder_expenses (folder_id, description, amount, date) VALUES (?, 'Gasto Test', 50000, '2026-10-15')", (folder_id,))
conn.commit()

# 4. Invocar endpoint delete_folder_by_id
from app.routers.business_folders import delete_folder_by_id
res = delete_folder_by_id(folder_id)
print("Resultado delete_folder_by_id:", res)

# 5. Verificar que no exista en business_folders ni en tablas dependientes
cur.execute("SELECT COUNT(*) FROM business_folders WHERE id = ?", (folder_id,))
count_f = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM folder_requested_items WHERE folder_id = ?", (folder_id,))
count_i = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM folder_expenses WHERE folder_id = ?", (folder_id,))
count_e = cur.fetchone()[0]
print(f"Verificacion BD -> Carpetas: {count_f}, Items: {count_i}, Gastos: {count_e}")
assert count_f == 0 and count_i == 0 and count_e == 0
print("ELIMINACION DE CARPETAS Y CASCADA 100% VERIFICADA")
