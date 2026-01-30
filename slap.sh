#!/bin/bash
# Quick script to test captures without a browser

if [ -z "$1" ]; then
  echo "Usage: ./test-capture.sh \"your input text\""
  exit 1
fi

curl -s -X POST "http://localhost:4444/capture?token=dev-token" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$1\"}" | jq .
