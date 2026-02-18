# XVM Script Language

VS Code extension for Mad Max XVM script files (`.xvm`) — the scripting language used by the Apex Engine.

## Features

- **Syntax highlighting** for keywords, literals, operators, comments, directives, engine modules
- **IntelliSense** — autocomplete for engine modules and their methods (e.g. `vehicle.`, `scriptgo.`)
- **Hover information** — documentation on hover for modules, methods, keywords, built-ins
- **Signature help** — parameter hints when typing function calls
- **Built-in functions** — `len()`, `float()`, `int()`, `abs()`

## Engine Modules

The extension loads method signatures from a `xvm_globals.txt` file. It searches in this order:

1. Path set in `xvm.globalsPath` setting
2. `<workspace>/xvm_globals.txt`
3. `<workspace>/bin/xvm_globals.txt`
4. Next to the extension directory

Without this file, syntax highlighting still works but IntelliSense for engine modules is disabled.

## Settings

| Setting | Description |
|---------|-------------|
| `xvm.globalsPath` | Absolute path to `xvm_globals.txt`. Leave empty for auto-detection. |

## Install from VSIX

```
code --install-extension xvm-language-x.x.x.vsix
```

Or in VS Code: Extensions > `...` > **Install from VSIX...**

## Build from source

```bash
npm install
npm run compile
npm run package
```
