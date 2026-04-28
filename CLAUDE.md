# Project Overview
Show dependencies and transitive dependencies in a project. It prints a list of all dependencies. It uses
https://pypi.org/ for package metadata and https://pypistats.org/ for download statistics. No other resources are used.

# Documentation
- **README must stay current:** After every implementation update the README to reflect any new flags, behaviour, file formats, or limitations introduced by the change.

# Coding Rules & Behavior
- **Plan first, always:** Before implementing any feature or change, present a concise plan — what will be created or modified and why — and wait for confirmation before writing any code.
- **Mandatory Documentation:** You MUST add a detailed docstring/comment to *every single function* you create. Explain its purpose, arguments, and return values.
- **Explain Your Work:** Before executing code changes, briefly explain the logic of the functions you are about to create in the chat.
- **No Silent Updates:** Do not make sweeping changes to files without telling me what you are modifying first.
- **No dependencies added** Do not add any dependencies for this project. This is a plain javascript project

# Coding Style
- **No mutating input parameters:** Functions must not mutate objects or arrays passed in as arguments (e.g. no accumulator/out parameters). Always return new values instead.
- **Prefer async/await over Promise chains:** Use `async`/`await` syntax instead of `.then()`/`.catch()` for all asynchronous code. Reserve `.catch()` only when attaching a handler to a Promise you are not awaiting inline.

# Testing
- **Every new function must be tested:** Write tests for every new function or module you add.
- **All tests must pass:** Run `npm test` after every implementation and ensure all tests pass before considering the task done.

# Security
- **Security review after every implementation:** After writing new code, review it against the OWASP Top Ten and common Node.js security pitfalls (command injection, path traversal, prototype pollution, insecure deserialization, unvalidated redirects, etc.).
- **Fix findings immediately:** If a security issue is found it must be corrected before the task is considered done. Document the fix briefly in the chat.

# Definition of Done
A task is only complete when ALL of the following have been done in the same response:
1. All tests pass (`npm test`)
2. README updated to reflect the change
3. Security review performed and result reported in chat