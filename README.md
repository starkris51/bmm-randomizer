# BMM Randomizer

A Modded version for the desktop version of BMM that gives you a singular page that allows you to randomize content, so you dont need to look up what you want to listen.

# From the fork:

This repository uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Develop

```sh
pnpm i
```

### Website

```sh
pnpm dev
```

### App

```sh
pnpm dev:electron
```

_Note:_ If you had an error in your code and the system still shows you the error but you've already fixed it, consider running `pnpm clean`. If you have this problem often, consider contacting one of the maintainers of the project.

## Build

To build, first install all packages

```sh
pnpm i
```

You may have to install `pnpm` first:

```sh
npm -g i pnpm
```

### Website

```sh
pnpm build
```

### App

```sh
pnpm build:electron
pnpm package:electron
```

_Note:_ Target `package:electron` will by default only build an app for the current platform and current architecture. If you want to go beyond, please visit https://www.electron.build/multi-platform-build.html.

_Note:_ Electron registers a handler for the url-scheme `bmm` on start, which means that after starting the electron-app in dev-mode or a new build, the system will always use this instance for opening links with the scheme `bmm`. This might be desirable while testing. Keep in mind to start your installed version of the bmm-electron app when you're done, so it can re-register as handler of the `bmm` scheme and deep-links will open with the installed version of the app.

## E2E testing

Prepare by having a version of this project running. You may use `pnpm preview` to run the tests against a build locally or `pnpm dev`. The command `pnpm e2e` will start an interactive version of cypress.

You may create the file `cypress.env.json` to set e.g. the username and password used for testing.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + Plugins and configuration provided by `.vscode/extensions.json` and `.vscode/settings.json`

## Type Support For `.vue` Imports in TS

If the standalone TypeScript plugin doesn't feel fast enough to you, Volar has also implemented a [Take Over Mode](https://github.com/johnsoncodehk/volar/discussions/471#discussioncomment-1361669) that is more performant. You can enable it by the following steps:

1. Disable the built-in TypeScript Extension
   1. Run `Extensions: Show Built-in Extensions` from VSCode's command palette
   2. Find `TypeScript and JavaScript Language Features`, right click and select `Disable (Workspace)`
2. Reload the VSCode window by running `Developer: Reload Window` from the command palette.

## Creating a new electron build

1. Bump `version` in `package.json` (e.g. `1.0.5`).
2. Commit, then tag and push: `git tag v1.0.5 && git push origin main --tags`.
3. The [Build electron app](.github/workflows/electron.yml) workflow builds Windows and Linux and uploads them to a draft release `v1.0.5`.
4. Publish the draft on GitHub. The in-app auto-updater only sees published releases.

Builds are unsigned, so Windows SmartScreen shows a warning on first install ("More info" → "Run anyway").

## Credits & license

BMM Randomizer is a modified fork of [bcc-code/bmm-web](https://github.com/bcc-code/bmm-web) by BCC Media STI, maintained by [Kristoffer Bekkevold](https://github.com/starkris51). It is not affiliated with or endorsed by BCC Media.

Licensed under the [GNU AGPL v3](LICENSE), like the original. Modifications © 2026 Kristoffer Bekkevold.
