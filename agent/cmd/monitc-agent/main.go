package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	monitcagent "github.com/Rampesna/monitc/agent/internal/agent"
)

var version = "dev"

func main() {
	configurationPath := flag.String("config", "/etc/monitc-agent/config.yaml", "path to the agent configuration")
	pairOnly := flag.Bool("pair-only", false, "pair this installation and exit")
	showVersion := flag.Bool("version", false, "print the agent version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("monitc-agent %s\n", version)
		return
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	config, err := monitcagent.LoadConfig(*configurationPath)
	if err != nil {
		logger.Error("invalid agent configuration", "error", err)
		os.Exit(1)
	}
	runtime, err := monitcagent.NewRuntime(config, version, logger)
	if err != nil {
		logger.Error("agent initialization failed", "error", err)
		os.Exit(1)
	}
	defer runtime.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if *pairOnly {
		err = runtime.PairOnly(ctx)
	} else {
		err = runtime.Run(ctx)
	}
	if err != nil {
		logger.Error("agent stopped", "error", err)
		os.Exit(1)
	}
}
