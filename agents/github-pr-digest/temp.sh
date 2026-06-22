#!/usr/bin/env bash
set -euo pipefail

OWNER="senthilsweb"
REPO="templrgo"
BASE_BRANCH="main"
COUNT=5

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN first}"

api() {
  curl --fail-with-body -sS \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

BASE_RESPONSE=$(
  api "https://api.github.com/repos/$OWNER/$REPO/git/ref/heads/$BASE_BRANCH"
)

BASE_SHA=$(echo "$BASE_RESPONSE" | jq -r '.object.sha // empty')

if [[ -z "$BASE_SHA" ]]; then
  echo "Could not resolve base branch SHA:"
  echo "$BASE_RESPONSE" | jq .
  exit 1
fi

RUN_ID=$(date -u +"%Y%m%dT%H%M%SZ")

for i in $(seq 1 "$COUNT"); do
  BRANCH="test/dummy-pr-$RUN_ID-$i"
  FILE_PATH="dummy/$RUN_ID/pr-$i.txt"

  CONTENT=$(
    printf "Dummy PR %s created at %s\n" "$i" "$(date -u)" |
      base64 |
      tr -d '\n'
  )

  echo "Creating branch: $BRANCH"

  api -X POST \
    "https://api.github.com/repos/$OWNER/$REPO/git/refs" \
    -d "$(jq -n \
      --arg ref "refs/heads/$BRANCH" \
      --arg sha "$BASE_SHA" \
      '{ref:$ref, sha:$sha}')" \
    >/dev/null

  echo "Creating file: $FILE_PATH"

  api -X PUT \
    "https://api.github.com/repos/$OWNER/$REPO/contents/$FILE_PATH" \
    -d "$(jq -n \
      --arg message "test: add dummy file for PR $i" \
      --arg content "$CONTENT" \
      --arg branch "$BRANCH" \
      '{message:$message, content:$content, branch:$branch}')" \
    >/dev/null

  echo "Creating PR..."

  PR_RESPONSE=$(
    api -X POST \
      "https://api.github.com/repos/$OWNER/$REPO/pulls" \
      -d "$(jq -n \
        --arg title "Test PR $i" \
        --arg head "$BRANCH" \
        --arg base "$BASE_BRANCH" \
        --arg body "Generated for GitHub PR Digest testing." \
        '{title:$title, head:$head, base:$base, body:$body}')"
  )

  PR_NUMBER=$(echo "$PR_RESPONSE" | jq -r '.number // empty')
  PR_URL=$(echo "$PR_RESPONSE" | jq -r '.html_url // empty')

  if [[ -z "$PR_NUMBER" ]]; then
    echo "Failed to create PR:"
    echo "$PR_RESPONSE" | jq .
    exit 1
  fi

  echo "Created PR #$PR_NUMBER: $PR_URL"
done