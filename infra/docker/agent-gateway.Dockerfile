FROM golang:1.25.12-alpine AS build
WORKDIR /src/agent
ARG VERSION=dev
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /out/monitc-agent-gateway ./cmd/monitc-agent-gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/monitc-agent-gateway /usr/local/bin/monitc-agent-gateway
EXPOSE 9443
ENTRYPOINT ["/usr/local/bin/monitc-agent-gateway"]
