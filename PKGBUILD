pkgname=yopomura
pkgver=VERSION_REPLACE
pkgrel=1
pkgdesc="A desktop reader for manga, comics and books with a built-in media player, browser and generic downloader."
arch=("x86_64")
url="https://github.com/yopomura/yopomura"
license=("MIT")

depends=()

options=(!strip !debug)

source=("${pkgname}-linux-x64-${pkgver}.zip")
sha256sums=("SKIP")

package() {

  install -dm755 "$pkgdir/usr/lib/$pkgname"
  install -dm755 "$pkgdir/usr/bin"
  install -dm755 "$pkgdir/usr/share/applications"

  # extract electron bundle
  bsdtar -xf "$srcdir/${pkgname}-linux-x64-${pkgver}.zip" \
  --strip-components=1 \
  -C "$pkgdir/usr/lib/$pkgname"

  # launcher
  install -Dm755 /dev/stdin "$pkgdir/usr/bin/$pkgname" <<EOF
#!/bin/bash
exec /usr/lib/$pkgname/yopomura "\$@"
EOF

  # desktop file
  install -Dm644 /dev/stdin "$pkgdir/usr/share/applications/$pkgname.desktop" <<EOF
[Desktop Entry]
Name=Yopomura
Exec=$pkgname
Icon=$pkgname
Type=Application
Categories=Utility;
EOF

}
