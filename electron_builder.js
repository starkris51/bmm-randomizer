// @ts-check
// Windows signing only runs when the Azure Key Vault credentials are present.
// Without them the installer is unsigned (SmartScreen will warn on first run).
const canSignWindows = !!process.env.WINDOWS_CLIENT_ID;

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: "com.starkris51.bmm-randomizer",
  productName: "BMM Randomizer",
  copyright:
    "Copyright © 2026 Kristoffer Bekkevold. Based on BMM, © 2024 BCC Media STI.",
  files: [
    { from: ".output/public", to: "dist-electron", filter: ["**/*"] },
    { from: "electron/icons", to: "dist-electron/icons" },
    { from: "dist-electron", to: "dist-electron", filter: ["**/*"] },
    "package.json",
    "!node_modules",
  ],
  directories: {
    output: "dist-app",
  },
  publish: {
    provider: "github",
    owner: "starkris51",
    repo: "bmm-randomizer",
    releaseType: "draft",
  },
  protocols: [{ name: "Custom BMM", schemes: ["bmm"] }],
  mac: {
    category: "public.app-category.music",
    entitlements: "build/entitlements.mac.plist",
    icon: "resources/app.icns",
    hardenedRuntime: true,
    darkModeSupport: true,
    gatekeeperAssess: true,
    target: [
      {
        target: "default",
        arch: "x64",
      },
      { target: "default", arch: "arm64" },
    ],
    notarize: {
      teamId: process.env.APPLE_TEAM_ID || "",
    },
  },
  win: {
    target: ["nsis", "zip"],
    ...(canSignWindows && {
      signingHashAlgorithms: ["sha256"],
      sign: "./electron_sign_exe.js",
      // electron-updater verifies updates against this name, so only set it when signing
      publisherName: "BCC MEDIA STI",
    }),
  },
  linux: {
    category: "Audio;Player",
    desktop: {
      Keywords:
        "audio;bcc;bmm;brunstad;christian;church;edification;faith;media;music;sermon",
      SingleMainWindow: true,
      StartupWMClass: "bmm-randomizer",
      MimeType: "x-scheme-handler/bmm",
    },
    target: ["AppImage", "deb"],
  },
  deb: {
    packageName: "bmm-randomizer",
    // Maintainer is taken from the author in package.json
    depends: ["libnotify4", "libxtst6", "libnss3"],
    recommends: [
      // Most XDG supporting desktop distros will use a trigger installed by this package to automatically register the URI scheme handling.
      // However, the app RUNs without it, and distros are free to provide a different mechanism (or let the user handle it manually).
      // Documentation states: (https://www.debian.org/doc/debian-policy/ch-relationships.html)
      // > This declares a strong, but not absolute, dependency.
      // > The Recommends field should list packages that would be found together with this one in all but unusual installations.
      "desktop-file-utils",
    ],
    packageCategory: "sound",
  },
};

// To debug the auto update on Mac, you can right click on BMM.app and "Show package contents".
// Then open Contents/MacOS/BMM, which starts a terminal window with some logs and the BMM app as well.
// The terminal window should give an error message telling you what went wrong.

module.exports = config;
