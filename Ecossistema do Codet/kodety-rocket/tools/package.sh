#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
ECOSYSTEM_DIR="$(CDPATH= cd -- "${PLUGIN_DIR}/.." && pwd)"
DIST_DIR="${ECOSYSTEM_DIR}/dist"
ARCHIVE="${DIST_DIR}/kodety-rocket.zip"
STAGE_DIR="$(mktemp -d /tmp/kodety-rocket-package.XXXXXX)"

cleanup() {
  case "${STAGE_DIR}" in
    /tmp/kodety-rocket-package.*) rm -rf -- "${STAGE_DIR}" ;;
    *) printf 'Refusing to remove unexpected staging directory: %s\n' "${STAGE_DIR}" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

required_files=(
  "kodety-rocket.php"
  "uninstall.php"
  "readme.txt"
  "assets/admin.css"
  "assets/admin.js"
  "assets/fonts/inter-latin-variable.woff2"
  "src/Plugin.php"
  "src/Admin/AdminPage.php"
  "vendor-prefixed/autoload.php"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "${PLUGIN_DIR}/${required_file}" ]]; then
    printf 'Missing required release file: %s\n' "${PLUGIN_DIR}/${required_file}" >&2
    exit 1
  fi
done

mkdir -p "${STAGE_DIR}/kodety-rocket" "${DIST_DIR}"
rsync -a --delete --exclude-from="${PLUGIN_DIR}/.distignore" "${PLUGIN_DIR}/" "${STAGE_DIR}/kodety-rocket/"

for required_file in "${required_files[@]}"; do
  if [[ ! -f "${STAGE_DIR}/kodety-rocket/${required_file}" ]]; then
    printf 'Required file was excluded from the release: %s\n' "${required_file}" >&2
    exit 1
  fi
done

for forbidden_path in composer.json composer.lock tests tools vendor README.md .distignore; do
  if [[ -e "${STAGE_DIR}/kodety-rocket/${forbidden_path}" ]]; then
    printf 'Development-only path leaked into the release: %s\n' "${forbidden_path}" >&2
    exit 1
  fi
done

if grep -R -I -E 'Code Rocket|Code-Rocket|CodeRocket|CODE_ROCKET|code_rocket|code-rocket|codeRocket|(^|[^[:alnum:]_])cr[-_]' "${STAGE_DIR}/kodety-rocket" >/dev/null; then
  printf 'Legacy Code Rocket identity found in the release archive.\n' >&2
  exit 1
fi

if find "${STAGE_DIR}/kodety-rocket" -type l -print -quit | grep -q .; then
  printf 'Symbolic links are not allowed in the release archive.\n' >&2
  exit 1
fi

while IFS= read -r -d '' php_file; do
  php -l "${php_file}" >/dev/null
done < <(find "${STAGE_DIR}/kodety-rocket" -type f -name '*.php' -print0)

if grep -R -E '^namespace[[:space:]]+MatthiasMullie' "${STAGE_DIR}/kodety-rocket" --include='*.php' >/dev/null; then
  printf 'Release archive exposes an unprefixed third-party namespace.\n' >&2
  exit 1
fi

php -r "require '${STAGE_DIR}/kodety-rocket/vendor-prefixed/autoload.php'; exit(class_exists('KodetyRocketVendor\\MatthiasMullie\\Minify\\CSS') && class_exists('KodetyRocketVendor\\MatthiasMullie\\Minify\\JS') ? 0 : 1);"

find "${STAGE_DIR}/kodety-rocket" -exec touch -t 202601010000 {} +
TMP_ARCHIVE="${STAGE_DIR}/kodety-rocket.zip"
(
  cd "${STAGE_DIR}"
  find kodety-rocket -type f -print | LC_ALL=C sort | zip -X -q "${TMP_ARCHIVE}" -@
)

while IFS= read -r archive_path; do
  case "${archive_path}" in
    kodety-rocket/*) ;;
    *) printf 'Unsafe archive path: %s\n' "${archive_path}" >&2; exit 1 ;;
  esac
  if [[ "${archive_path}" == *"../"* || "${archive_path}" == /* ]]; then
    printf 'Traversal path found in archive: %s\n' "${archive_path}" >&2
    exit 1
  fi
done < <(unzip -Z1 "${TMP_ARCHIVE}")

unzip -t "${TMP_ARCHIVE}" >/dev/null
mv -f -- "${TMP_ARCHIVE}" "${ARCHIVE}"
printf 'Built %s\n' "${ARCHIVE}"
