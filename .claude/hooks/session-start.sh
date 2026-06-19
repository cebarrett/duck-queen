#!/bin/bash
# SessionStart hook: install deps, then report build/test health into the
# session context so each (often unreviewed) AI session starts knowing whether
# it inherited a green build — and is nudged to leave it green.
set -uo pipefail

cd "$CLAUDE_PROJECT_DIR" || exit 0

# 1. Install dependencies so tsc/vitest are available. Idempotent; the web
#    container caches the result after the hook completes.
npm install --no-audit --no-fund >/tmp/dq-npm.log 2>&1
npm_status=$?

# 2. Type-check and run the test suite. Capture status; never fail the hook.
npx tsc --noEmit >/tmp/dq-tsc.log 2>&1
tsc_status=$?

npx vitest run >/tmp/dq-test.log 2>&1
test_status=$?

emit() { [ "$1" -eq 0 ] && echo "✅ $2" || echo "‼️ $2 (FAILED — see $3)"; }

ctx="Duck Queen build health at session start:
$(emit "$npm_status" "npm install" /tmp/dq-npm.log)
$(emit "$tsc_status" "tsc --noEmit" /tmp/dq-tsc.log)
$(emit "$test_status" "vitest run" /tmp/dq-test.log)

Leave the build green: run 'npx tsc --noEmit' and 'npm run test:run' before finishing. If anything above failed, fix it as part of your work."

# Emit as SessionStart additionalContext. Use node (always present in this
# project) to JSON-escape the message into valid hook output.
CTX="$ctx" node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:process.env.CTX}}))'
