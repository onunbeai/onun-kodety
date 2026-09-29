#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
SCOPER_BIN="${1:-${PHP_SCOPER_BIN:-}}"
STAGE_ROOT="$(mktemp -d /tmp/kodety-rocket-scope.XXXXXX)"
TARGET_DIR="${PLUGIN_DIR}/vendor-prefixed"
BACKUP_DIR="${STAGE_ROOT}/previous-vendor-prefixed"

cleanup() {
  case "${STAGE_ROOT}" in
    /tmp/kodety-rocket-scope.*) rm -rf -- "${STAGE_ROOT}" ;;
    *) printf 'Refusing to remove unexpected staging directory: %s\n' "${STAGE_ROOT}" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

if [[ -z "${SCOPER_BIN}" || ! -f "${SCOPER_BIN}" ]]; then
  printf 'Usage: %s /absolute/path/to/php-scoper.phar\n' "$0" >&2
  exit 1
fi

if [[ ! -d "${PLUGIN_DIR}/vendor/matthiasmullie/minify/src" || ! -d "${PLUGIN_DIR}/vendor/matthiasmullie/path-converter/src" ]]; then
  printf 'Raw Composer dependencies are missing. Run composer install first.\n' >&2
  exit 1
fi

php "${SCOPER_BIN}" add-prefix \
  --no-config \
  --prefix='KodetyRocketVendor' \
  --output-dir="${STAGE_ROOT}/vendor-prefixed" \
  --php-version=8.0 \
  "${PLUGIN_DIR}/vendor/matthiasmullie"

cp "${SCRIPT_DIR}/vendor-autoload.php" "${STAGE_ROOT}/vendor-prefixed/autoload.php"

while IFS= read -r -d '' php_file; do
  php -l "${php_file}" >/dev/null
done < <(find "${STAGE_ROOT}/vendor-prefixed" -type f -name '*.php' -print0)

if grep -R -E '^namespace[[:space:]]+MatthiasMullie' "${STAGE_ROOT}/vendor-prefixed" --include='*.php' >/dev/null; then
  printf 'Unprefixed MatthiasMullie namespace remains in generated dependencies.\n' >&2
  exit 1
fi

php -r "require '${STAGE_ROOT}/vendor-prefixed/autoload.php'; exit(class_exists('KodetyRocketVendor\\MatthiasMullie\\Minify\\CSS') && class_exists('KodetyRocketVendor\\MatthiasMullie\\Minify\\JS') ? 0 : 1);"

if [[ -e "${TARGET_DIR}" ]]; then
  mv -- "${TARGET_DIR}" "${BACKUP_DIR}"
fi

if mv -- "${STAGE_ROOT}/vendor-prefixed" "${TARGET_DIR}"; then
  rm -rf -- "${BACKUP_DIR}"
else
  if [[ -e "${BACKUP_DIR}" ]]; then
    mv -- "${BACKUP_DIR}" "${TARGET_DIR}"
  fi
  exit 1
fi

printf 'Generated isolated dependencies in %s\n' "${TARGET_DIR}"
