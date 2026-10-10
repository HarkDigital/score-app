#!/usr/bin/env bash
# Deploy the push server to the Phade box as /opt/scores-push (its own compose
# project on Phade's Docker network; see server/README.md for the one-time
# setup: key, .env, certificate, nginx). Run from the repo root:
#
#   bash server/deploy.sh
#
set -euo pipefail

HOST="${SCORES_PUSH_HOST:-root@74.208.219.49}"
KEY="${SCORES_PUSH_SSH_KEY:-$HOME/.ssh/ionos_vps}"
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20"
REMOTE=/opt/scores-push

cd "$(dirname "$0")/.."

echo "==> tests"
npm test --silent >/dev/null

echo "==> syncing code"
$SSH "$HOST" "mkdir -p $REMOTE/app/server $REMOTE/data $REMOTE/secrets"
rsync -az --delete -e "$SSH" --exclude test/ --exclude data/ --exclude secrets/ --exclude .env \
  --exclude deploy.sh --exclude docker-compose.yml --exclude '*.conf' --exclude README.md \
  server/ "$HOST:$REMOTE/app/server/"
# espn.js, news.js and details.js are the app's own parsers; package.json makes Node treat .js as ES modules.
rsync -az -e "$SSH" espn.js news.js details.js package.json "$HOST:$REMOTE/app/"
rsync -az -e "$SSH" server/docker-compose.yml "$HOST:$REMOTE/docker-compose.yml"

echo "==> restarting"
$SSH "$HOST" "cd $REMOTE && test -f secrets/apns.p8 && test -f .env && docker compose up -d --force-recreate 2>&1 | tail -2
  for i in \$(seq 1 20); do docker exec scores-push wget -qO- http://127.0.0.1:8080/health 2>/dev/null && exit 0; sleep 1; done
  echo 'health check failed'; docker logs --tail 20 scores-push; exit 1"
echo
echo "==> done"
