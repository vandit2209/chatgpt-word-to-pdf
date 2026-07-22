# Safari package

The extension uses Safari WebExtension-compatible Manifest V3 APIs and the same source as Chrome.

Run `./scripts/package-safari.sh` from the project root. It always creates:

- `dist/safari-extension/` — load this with Safari's **Add Temporary Extension…** command.
- `dist/chat-archive-safari.zip` — the same temporary-extension package as a zip.

If full Xcode is installed, the script also uses Apple's current `safari-web-extension-packager` (or its older `safari-web-extension-converter` name) to create `dist/safari-xcode/`. Open that project, select a signing team or **Sign to Run Locally**, then build the macOS app target. Change the placeholder bundle identifier in the script before App Store distribution.
