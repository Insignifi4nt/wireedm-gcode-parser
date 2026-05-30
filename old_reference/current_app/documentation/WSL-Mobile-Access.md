# WSL Mobile Access Setup

## Problem
When running the dev server from WSL, other devices (like phones) on the same network cannot access the application due to WSL2's network isolation.

## Solution
Use Windows port forwarding to route traffic from the Windows host to WSL.

### Prerequisites
- Running dev server from WSL
- Need access from another device on the same network
- Administrator privileges on Windows

### Setup Commands

**1. Start dev server in WSL:**
```bash
npm run dev -- --host 0.0.0.0
```

**2. Enable port forwarding (run as Administrator in Windows CMD/PowerShell):**
```cmd
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=172.26.138.205
```

**3. Access from mobile device:**
- Find your Windows machine's local IP: `192.168.1.133` (example)
- Open: `http://192.168.1.133:3000/`

### Cleanup When Done

**Remove port forwarding (run as Administrator):**
```cmd
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
```

### Notes
- Port forwarding is persistent across reboots until manually removed
- WSL IP (172.26.138.205) may change between WSL restarts
- Each project port needs its own forwarding rule
- Always clean up when finished to avoid security risks