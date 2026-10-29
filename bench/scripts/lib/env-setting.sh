# Sourced by the download scripts: read one setting from the repository's .env the way the
# benchmark sees it (node --env-file), so a path set only there is honored. An exported variable,
# even an empty one, wins over .env, as it does for node.
#
#   model_path CRISPASR_MODELS_PATH models/crispasr   -> absolute models folder

env_setting() {
  local file="$REPO_ROOT/.env" line value
  [ -f "$file" ] || return 0
  # The last assignment wins; "export KEY=value" and spaces around "=" are accepted.
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$file" | tail -n 1) || return 0
  value=${line#*=}
  value=$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//')
  case "$value" in
    \"*) value=${value#\"}; value=${value%%\"*} ;;
    \'*) value=${value#\'}; value=${value%%\'*} ;;
    *) value=$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;
  esac
  printf '%s' "$value"
}

model_path() {
  local name=$1 default=$2 value
  if [ -n "${!name+x}" ]; then value=${!name}; else value=$(env_setting "$name"); fi
  value=${value:-$default}
  case "$value" in
    /*) printf '%s' "$value" ;;
    *) printf '%s' "$REPO_ROOT/$value" ;;
  esac
}
