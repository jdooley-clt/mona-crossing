# Security policy

## Supported versions

Mona Crossing is a static, client-side browser game. The only supported
version is the `main` branch of this repository and the live GitHub Pages
site it deploys, https://jdooley-clt.github.io/mona-crossing/. Older commits,
other branches, forks and third-party mirrors receive no fixes.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Private Vulnerability
Reporting: https://github.com/jdooley-clt/mona-crossing/security/advisories/new.
Please do not open a public issue or pull request for a security problem.
Include the affected page or file, the browser you used, steps to reproduce
and, if you have one, a proof of concept. Fixes ship through the normal pull
request and Pages deployment flow, and reporters are credited in the advisory
unless they ask not to be.

## Scope

The game is HTML, CSS and ES modules served from GitHub Pages behind a
same-origin Content Security Policy. It makes no network requests after the
page loads and has no backend, accounts, analytics or online leaderboard.
Local storage holds only the best score and the sound preference, and the game
stays playable when storage or audio is denied.

In scope: the published site, `index.html`, `styles.css`, `src/` and `assets/`,
the GitHub Actions workflow and the development dependencies that build and
test the site. Out of scope: GitHub Pages, GitHub Actions and browsers
themselves, which have their own reporting channels.
