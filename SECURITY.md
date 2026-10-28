# Security Policy

## Supported versions

Security fixes target the latest stable release. Older releases may not receive
patches.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

<https://github.com/yopomura/yopomura/security/advisories/new>

Do not open a public issue for a vulnerability. Include:

- Yopomura version and platform
- steps to reproduce
- impact and any proof of concept
- whether the issue affects downloaded files, EPUBs, the browser, or the
  downloader worker

## Scope

Yopomura handles local files, untrusted EPUB/HTML content, and arbitrary web
pages in a sandboxed browser view. Security-sensitive areas include:

- Electron preload/IPC boundaries
- EPUB chapter sanitization
- browser navigation and permission handlers
- downloader worker input/output and output paths
- update artifact verification
- profile backup/restore path handling

## Known public-build limitations

- The integrated browser does not support Chrome Web Store extensions.
- Proxy credentials are encrypted with Electron `safeStorage` when available.
- Public releases are currently unsigned unless a release notes page says
  otherwise.
