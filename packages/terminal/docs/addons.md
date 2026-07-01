# Addons

Addons are self-contained directories that extend Misul Terminal with any combination of skills, code extensions, and MCP servers. An addon can be just a skill, just an MCP server, just an extension, or any combination of the three.

## Directory structure

```
my-addon/
  addon.json          # manifest (optional)
  skills/             # skill directories, each with a SKILL.md
  SKILL.md            # or a single root-level skill
  extension.ts        # code extension (same format as --extension)
  mcp.json            # MCP server configuration
```

Only one component is required. An addon with just `mcp.json` is a pure MCP server addon. An addon with just `skills/` is a pure skill addon. An addon with all three is a unified addon.

## Manifest

`addon.json` is optional. If omitted, the directory name is used as the addon name.

```json
{
  "name": "my-addon",
  "description": "What this addon does",
  "version": "1.0.0",
  "author": "Your Name",
  "repository": "https://github.com/you/my-addon",
  "license": "MIT"
}
```

## Skills

Skills live in the `skills/` subdirectory. Each skill is a folder containing a `SKILL.md` file, same format as the standalone skills system.

```
my-addon/
  skills/
    code-reviewer/
      SKILL.md
    deploy/
      SKILL.md
```

For a single-skill addon, place `SKILL.md` at the root:

```
my-addon/
  SKILL.md
```

See [Skills](skills.md) for the SKILL.md format.

## Code extensions

A code extension is a TypeScript or JavaScript file that uses the extension API to register tools, commands, hooks, and UI components. Place it at the addon root as `extension.ts`, `index.ts`, `extension.js`, or `index.js`.

```
my-addon/
  extension.ts
```

The extension uses the same API as standalone extensions loaded via `--extension`. See [Extensions](extensions.md) for the full API.

## MCP servers

MCP (Model Context Protocol) servers connect Misul Terminal to external tools and services. Configure them in `mcp.json` at the addon root:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/mydb"
      }
    },
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

### Stdio transport

The default transport. Spawns a child process and communicates over stdin/stdout.

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
  "env": {},
  "cwd": "/optional/working/dir"
}
```

### HTTP transport

Connects to a remote MCP server over HTTP.

```json
{
  "type": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}"
  }
}
```

### Tool naming

MCP tools are exposed to the agent as `mcp__<server-name>__<tool-name>`. For example, a server named `database` with a tool named `query` becomes `mcp__database__query`.

### Environment variables

Environment variable expansion with `${VAR}` and `${VAR:-default}` syntax is supported in `command`, `args`, `env`, `url`, and `headers`.

## Discovery

Addons are discovered from these locations:

1. `~/.misul/agent/addons/` - global addons, available in all projects
2. `.misul/addons/` - project addons, shared via version control
3. `--addon <path>` CLI flag - load an addon from any directory

Each location can contain either a single addon directory or a parent directory with multiple addon subdirectories.

## CLI usage

```bash
# Load a single addon
misul --addon ./my-addon

# Load multiple addons
misul --addon ./my-addon --addon ./another-addon

# Addons in ~/.misul/agent/addons/ and .misul/addons/ are loaded automatically
```

## Addon commands

Addons can be installed, removed, listed, and searched from the CLI:

```bash
# Install from git
misul addon install git:github.com/user/my-addon

# Install from npm
misul addon install npm:@scope/misul-tools

# Install from a local path
misul addon install ./my-local-addon

# Install project-locally (into .misul/addons/)
misul addon install git:github.com/user/my-addon -l

# Remove an installed addon
misul addon remove my-addon

# List installed addons
misul addon list

# Search the addon store
misul addon search python
misul addon search "code review"

# Browse all addons in the store
misul addon store
```

### Install sources

| Source format | Example |
|---|---|
| `git:<url>` | `git:github.com/user/repo` |
| SSH git URL | `git@github.com:user/repo` |
| HTTPS URL | `https://github.com/user/repo` |
| `npm:<spec>` | `npm:@scope/package` |
| Local path | `./my-addon` |

Git sources are cloned with `--depth 1` for speed. npm sources are packed and extracted. Local sources are symlinked (or copied on Windows).

### Addon store

The addon store is a JSON registry of available addons. The default store URL is `https://raw.githubusercontent.com/misul-computing/misul-addon-store/main/registry.json`. Override it in settings:

```json
{
  "addonStoreUrl": "https://your-registry.example.com/addons.json"
}
```

The registry format:

```json
{
  "addons": [
    {
      "name": "python-tools",
      "description": "Python linting and formatting tools",
      "source": "git:github.com/misul-computing/python-tools",
      "tags": ["python", "linting"],
      "homepage": "https://github.com/misul-computing/python-tools",
      "author": "Misul Computing",
      "version": "1.0.0"
    }
  ]
}
```

## Combining components

An addon that combines all three component types:

```
my-full-addon/
  addon.json
  skills/
    helper/
      SKILL.md
  extension.ts
  mcp.json
```

This addon provides a skill (injects procedural prompts), a code extension (registers custom tools and commands), and an MCP server (connects to an external service). All three are loaded together as a single unit.
