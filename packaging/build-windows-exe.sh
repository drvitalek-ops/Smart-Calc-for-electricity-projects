#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(dirname "$script_dir")
launcher_dir="$script_dir/windows-launcher"
output_dir="$project_root/release"
go_binary=${GO_BINARY:-go}

mkdir -p "$output_dir"
git -C "$project_root" archive --format=zip --output="$launcher_dir/payload.zip" HEAD
trap 'rm -f "$launcher_dir/payload.zip"' EXIT INT TERM

(
  cd "$launcher_dir"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 "$go_binary" build \
    -trimpath -ldflags='-s -w' -o "$output_dir/SmartHomeCalc-Windows-x64.exe" .
)

(
  cd "$output_dir"
  sha256sum SmartHomeCalc-Windows-x64.exe > SmartHomeCalc-Windows-x64.exe.sha256
)

echo "Created $output_dir/SmartHomeCalc-Windows-x64.exe"
