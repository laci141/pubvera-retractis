# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS web-builder
WORKDIR /build
COPY go.mod ./
COPY main.go semaphore.go index.html ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/server .
COPY index.html /out/

FROM alpine:latest
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=web-builder /out/server ./server
COPY --from=web-builder /out/index.html ./index.html
COPY bin/retraction-checker-pp-cli-linux ./retraction-checker
RUN chmod +x ./server ./retraction-checker
ENV CLI_BIN=/app/retraction-checker
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8092/healthz || exit 1
CMD ["./server"]