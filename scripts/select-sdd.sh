#!/bin/bash

# SDD (Spec-Driven Development) 工具選擇腳本
# 讓使用者選擇 OpenSpec 或 Spectra，並移除不需要的那套

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="$PROJECT_DIR/.claude"
CLAUDE_MD="$PROJECT_DIR/CLAUDE.md"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          Spec-Driven Development (SDD) 工具選擇             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  兩套系統共用 openspec/ 目錄結構與 config.yaml              ║"
echo "║                                                            ║"
echo "║  [1] OpenSpec (/opsx:*)                                    ║"
echo "║      - 輕量版，適合快速上手                                ║"
echo "║      - 命令：new, apply, archive, verify, sync...         ║"
echo "║      - 跨平台支援                                         ║"
echo "║                                                            ║"
echo "║  [2] Spectra (/spectra:*)                                  ║"
echo "║      - 進化版，功能更完整                                  ║"
echo "║      - 命令：propose, apply, archive, verify, discuss...  ║"
echo "║      - 新增 discuss, ingest, clarify, debug, tdd, ask     ║"
echo "║      - GUI 目前僅支援 macOS                                ║"
echo "║                                                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# 詢問使用者選擇
while true; do
  read -r -p "請選擇 [1] OpenSpec 或 [2] Spectra: " choice
  case "$choice" in
    1) selected="openspec"; break ;;
    2) selected="spectra"; break ;;
    *) echo "請輸入 1 或 2" ;;
  esac
done

echo ""

if [ "$selected" = "openspec" ]; then
  echo "📦 你選擇了 OpenSpec"
  echo ""
  echo "🗑️  移除 Spectra 檔案..."

  # 移除 spectra commands
  rm -rf "$CLAUDE_DIR/commands/spectra"
  echo "   ✓ 移除 .claude/commands/spectra/"

  # 移除 spectra skills
  for dir in "$CLAUDE_DIR/skills/spectra-"*/; do
    if [ -d "$dir" ]; then
      rm -rf "$dir"
      echo "   ✓ 移除 .claude/skills/$(basename "$dir")/"
    fi
  done

  # 修補 CLAUDE.md：移除 SPECTRA:START 區塊
  if grep -q '<!-- SPECTRA:START' "$CLAUDE_MD"; then
    sed -i '' '/<!-- SPECTRA:START/,/<!-- SPECTRA:END -->/d' "$CLAUDE_MD"
    # 移除區塊後可能留下的開頭空行
    sed -i '' '/./,$!d' "$CLAUDE_MD"
    echo "   ✓ 移除 CLAUDE.md 中的 Spectra 區塊"
  fi

  # 修補 CLAUDE.md：移除 spectra trigger 行
  sed -i '' '/| `\/spectra:/d' "$CLAUDE_MD"
  echo "   ✓ 移除 CLAUDE.md 中的 Spectra triggers"

  # 修補 CLAUDE.md：移除 spectra AI Skills 行
  sed -i '' '/中大型功能規劃 (Spectra)/d' "$CLAUDE_MD"
  # 將 OpenSpec 標籤的括號移除
  sed -i '' 's/| 中大型功能規劃 (OpenSpec) /| 中大型功能規劃              /' "$CLAUDE_MD"
  echo "   ✓ 移除 CLAUDE.md 中的 Spectra AI Skills"

else
  echo "📦 你選擇了 Spectra"
  echo ""
  echo "🗑️  移除 OpenSpec 檔案..."

  # 移除 opsx commands
  rm -rf "$CLAUDE_DIR/commands/opsx"
  echo "   ✓ 移除 .claude/commands/opsx/"

  # 移除 openspec skills
  for dir in "$CLAUDE_DIR/skills/openspec-"*/; do
    if [ -d "$dir" ]; then
      rm -rf "$dir"
      echo "   ✓ 移除 .claude/skills/$(basename "$dir")/"
    fi
  done

  # 修補 CLAUDE.md：移除 opsx trigger 行
  sed -i '' '/| `\/opsx:/d' "$CLAUDE_MD"
  echo "   ✓ 移除 CLAUDE.md 中的 OpenSpec triggers"

  # 修補 CLAUDE.md：移除 opsx AI Skills 行
  sed -i '' '/中大型功能規劃 (OpenSpec)/d' "$CLAUDE_MD"
  # 將 Spectra 標籤的括號移除
  sed -i '' 's/| 中大型功能規劃 (Spectra)  /| 中大型功能規劃              /' "$CLAUDE_MD"
  echo "   ✓ 移除 CLAUDE.md 中的 OpenSpec AI Skills"
fi

echo ""
echo "✅ 設定完成！"
echo ""
echo "下一步："
echo "1. 重啟 Claude Code CLI 以載入新設定"
if [ "$selected" = "openspec" ]; then
  echo "2. 使用 /opsx:new 建立第一個變更提案"
else
  echo "2. 使用 /spectra:propose 建立第一個變更提案"
fi
