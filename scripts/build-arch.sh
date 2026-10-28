#!/bin/bash
set -e

APP_NAME=yopomura
PRODUCT_NAME=Yopomura
VERSION=$(node -p "require('./package.json').version")
PKGVER=$(echo "$VERSION" | sed 's/-/_/g')

ZIP_FILE="out/make/zip/linux/x64/${PRODUCT_NAME}-linux-x64-${VERSION}.zip"

if [ ! -f "$ZIP_FILE" ]; then
  echo "Error: zip not found: $ZIP_FILE"
  exit 1
fi

echo "Preparing build directory..."
BUILD_DIR="arch-build"
rm -rf "$BUILD_DIR"
mkdir "$BUILD_DIR"

cp PKGBUILD "$BUILD_DIR/"
cp "$ZIP_FILE" "$BUILD_DIR/${APP_NAME}-linux-x64-${PKGVER}.zip"

cd "$BUILD_DIR"

echo "Updating PKGBUILD version..."

sed -i "s/VERSION_REPLACE/${PKGVER}/g" PKGBUILD

echo "Building Arch package with Docker..."

HOST_UID=$(id -u)
HOST_GID=$(id -g)

if ! docker run --rm \
    -v "${PWD}:/build" \
    -e HOST_UID="$HOST_UID" \
    -e HOST_GID="$HOST_GID" \
    archlinux:latest \
    bash -c "
      pacman -Sy --noconfirm base-devel libarchive &&
      useradd -m builder &&
      chown -R builder:builder /build &&
      su builder -c 'cd /build && makepkg -f --noconfirm' &&
      chown -R \$HOST_UID:\$HOST_GID /build
    "; then
  echo "Error: Docker build failed"
  exit 1
fi

mkdir -p ../out/all
MAIN_PKG=$(find . -maxdepth 1 -name "${APP_NAME}-*-x86_64.pkg.tar.*" | head -n1)
# Strip pkgrel (-1) from filename: yopomura-2.23.2_beta.3-1-x86_64 -> yopomura-2.23.2_beta.3-x86_64
NEWNAME=$(basename "$MAIN_PKG" | sed 's/-[0-9]\+-x86_64/-x86_64/')
mv "$MAIN_PKG" "../out/all/${NEWNAME}"

echo "Build complete: out/all/${NEWNAME}"

echo "Generating build metadata JSON..."

ARTIFACT_DIR="../build-artifacts"
mkdir -p "$ARTIFACT_DIR"

OS="linux"
ARCH="x64"
TIMESTAMP=$(date +%s%3N)

JSON_FILE="${ARTIFACT_DIR}/${OS}-${ARCH}-${TIMESTAMP}.json"

cat > "$JSON_FILE" <<EOF
[{
  "platform": "${OS}",
  "arch": "${ARCH}",
  "artifacts": [
      "out/all/${NEWNAME}"
  ]
}]
EOF

echo "Metadata written to ${JSON_FILE}"