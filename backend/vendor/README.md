# SQLite source archive

`sqlite-autoconf-3530400.tar.gz` — official SQLite 3.53.4 source archive from
https://www.sqlite.org/2026/sqlite-autoconf-3530400.tar.gz.

SHA3-256 from https://www.sqlite.org/download.html:
`454e45f61c6bd75b7420e7190732dea03ce6639c63ada47bbc592f67fc340338`.

SQLite is in the public domain: https://www.sqlite.org/copyright.html.
The archive is included so corporate servers do not need direct access to sqlite.org
during image builds. Dockerfile verifies the checksum before extracting sqlite3.c.
