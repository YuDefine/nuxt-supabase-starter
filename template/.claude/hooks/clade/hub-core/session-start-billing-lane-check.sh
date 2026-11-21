#!/usr/bin/env bash
exec node "${0%/*}/session-start-billing-lane-check.ts" "$@"
