# Uniswap Labs: Front End Interfaces

This repository hosts the web app front-end interface. It is a fork of Uniswap Labs’ interface, trimmed down to the Web App. Uniswap is a protocol for decentralized exchange of Ethereum-based assets.

## Interfaces

- Web: [swap.gno.now](https://swap.gno.now)

## Install & Apps

```bash
git clone git@github.com:nocaeth/uniswap-ui.git
bun install
bun web start
```

For instructions per application or package, see the README published for each application:

- [Web](apps/web/README.md)

## Contributing

For instructions on the best way to contribute, please review our [Contributing guide](CONTRIBUTING.md)!

## 🗂 Directory Structure

| Folder      | Contents                                                                       |
| ----------- | ------------------------------------------------------------------------------ |
| `apps/`     | The home for each standalone application.                                      |
| `config/`   | Shared infrastructure packages and configurations.                             |
| `packages/` | Shared code packages covering UI, shared functionality, and shared utilities.  |
