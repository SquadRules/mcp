#!/usr/bin/env bash
# setup-github-wiki-permissions.sh
# Configures the GitHub repository settings required for the wiki sync workflow.
#
# Prerequisites:
# - gh CLI authenticated with admin access to the repository
#
# What this does:
# 1. Enables the wiki feature on the repository
# 2. Sets GitHub Actions workflow permissions to read-write (contents: write)
#
# Usage: ./scripts/setup-github-wiki-permissions.sh [owner/repo]

set -euo pipefail

REPO="${1:-SquadRules/mcp}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}GitHub Wiki Permissions Setup${NC}"
echo "=============================="
echo "Repository: ${REPO}"
echo ""

# Check gh is available and authenticated
if ! command -v gh &>/dev/null; then
  echo -e "${RED}Error: gh CLI not found. Install from https://cli.github.com${NC}"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo -e "${RED}Error: gh CLI not authenticated. Run: gh auth login${NC}"
  exit 1
fi

# 1. Enable wiki on the repository
echo -e "${YELLOW}Enabling wiki on ${REPO}...${NC}"
gh repo edit "$REPO" --enable-wiki
echo -e "${GREEN}  Wiki enabled.${NC}"

# 2. Set Actions permissions to read-write so GITHUB_TOKEN can push to .wiki.git
echo -e "${YELLOW}Setting Actions default workflow permissions to read-write...${NC}"
gh api \
  --method PUT \
  "/repos/${REPO}/actions/permissions/workflow" \
  -f default_workflow_permissions="write" \
  -F can_approve_pull_request_reviews=true
echo -e "${GREEN}  Actions workflow permissions set to read-write.${NC}"

echo ""
echo -e "${GREEN}Done.${NC} The sync-qoder-repowiki-to-github-wiki workflow can now push to ${REPO}.wiki.git."
echo ""
echo "If the wiki has never been initialized:"
echo "  1. Go to https://github.com/${REPO}/wiki"
echo "  2. Create a page named 'Home'"
echo "  3. The workflow will overwrite it on next run."
