FROM python:3.12-slim-bookworm AS sqlite-build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
# Official SQLite 3.53.4; verify the source archive against sqlite.org's SHA3-256.
COPY vendor/sqlite-autoconf-3530400.tar.gz /tmp/sqlite.tar.gz
RUN python -c "import hashlib,tarfile,io; raw=open('/tmp/sqlite.tar.gz','rb').read(); assert hashlib.sha3_256(raw).hexdigest()=='454e45f61c6bd75b7420e7190732dea03ce6639c63ada47bbc592f67fc340338'; archive=tarfile.open(fileobj=io.BytesIO(raw)); open('/tmp/sqlite3.c','wb').write(archive.extractfile('sqlite-autoconf-3530400/sqlite3.c').read())"
RUN gcc -shared -fPIC -O2 -DSQLITE_THREADSAFE=1 -DSQLITE_ENABLE_COLUMN_METADATA \
    -Wl,-soname,libsqlite3.so.0 /tmp/sqlite3.c -o /tmp/libsqlite3.so.0 -lm -ldl -lpthread

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home vox \
    && mkdir /data && chown vox:vox /data
COPY --from=sqlite-build /tmp/libsqlite3.so.0 /usr/local/lib/libsqlite3.so.0
RUN ldconfig && python -c "import sqlite3; assert sqlite3.sqlite_version_info >= (3,51,3), sqlite3.sqlite_version"
WORKDIR /app
COPY requirements.txt requirements-docker.lock ./
RUN pip install -r requirements.txt -c requirements-docker.lock
COPY backend/ ./backend/
COPY *.py ./
USER vox
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
