import sys
sys.path.insert(0, ".")
from app.services import ai_provider

pages = [
    (1, "MUNICIPALIDAD DE PROVIDENCIA\nBASES ADMINISTRATIVAS Y TÉCNICAS\nLICITACIÓN ID: 3412-10-LE26"),
    (2, "PRESUPUESTO ESTIMADO: $15.000.000 NETO\nEl plazo de entrega será de 15 días hábiles desde la emisión de la OC."),
    (3, "PRODUCTOS SOLICITADOS:\n1. Parka Térmica Alta Visibilidad 300D Impermeable: Cantidad 100 UND. Con cinta reflectante 3M Clase 3.\n2. Chaleco Geólogo Reflectante con Malla: Cantidad 100 UND. Color Naranjo Flúor con múltiples bolsillos."),
    (4, "CRONOGRAMA:\n- Publicación: 2026-10-15\n- Cierre de Ofertas: 2026-10-30 15:00\n- Apertura Técnica: 2026-10-30 15:30"),
    (5, "DOCUMENTOS A ADJUNTAR:\n- Anexo 1: Declaración Jurada Simple\n- Anexo 2: Oferta Económica\n- Patente Municipal al día"),
    (6, "CRITERIOS DE EVALUACIÓN:\n- Precio: 50%\n- Calidad técnica: 30%\n- Plazo de entrega: 20%"),
    (7, "GARANTÍAS:\n- Seriedad de la oferta por $300.000 mediante vale vista o póliza electrónica.")
]

print("Iniciando prueba de ai_provider.analyze...")
result, label, warnings = ai_provider.analyze(None, "bases_licitacion_test.pdf", pages)
print(f"Proveedor / Modelo resultante: {label}")
print(f"Advertencias ({len(warnings)}):", warnings)
print(f"Productos detectados ({len(result.get('products', []))}):")
for p in result.get("products", []):
    print(f" - {p.get('name')} | Cantidad: {p.get('quantity')} {p.get('unit')} | Specs: {p.get('specs')}")
print(f"Documentos detectados ({len(result.get('documents', []))}):")
for d in result.get("documents", []):
    print(f" - {d.get('title')} ({d.get('category')})")
print(f"Hitos detectados ({len(result.get('milestones', []))}):")
for m in result.get("milestones", []):
    print(f" - {m.get('title')} | Fecha: {m.get('date')} {m.get('time')}")
print("FIN DE LA PRUEBA EXITOSA")
