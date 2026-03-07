#!/usr/bin/env bash
exec "$(dirname "$0")/deploy-production.sh" backend "$@"
