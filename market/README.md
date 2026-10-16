# Local Pi market

Put unpacked resources in these directories; Pi Web Settings reads them through `GET /api/market`. The response includes the active root, `plugins`, `skills`, and diagnostics for invalid entries.

```text
market/
├── plugins/
│   └── my-package/
│       ├── package.json
│       └── extensions/...
└── skills/
    └── my-skill/
        ├── SKILL.md
        └── scripts/...
```

- Plugins must be valid local Pi packages with a `package.json`.
- Skills must be directories with a valid `SKILL.md` name and description.
- Open Settings › Plugins or Settings › Skills, then choose Add to see and install the entries.
- ZIP and `.tgz` files are not unpacked automatically.

To keep the market outside this repository or use an intranet shared directory, create `.env.local` in the Pi Web project and restart Pi Web:

```dotenv
PI_WEB_MARKET_DIR=E:\pi-market
```

A Windows UNC share is also supported when the account running Pi Web can read it:

```dotenv
PI_WEB_MARKET_DIR=\\server\share\pi-market
```

If the value contains spaces or `#`, quote it according to Next.js `.env` syntax.

For a one-off start, the same value may be supplied as an environment variable. If it is omitted, Pi Web uses this `market/` directory.
