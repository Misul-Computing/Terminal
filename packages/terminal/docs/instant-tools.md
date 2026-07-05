# Instant Tools

Instant tools are built-in slash commands that run locally without an LLM round-trip. They show compact results directly in chat and are useful for quick inspection, search, and small edits.

All file paths are resolved relative to the current working directory and must stay inside the project. Paths that escape the project directory are rejected.

## `/read <path>`

Read a file and display its contents.

```text
/read src/config.ts
/read README.md
```

The first 200 lines are shown. If the file is longer, the output is truncated with a note.

## `/grep <pattern> [path]`

Search file contents with ripgrep and display matches.

```text
/grep TODO
/grep "class Session" src
/grep "export function" src/core
```

If no path is given, the search runs from the current working directory. The pattern is passed as a literal argument, so it cannot be interpreted as a shell option.

## `/edit <path> "<oldText>" "<newText>"`

Apply a single, unique replacement in a file.

```text
/edit src/config.ts "const version = \"0.6.0\";" "const version = \"0.6.1\";"
```

The old text must appear exactly once in the file. Empty old text is rejected to avoid corrupting the file. The file is rewritten with the same line endings and a trailing newline if the original had one.

## `/todo [text]`

Show the current task list or add a new item.

```text
/todo
/todo review error handling in agent loop
```

The task list is stored in the current session and can be checked by sending the same command without text.
