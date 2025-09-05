#!/bin/bash

echo "Starting RPPL Privacy Toolkit..."
echo ""

# Start backend server in background
echo "Starting Backend Server..."
python application.py &
BACKEND_PID=$!

# Wait for backend to start
echo "Waiting for backend to start..."
sleep 3

# Start frontend server in background
echo "Starting Frontend Server..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Application starting..."
echo "Backend: http://localhost:5000 (PID: $BACKEND_PID)"
echo "Frontend: http://localhost:3000 (PID: $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait