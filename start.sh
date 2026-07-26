#!/bin/bash

# Exit on absolute errors
set -e

# Store the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Starting Altenen Scraper Engine from: $PROJECT_ROOT"

# Function to clean up background processes on exit
cleanup() {
    echo ""
    echo "Shutting down servers..."
    if [ -n "$BACKEND_PID" ]; then
        echo "Stopping server (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    exit 0
}

# Register the cleanup function for Ctrl+C (SIGINT) and exit (SIGTERM)
trap cleanup SIGINT SIGTERM EXIT

# 1. Handle Python Virtual Environment
if [ -d "$PROJECT_ROOT/venv" ]; then
    echo "Activating virtual environment at venv..."
    source "$PROJECT_ROOT/venv/bin/activate"
elif [ -d "$PROJECT_ROOT/backend/venv" ]; then
    echo "Activating virtual environment at backend/venv..."
    source "$PROJECT_ROOT/backend/venv/bin/activate"
elif [ -d "$PROJECT_ROOT/.venv" ]; then
    echo "Activating virtual environment at .venv..."
    source "$PROJECT_ROOT/.venv/bin/activate"
else
    echo "Warning: No virtual environment (venv) found. Running with system python."
fi

# 2. Build Frontend UI assets
echo "Building frontend UI static assets..."
cd "$PROJECT_ROOT/frontend"
npm run build

# 3. Run Unified Server on Port 8080
echo "Starting unified FastAPI & React server on port 8080..."
cd "$PROJECT_ROOT/backend"
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8080 &
BACKEND_PID=$!

echo "--------------------------------------------------"
echo "Altenen Scraper Unified App is launching!"
echo "Server Address: http://localhost:8080"
echo "Press Ctrl+C to terminate the server."
echo "--------------------------------------------------"

# Wait for backend process to keep script running
wait
