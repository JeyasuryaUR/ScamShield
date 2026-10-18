# Multi-arch image: linux/amd64 for laptops/CI, linux/s390x for IBM LinuxONE.
#   docker buildx build --platform linux/amd64,linux/s390x -f services/scorer/Dockerfile .
# Build context is the repo root so the trained artifacts can be baked in.
FROM python:3.12-slim AS build

# LightGBM has no prebuilt s390x wheel; cmake + a compiler let pip build it from source.
RUN apt-get update && apt-get install -y --no-install-recommends cmake g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY services/scorer/pyproject.toml ./
COPY services/scorer/scorer ./scorer
RUN pip wheel --no-cache-dir --wheel-dir /wheels .

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 scorer
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels

WORKDIR /app
COPY ml/artifacts/model.txt ml/artifacts/policy.yaml ./artifacts/
COPY ml/artifacts/state_snapshot.pkl.gz ./artifacts/
ENV ARTIFACT_DIR=/app/artifacts PYTHONUNBUFFERED=1
USER scorer
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# One worker: FeatureState lives in-process. Scale out with Redis-backed state, not workers.
CMD ["uvicorn", "scorer.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
