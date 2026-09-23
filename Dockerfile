# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS web-builder
WORKDIR /build
COPY go.mod ./
COPY main.go semaphore.go index.html ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/server .
COPY index.html /out/

# Pinned to a minor release, not :latest. :latest moves on its own, so a
# rebuild with no code change could ship a different base system. 3.24 is the
# same line grantvera, recallis and bibliovera run.
FROM alpine:3.24
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=web-builder /out/server ./server
COPY --from=web-builder /out/index.html ./index.html
COPY bin/retraction-checker-pp-cli-linux ./retraction-checker
RUN chmod +x ./server ./retraction-checker
ENV CLI_BIN=/app/retraction-checker
# PORT is set in the image so it does not depend on docker-compose.yml. Until
# 2026-09-23 main.go defaulted to 8092 (devicera's port) and only the compose
# file's PORT=8093 hid it.
ENV PORT=8093
EXPOSE 8093
# The probe reads PORT, the same variable main.go listens on, so the two
# cannot disagree.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-8093}/healthz" || exit 1
CMD ["./server"]