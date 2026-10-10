#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(dirname "$script_dir")
launcher_dir="$script_dir/windows-launcher"
desktop_project="$script_dir/windows-desktop/SmartHomeCalc.Desktop.csproj"
output_dir="$project_root/release"
go_binary=${GO_BINARY:-go}
dotnet_binary=${DOTNET_BINARY:-dotnet}
desktop_publish_dir=$(mktemp -d)

mkdir -p "$output_dir"
git -C "$project_root" archive --format=zip --output="$launcher_dir/payload.zip" HEAD
trap 'rm -f "$launcher_dir/payload.zip" "$launcher_dir/SmartHomeCalc.Desktop.exe"; rm -rf "$desktop_publish_dir"' EXIT INT TERM

"$dotnet_binary" publish "$desktop_project" \
  --configuration Release \
  --runtime win-x64 \
  --self-contained true \
  --output "$desktop_publish_dir"

cp "$desktop_publish_dir/SmartHomeCalc.Desktop.exe" "$launcher_dir/SmartHomeCalc.Desktop.exe"

(
  cd "$launcher_dir"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 "$go_binary" build \
    -trimpath -ldflags='-s -w -H=windowsgui' -o "$output_dir/SmartHomeCalc-Windows-x64.exe" .
)

(
  cd "$output_dir"
  sha256sum SmartHomeCalc-Windows-x64.exe > SmartHomeCalc-Windows-x64.exe.sha256
)

echo "Created $output_dir/SmartHomeCalc-Windows-x64.exe"
