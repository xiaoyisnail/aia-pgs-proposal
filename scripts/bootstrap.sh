#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "❌ PLATFORM_UNSUPPORTED: 此入口仅用于 macOS"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root="$(cd "${script_dir}/.." && pwd)"
runtime_dir="${skill_root}/.runtime/node"

node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true
}

node_bin="$(command -v node || true)"
if [[ -z "${node_bin}" || "$(node_major "${node_bin}")" -lt 20 ]]; then
  portable_node="${runtime_dir}/bin/node"
  if [[ -x "${portable_node}" && "$(node_major "${portable_node}")" -ge 20 ]]; then
    node_bin="${portable_node}"
  else
    for required in curl tar shasum awk; do
      if ! command -v "${required}" >/dev/null 2>&1; then
        echo "❌ BOOTSTRAP_TOOL_REQUIRED: macOS 缺少 ${required}"
        exit 1
      fi
    done

    case "$(uname -m)" in
      arm64) node_arch="arm64" ;;
      x86_64) node_arch="x64" ;;
      *)
        echo "❌ ARCH_UNSUPPORTED: 不支持的 Mac 架构 $(uname -m)"
        exit 1
        ;;
    esac

    install_dir="$(mktemp -d "${TMPDIR:-/tmp}/aia-pgs-node.XXXXXX")"
    manifest="${install_dir}/SHASUMS256.txt"
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" -o "${manifest}"
    archive="$(awk -v arch="${node_arch}" '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }' "${manifest}")"
    expected="$(awk -v target="${archive}" '$2 == target { print $1; exit }' "${manifest}")"
    if [[ -z "${archive}" || -z "${expected}" ]]; then
      echo "❌ NODE_ARCHIVE_NOT_FOUND: 官方清单没有匹配的 macOS Node.js 包"
      exit 1
    fi

    echo "📦 正在下载官方 Node.js 22 到 Skill 私有运行目录…"
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/${archive}" -o "${install_dir}/${archive}"
    actual="$(shasum -a 256 "${install_dir}/${archive}" | awk '{ print $1 }')"
    if [[ "${actual}" != "${expected}" ]]; then
      echo "❌ NODE_CHECKSUM_MISMATCH: Node.js 下载校验失败"
      exit 1
    fi

    tar -xzf "${install_dir}/${archive}" -C "${install_dir}"
    extracted="${install_dir}/${archive%.tar.gz}"
    mkdir -p "${skill_root}/.runtime"
    rm -rf "${runtime_dir}"
    mv "${extracted}" "${runtime_dir}"
    node_bin="${runtime_dir}/bin/node"
  fi
fi

export PATH="$(dirname "${node_bin}"):${PATH}"
cd "${skill_root}"
echo "✅ Node.js $("${node_bin}" --version)"
npm run onboard -- "$@"
