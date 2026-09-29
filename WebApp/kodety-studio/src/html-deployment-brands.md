# Publishing provider marks

Retrieved from official sources on 2026-09-20. SVG geometry and proportions are preserved in `html-deployment-brand.tsx`; decorative accessibility attributes are added in JSX.

| Mark | Source | Variant |
| --- | --- | --- |
| Cloudflare | [Official Cloudflare product source](https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-cloudflare/src/cloudflare.ts), `CLOUDFLARE_LOGO_URL` | Original geometry rendered white at the user’s explicit request (2026-09-20) |
| GitHub | [Official brand toolkit](https://brand.github.com/foundations/logo), [logo archive](https://brand.github.com/GitHub_Logos.zip) | `GitHub Logos/SVG/GitHub_Invertocat_White.svg` |
| Vercel | [Official brand resources](https://vercel.com/geist/brands), [asset archive](https://k2mkucxia43oc7fa.public.blob.vercel-storage.com/front/press/vercel-assets.zip) | `Vercel/icon/dark/vercel-icon-dark.svg` |
| WordPress | [Official logo page](https://wordpress.org/about/logos/) | Inline W mark from the official site header, preserving its supplied `currentColor` treatment |
| FTP / SFTP | [Keyline Icons](https://github.com/keyline-icons/keyline-icons/blob/main/icons/stroke/server.svg) | Stroke server glyph; MIT notice in `components/ui/KEYLINE-ICONS-LICENSE.txt` |

Brand marks identify their respective publishing integrations and remain the property of their owners. No package dependency or external image request is required at runtime.

Provider marks use 70% opacity while inactive and 100% when selected. Publication fields reuse the Settings compound-surface layout with verified Keyline stroke icons (`key`, `user`, `folder`, `git-branch`, `globe`, `file-text`) from the official repository; no runtime download is required.

Publication selectors use the same Radix primitive as Settings, with a matching compound trigger and custom gray menu, keyboard navigation, selection, disabled options and Keyline indicators.
