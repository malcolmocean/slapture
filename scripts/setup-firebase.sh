#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Slapture Firebase Setup
# ============================================================================
# Creates a Firebase project with Firestore and a service account key.
#
# Usage:
#   ./scripts/setup-firebase.sh [project-id]
#
# If no project-id is given, generates one like "slapture-a7f3b".
#
# Prerequisites:
#   - firebase-tools: pnpm add -g firebase-tools && firebase login
#   - gcloud CLI:     brew install google-cloud-sdk && gcloud auth login
# ============================================================================

PROJECT_ID="${1:-slapture-$(openssl rand -hex 3)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_FILE="$PROJECT_ROOT/firebase-service-account.json"
SERVICE_ACCOUNT="slapture-server"
REGION="us-east1"

echo "==> Setting up Firebase project: $PROJECT_ID"
echo ""

# --- Check prerequisites ---------------------------------------------------
for cmd in firebase gcloud; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' not found. Install it first:"
    if [ "$cmd" = "firebase" ]; then
      echo "  pnpm add -g firebase-tools && firebase login"
    else
      echo "  brew install google-cloud-sdk && gcloud auth login"
    fi
    exit 1
  fi
done

# --- Create Firebase project ------------------------------------------------
echo "==> Creating Firebase project..."
firebase projects:create "$PROJECT_ID" --display-name "Slapture" 2>&1 || {
  echo ""
  echo "Project creation failed. Common causes:"
  echo "  - Project ID '$PROJECT_ID' is already taken (they're globally unique)"
  echo "  - Not logged in: run 'firebase login'"
  echo "  - Billing not enabled on your Google account"
  echo ""
  echo "Try again with a different name:"
  echo "  ./scripts/setup-firebase.sh my-slapture-instance"
  exit 1
}

# --- Set gcloud project -----------------------------------------------------
echo ""
echo "==> Configuring gcloud for project $PROJECT_ID..."
gcloud config set project "$PROJECT_ID" 2>&1

# --- Enable Firestore API ---------------------------------------------------
echo ""
echo "==> Enabling Firestore API..."
gcloud services enable firestore.googleapis.com 2>&1

# --- Create Firestore database -----------------------------------------------
echo ""
echo "==> Creating Firestore database in $REGION..."
gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID" 2>&1

# --- Create service account --------------------------------------------------
echo ""
echo "==> Creating service account..."
gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --display-name="Slapture Server" \
  --project="$PROJECT_ID" 2>&1

SA_EMAIL="${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "==> Granting Firestore access..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user" \
  --quiet 2>&1

# --- Generate key file -------------------------------------------------------
echo ""
echo "==> Generating service account key..."
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT_ID" 2>&1

# --- Update .env -------------------------------------------------------------
ENV_FILE="$PROJECT_ROOT/.env"

update_env_var() {
  local key="$1" value="$2" file="$3"
  if [ -f "$file" ] && grep -q "^${key}=" "$file"; then
    # Use a temp file for portable sed -i
    sed "s|^${key}=.*|${key}=${value}|" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

echo ""
echo "==> Updating .env..."
update_env_var "GOOGLE_APPLICATION_CREDENTIALS" "./firebase-service-account.json" "$ENV_FILE"
update_env_var "FIREBASE_PROJECT_ID" "$PROJECT_ID" "$ENV_FILE"

# --- Done --------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Firebase setup complete!"
echo "============================================"
echo ""
echo "  Project ID:    $PROJECT_ID"
echo "  Firestore:     $REGION"
echo "  Key file:      $KEY_FILE"
echo "  Console:       https://console.firebase.google.com/project/$PROJECT_ID/overview"
echo ""
echo "  Your .env has been updated. Run 'pnpm dev' to start."
echo ""
