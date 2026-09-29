# Third-party notices

Onun Kodety's GPL-3.0-only license applies to its original code. Third-party libraries, fonts, icons, and other assets retain their original licenses and attribution.

- **Ycode**: parts of the project were developed from the [open-source repository](https://github.com/ycode/ycode), particularly the editor architecture. Copyright (c) 2026 Ycode. The complete MIT license is preserved in [licenses/YCODE-LICENSE.md](licenses/YCODE-LICENSE.md).
- **Motion**: the editor's animation engine uses the MIT-licensed `motion` core. The complete notice is preserved in [licenses/MOTION-LICENSE.md](licenses/MOTION-LICENSE.md). This edition does not include paid Motion+ features.
- **Solar Icons**: CC-BY-4.0; the React wrapper is MIT-licensed. Attribution is preserved in [Wordpress/kodety/THIRD_PARTY_NOTICES.txt](Wordpress/kodety/THIRD_PARTY_NOTICES.txt).
- **Keyline Icons**: MIT; see [components/ui/KEYLINE-ICONS-LICENSE.txt](components/ui/KEYLINE-ICONS-LICENSE.txt).
- **vanilla-cookieconsent**: MIT; see [lib/html-editor/vendor/vanilla-cookieconsent/LICENSE](lib/html-editor/vendor/vanilla-cookieconsent/LICENSE).
- **Other npm dependencies**: consult each package's `LICENSE` and `package.json` installed by `npm ci`.

## Optional services

The optional browser Agent used by the WordPress editor depends on **WebContainers**. The `@webcontainer/api` client package is MIT-licensed; the hosted runtime has separate terms. Review the [WebContainers terms for your deployment](https://webcontainers.io/enterprise). Visual editing and WordPress publishing do not require enabling the browser Agent.

External services configured by users have their own terms. A client library's license does not grant access to a third-party hosted service.
