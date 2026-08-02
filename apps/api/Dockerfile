FROM python:3.12.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/apps/api

COPY apps/api/pyproject.toml ./pyproject.toml
COPY apps/api/linger_api ./linger_api
COPY apps/api/alembic ./alembic
COPY apps/api/alembic.ini ./alembic.ini
COPY config /app/config

RUN pip install --upgrade pip==25.2 && pip install .

RUN addgroup --system linger && adduser --system --ingroup linger linger \
    && mkdir -p /app/apps/api/data && chown -R linger:linger /app

USER linger
EXPOSE 8080

CMD ["uvicorn", "linger_api.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
