# syntax=docker/dockerfile:1
# ---- Stage 1: build the retraction-checker CLI from upstream source ----
# The CLI used to be cross-compiled on a workstation by vendor-cli.sh and
# committed as bin/retraction-checker-pp-cli-linux (Git LFS). Nothing in the
# image said which upstream source that binary came from.
#
# Now the image builds it from one pinned upstream commit, stamped on the
# image as the label org.pubvera.cli.commit. Same pattern as pubvera-recallis.
#
# PP_LIBRARY_COMMIT is declared before the first FROM so it is global. An ARG
# declared after a FROM exists only in that stage; each stage that needs the
# value re-declares it with a bare ARG and inherits this default. Declaring
# the default inside the builder stage only left the label empty on
# pubvera-recallis (measured 2026-09-24), and CI now fails on that.
ARG PP_LIBRARY_COMMIT=58edea349ce3df8a301d4d8950119487c32604b8

FROM golang:1.26-alpine AS cli-builder
ARG PP_LIBRARY_COMMIT
RUN CGO_ENABLED=0 go install -trimpath \
    github.com/mvanhorn/printing-press-library/library/other/retraction-checker/cmd/retraction-checker-pp-cli@${PP_LIBRARY_COMMIT}

# ---- Stage 2: build the Go web server ----
FROM golang:1.26-alpine AS web-builder
WORKDIR /build
COPY go.mod ./
COPY main.go semaphore.go index.html ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/server .
COPY index.html /out/

# ---- Stage 3: minimal runtime ----
# Pinned to a minor release, not :latest. :latest moves on its own, so a
# rebuild with no code change could ship a different base system. 3.24 is the
# same line grantvera, recallis and bibliovera run.
FROM alpine:3.24
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=web-builder /out/server ./server
COPY --from=web-builder /out/index.html ./index.html
COPY --from=cli-builder /go/bin/retraction-checker-pp-cli ./retraction-checker
RUN chmod +x ./server ./retraction-checker

# The upstream commit the CLI was built from, readable with docker inspect.
ARG PP_LIBRARY_COMMIT
LABEL org.pubvera.cli.commit=${PP_LIBRARY_COMMIT}

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