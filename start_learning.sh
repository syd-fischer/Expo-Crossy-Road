#!/bin/bash

# Ensure we cleanup background processes on exit
trap "kill 0" EXIT

echo "Checking for Python virtual environment..."
VENV_DIR="python/venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Virtual environment not found at $VENV_DIR. Creating one..."
    python3 -m venv "$VENV_DIR"
    echo "Installing required Python dependencies..."
    "$VENV_DIR/bin/pip" install websockets neat-python graphviz
else
    echo "Using existing virtual environment at $VENV_DIR."
fi

echo "Starting Python NEAT server..."
"$VENV_DIR/bin/python" python/server.py &
PYTHON_PID=$!

echo "Starting Expo..."
# Run expo in foreground
npm start

# Wait for background processes to exit
wait
