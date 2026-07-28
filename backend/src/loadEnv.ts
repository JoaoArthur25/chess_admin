// Side-effect module: loads .env into process.env.
//
// This lives in its own file and is imported FIRST by the entrypoint because ES
// module imports are hoisted — inlining the call in server.ts would run it only
// after every other import had already been evaluated (and any of them may read
// process.env at module scope).
//
// Node's built-in loader keeps this dependency-free. A missing .env is fine:
// configuration may come from the host environment instead (containers, CI).
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the ambient environment.
}
