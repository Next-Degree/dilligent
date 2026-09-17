#!/bin/bash
# Fix chrome-sandbox SUID permissions for Electron.
# The sandbox helper must be owned by root with setuid (4755).
SANDBOX="/opt/dilligent-device-agent/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi
