#!/usr/bin/env bash
# SessionStart hook: auto-build code-review-graph if graph.db doesn't exist
set -euo pipefail

# Monorepo detection
if [ -d "${PROJECT_DIR}/template/app" ]; then
  _PROJECT="${PROJECT_DIR}/template"
else
  _PROJECT="${PROJECT_DIR}"
fi

cd "$_PROJECT"

DB=".code-review-graph/graph.db"

# Skip if already built or tool not installed
[ -f "$DB" ] && exit 0
command -v code-review-graph >/dev/null 2>&1 || exit 0

code-review-graph build >/dev/null 2>&1

# Enable semantic search via embed_graph
SITE_PACKAGES=$(python3 -c "
import glob
paths = glob.glob('$HOME/.local/share/uv/tools/code-review-graph/lib/*/site-packages')
print(paths[0]) if paths else exit(1)
" 2>/dev/null) || exit 0

python3 -c "
import sys; sys.path.insert(0, '$SITE_PACKAGES')
from code_review_graph.tools import embed_graph
embed_graph()
" >/dev/null 2>&1 || true

echo '{"systemMessage": "Code knowledge graph initialized (build + embeddings)."}'
