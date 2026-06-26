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
