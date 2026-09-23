FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0

COPY requirements.txt .

# Install dependencies — force reinstall websocket-client LAST to avoid
# namespace conflict between 'websockets' (async) and 'websocket-client' (SmartApi)
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir --force-reinstall websocket-client>=1.6.1

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
