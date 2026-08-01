package main

import (
	"context"
	"crypto/tls"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"github.com/Rampesna/monitc/agent/internal/gateway"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
)

var version = "dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	config, err := gateway.LoadConfig()
	if err != nil {
		logger.Error("invalid gateway configuration", "error", err)
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	store, err := gateway.NewStore(ctx, config.DatabaseURL)
	if err != nil {
		logger.Error("database initialization failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	authority, err := gateway.EnsureAuthority(config)
	if err != nil {
		logger.Error("PKI initialization failed", "error", err)
		os.Exit(1)
	}

	listener, err := net.Listen("tcp", config.ListenAddress)
	if err != nil {
		logger.Error("gateway listener failed", "address", config.ListenAddress, "error", err)
		os.Exit(1)
	}
	server := grpc.NewServer(
		grpc.Creds(credentials.NewTLS(authority.ServerTLSConfig())),
		grpc.MaxRecvMsgSize(config.MaxReceiveBytes),
		grpc.MaxSendMsgSize(config.MaxSendBytes),
		grpc.ConnectionTimeout(10*time.Second),
	)
	agentv1.RegisterAgentGatewayServiceServer(server, gateway.NewService(store, authority, config, logger))
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", healthv1.HealthCheckResponse_SERVING)
	healthv1.RegisterHealthServer(server, healthServer)

	go func() {
		<-ctx.Done()
		healthServer.SetServingStatus("", healthv1.HealthCheckResponse_NOT_SERVING)
		stopped := make(chan struct{})
		go func() {
			server.GracefulStop()
			close(stopped)
		}()
		select {
		case <-stopped:
		case <-time.After(15 * time.Second):
			server.Stop()
		}
	}()

	logger.Info("Monitc agent gateway started", "version", version, "address", config.ListenAddress,
		"tls_min_version", tls.VersionTLS13)
	if err := server.Serve(listener); err != nil && ctx.Err() == nil {
		logger.Error("gateway stopped unexpectedly", "error", err)
		os.Exit(1)
	}
}
