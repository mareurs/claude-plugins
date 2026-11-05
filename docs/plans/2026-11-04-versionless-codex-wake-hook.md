# Version-independent Codex wake hook

The profile hook currently names a removable versioned plugin cache. Install a self-contained launcher at the stable profile path `hooks/codescout-wake.mjs`. At each invocation it reads the owning profile's wake configuration, asks `codex plugin list --json` for the enabled installed companion, validates its manifest and profile-local cache path, and executes that version's existing silent `launch` entry point. It never chooses a version by directory ordering or borrows another profile's cache.

An installer merges this hook into the selected profile, removes only previous Codex wake registrations, backs up the previous configuration, preserves unrelated hooks, and supports repeated installation. Hook trust remains managed by Codex.

Implementation sequence:
1. Add subprocess regressions for hook migration, repeated installation, actual stdin/argv forwarding, upgrade/cache removal, selected-version downgrade, profile isolation and real failures.
2. Observe failure before implementing the launcher and installer.
3. Implement the single self-contained entry point, update registration documentation, and run focused and existing wake tests.
4. Install the verified launcher in existing configured Codex profiles; replay the installed foreground hook and inspect its exit/stdout/stderr. Do not create absent profiles or change daemon bindings.
