#!/usr/bin/env bash
# Runs every probe measurement in sequence (they share the Neural Engine, so parallel runs skew latency).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
P=fluidaudio-worker/.build/release/ParakeetProbe
OUT=results/probe/$(date +%Y-%m-%d)
mkdir -p "$OUT"
EN=$(ls tests/*-en.json)
DE=$(ls tests/*-de.json)
RU=$(ls tests/*-ru.json)
# ONLY=<regex> runs a subset, e.g. ONLY=boost ./probe/run-all.sh
run() { local name=$1; shift; [[ $name =~ ${ONLY:-.} ]] || return 0; echo "== $name"; "$P" "$@" --out "$OUT/$name.jsonl" 2>"$OUT/$name.log" | tee "$OUT/$name.txt"; }
run padding padding $EN $DE $RU tests/code-switching-auto.json
run boost-dev-auto-en boosting --terms probe/terms-dev-en.txt probe/vocabulary-en.json $EN
run boost-dev-precise-en boosting --terms probe/terms-dev-en.txt --similarity 0.80 probe/vocabulary-en.json $EN
run boost-dev-auto-de boosting --terms probe/terms-dev-en.txt $DE
run boost-rust-precise-en boosting --terms probe/terms-rust-dev.txt --similarity 0.80 $EN
run boost-medicine-precise-de boosting --terms probe/terms-german-medicine.txt --similarity 0.80 $DE
