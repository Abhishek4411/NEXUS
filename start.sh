#!/bin/bash
echo "============================================================"
echo "  NEXUS — Global Intelligence Platform"
echo "  Starting up..."
echo "============================================================"

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 not found"
    exit 1
fi

# Copy .env if not exists
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
fi

# Virtual environment
if [ ! -d venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "Installing/checking dependencies..."
pip install -r requirements.txt -q

echo ""
echo "============================================================"
echo "  NEXUS starting on http://localhost:8000"
echo "  Press Ctrl+C to stop"
echo "============================================================"
echo ""

python main.py
