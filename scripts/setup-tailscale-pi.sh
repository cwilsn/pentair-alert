#!/usr/bin/env bash
set -euo pipefail

. /etc/os-release
if [[ "${ID:-}" != debian || "${VERSION_CODENAME:-}" != trixie ]]; then
  echo "This setup script expects Debian 13 (trixie)." >&2
  exit 1
fi

echo "Enter your Pi password if sudo asks for it."
sudo -v

if ! command -v tailscale >/dev/null 2>&1; then
  temporary_dir=$(mktemp -d)
  trap 'rm -rf "$temporary_dir"' EXIT

  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg \
    -o "$temporary_dir/tailscale-archive-keyring.gpg"
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list \
    -o "$temporary_dir/tailscale.list"

  sudo install -d -m 0755 /usr/share/keyrings /etc/apt/sources.list.d
  sudo install -m 0644 "$temporary_dir/tailscale-archive-keyring.gpg" \
    /usr/share/keyrings/tailscale-archive-keyring.gpg
  sudo install -m 0644 "$temporary_dir/tailscale.list" \
    /etc/apt/sources.list.d/tailscale.list
  sudo apt-get update
  sudo apt-get install -y tailscale
fi

sudo systemctl enable --now tailscaled
echo "Open the sign-in URL printed below on a device where you use Tailscale."
sudo tailscale up

tailscale_address=$(tailscale ip -4)
echo "Open http://${tailscale_address}:3000/ on a device connected to your tailnet."
