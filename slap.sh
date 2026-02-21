#!/bin/bash
# Quick script to test captures without a browser

if [ -z "$1" ]; then
  echo "Usage: ./slap.sh \"your input text\""
  exit 1
fi

# Check if server is running
if ! curl -s --connect-timeout 2 "http://localhost:4444/routes?token=dev-token" > /dev/null 2>&1; then
  echo "Error: Slapture server is not running"
  echo "Start it with: pnpm start"
  exit 1
fi

curl -s -X POST "http://localhost:4444/capture?token=dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$1\"}" | jq .
