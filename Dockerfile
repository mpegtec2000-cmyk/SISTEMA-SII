FROM python:3.12-slim

WORKDIR /app

# Dependencias del sistema operativo para procesamiento de PDFs, imágenes y OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependencias de Python
COPY erp-empresa/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copiar el código del ERP
COPY erp-empresa/ .

ENV PORT=8000
EXPOSE 8000

# Iniciar servidor Uvicorn con el puerto dinámico de Railway
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
