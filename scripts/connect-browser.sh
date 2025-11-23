#!/bin/bash

# Get the Windows host IP (WSL2 gateway)
# Get the Windows host IP (WSL2 gateway)
# We use the default gateway IP
HOST_IP=$(ip route show | grep default | awk '{print $3}')

if [ -z "$HOST_IP" ]; then
    echo "Error: Could not determine Windows host IP."
    exit 1
fi

echo "Found Windows Host IP: $HOST_IP"

# Check if socat is already running for port 9222
if pgrep -f "socat .*TCP-LISTEN:9222" > /dev/null; then
    echo "Stopping existing socat forwarder..."
    pkill -f "socat .*TCP-LISTEN:9222"
fi

# Start socat
echo "Starting socat forwarder..."
# We use nohup so it persists if this shell closes, though usually it's run in a persistent terminal
nohup socat TCP-LISTEN:9222,fork,reuseaddr TCP:$HOST_IP:9222 > /dev/null 2>&1 &

echo "✅ Browser bridge connected on port 9222"
