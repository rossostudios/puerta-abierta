#!/bin/bash
# Script to apply the latest migration to production
# Usage: DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/apply-prod-migration.sh

set -e

MIGRATION_FILE="db/migrations/2026-02-12_marketplace-listing-completeness.sql"

if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL environment variable is not set."
  echo "Usage: DATABASE_URL='your_connection_string' ./scripts/apply-prod-migration.sh"
  exit 1
fi

if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql command not found. Please install PostgreSQL client tools."
    exit 1
fi

echo "🚀 Applying migration: $MIGRATION_FILE"
psql "$DATABASE_URL" -f "$MIGRATION_FILE"

echo "✅ Migration applied successfully!"
