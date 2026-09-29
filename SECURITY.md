# Security

Do not include tokens, passwords, `.env` files, databases, or customer projects in issues or pull requests.

For vulnerabilities, use **Report a vulnerability / Private vulnerability reporting** in the [Onun Kodety repository](https://github.com/onunbeai/onun-kodety/security) when available. Until an official private reporting channel is available, do not post exploit details in a public issue.

A useful report includes the affected version, minimal reproduction steps, and impact, without real third-party data. The supported code in this repository is the WordPress plugin and shared editor core. Reports about external services should follow their providers' security policies.

Security fixes must preserve WordPress capabilities, nonces, path validation, and isolation between projects. Test with a disposable WordPress installation and temporary credentials.
