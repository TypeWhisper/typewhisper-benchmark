#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="/home/marco/.local/share/typewhisper-benchmark"
state_root="/home/marco/.local/state/typewhisper-benchmark"
systemd_root="/home/marco/.config/systemd/user"
service_file="$systemd_root/typewhisper-benchmark.service"
commit_id="$(git -C "$source_root" rev-parse --short=12 HEAD)"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$commit_id"
release_root="$install_root/releases/$release_id"
current_link="$install_root/current"
next_link="$install_root/current.next"

cd "$source_root"
npm run build:recorder

install -d -m 0755 "$release_root/dist"
install -d -m 0755 "$release_root/web/recorder"
install -d -m 0755 "$release_root/corpus/recording-batches"
install -d -m 0700 "$state_root"
install -d -m 0700 "$state_root/corpus"
install -d -m 0700 "$state_root/corpus/inbox"
install -d -m 0700 "$state_root/uploads"
install -d -m 0700 "$state_root/uploads/pending"
install -d -m 0700 "$state_root/published"
install -d -m 0755 "$systemd_root"

cp -a "$source_root/dist/." "$release_root/dist/"
cp -a "$source_root/web/recorder/." "$release_root/web/recorder/"
cp -a "$source_root/corpus/recording-plan.v1.json" "$release_root/corpus/"
cp -a "$source_root/corpus/recording-batches/"*.json "$release_root/corpus/recording-batches/"
cp -a "$source_root/package.json" "$source_root/package-lock.json" "$release_root/"
install -m 0644 "$source_root/infra/systemd/app.env" "$release_root/app.env"

npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$release_root"

install -m 0644 "$source_root/infra/systemd/typewhisper-benchmark.service" "$service_file"
ln -sfn "$release_root" "$next_link"
mv -Tf "$next_link" "$current_link"

systemctl --user daemon-reload
systemctl --user enable --now typewhisper-benchmark.service
systemctl --user restart typewhisper-benchmark.service

for attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 2 \
    http://192.168.199.253:4192/api/health >/dev/null; then
    printf 'Installed release %s\n' "$release_id"
    printf 'Configuration: %s\n' "$current_link/app.env"
    exit 0
  fi
  sleep 1
done

systemctl --user status typewhisper-benchmark.service --no-pager
exit 1
