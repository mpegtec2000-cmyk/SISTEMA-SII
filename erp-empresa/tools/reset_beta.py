"""Hard reset de datos para Beta Cerrada.

Vacia TODAS las tablas de la BD maestra (conserva el esquema), elimina las BD de
empresas (data/tenants), y limpia uploads/generated/catalog_images.
Conserva data/ai_settings.json y data/secret.key.
Uso:  python tools/reset_beta.py [--force]
"""
import os, shutil, sqlite3, socket, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DB = os.path.join(DATA, "erp_database.db")


def server_up():
    s = socket.socket()
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", 8000)) == 0
    finally:
        s.close()


def main():
    if server_up() and "--force" not in sys.argv:
        print("El servidor esta corriendo en :8000. Detengalo o use --force.")
        sys.exit(1)
    if "--backup" in sys.argv:
        dst = os.path.join(ROOT, "backup_pre_beta_" + time.strftime("%Y%m%d_%H%M%S"))
        shutil.copytree(DATA, dst)
        print("Backup:", dst)
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys=OFF")
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        con.execute('DELETE FROM "%s"' % t)
    try:
        con.execute("DELETE FROM sqlite_sequence")
    except sqlite3.OperationalError:
        pass
    con.commit()
    con.execute("VACUUM")
    con.close()
    tdir = os.path.join(DATA, "tenants")
    if os.path.isdir(tdir):
        for f in os.listdir(tdir):
            os.remove(os.path.join(tdir, f))
    for sub in ("uploads", "generated", "catalog_images", "company_logos"):
        p = os.path.join(DATA, sub)
        if os.path.isdir(p):
            for f in os.listdir(p):
                fp = os.path.join(p, f)
                shutil.rmtree(fp) if os.path.isdir(fp) else os.remove(fp)
    print("Reset OK. Tablas vaciadas:", len(tables))


if __name__ == "__main__":
    main()

