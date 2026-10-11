export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ envProblems }, { log }] = await Promise.all([import("./lib/server/env"), import("./lib/server/log")]);
  for (const p of envProblems()) log[p.level === "error" ? "error" : "warn"]("env", { message: p.message });
}
