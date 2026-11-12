#!/usr/bin/env bash
set -e

echo "Starting IzanDesk ERP Development Environment..."
cd "$(dirname "$0")/.."

pnpm --filter web dev
