"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Dashboard } from "@/components/Dashboard";
import { ThemeCycle } from "@/components/ui";
import { browserClient, supabaseConfigured } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

export default function Home() {
  if (!supabaseConfigured) {
    return (
      <div className="landing"><div className="lcard">
        <h1>D365 Solution Analyzer</h1>
        <p className="err">Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).</p>
      </div></div>
    );
  }
  return <App />;
}

function App() {
  const [db] = useState(() => browserClient());
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = db.auth.onAuthStateChange((event, s) => { setSession(s); if (event === "PASSWORD_RECOVERY") setRecovering(true); });
    return () => sub.subscription.unsubscribe();
  }, [db]);

  if (!ready) return null;
  if (recovering && session) return <NewPassword db={db} onDone={() => setRecovering(false)} />;
  if (!session) return <Login db={db} />;
  return <Dashboard token={session.access_token} email={session.user.email ?? ""} onSignOut={() => db.auth.signOut()} />;
}

type Db = ReturnType<typeof browserClient>;

function Login({ db }: { db: Db }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const submit = async () => {
    setMsg("");
    if (mode === "reset") {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setMsg(error?.message ?? "If that address has an account, a reset link is on its way."); return;
    }
    const { error } = mode === "up" ? await db.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin } }) : await db.auth.signInWithPassword({ email, password: pw });
    setMsg(error?.message ?? (mode === "up" ? "Check your email to confirm your account, then sign in." : ""));
  };
  return (
    <div className="landing"><form className="lcard" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="row spread"><h1>D365 Solution Analyzer</h1><ThemeCycle /></div>
      <p className="muted">Load Dynamics 365 / Dataverse solutions and patches, find deployment problems, and compare versions.</p>
      <div className="fields">
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode !== "reset" && <label>Password<input type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={mode === "up" ? 8 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
      </div>
      <div className="row">
        <button className="btn" type="submit">{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</button>
        {mode !== "in" && <button className="btn ghost" type="button" onClick={() => setMode("in")}>Back to sign in</button>}
        {mode === "in" && <button className="btn ghost" type="button" onClick={() => setMode("up")}>Sign up</button>}
        {mode === "in" && <button className="btn ghost" type="button" onClick={() => setMode("reset")}>Forgot password</button>}
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="lnote"><span aria-hidden="true">🛡</span><span>Solution packages are unpacked in your browser; only parsed metadata is stored, encrypted, in a workspace only you can read. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></div>
      <div className="lver">v{APP_VERSION}</div>
    </form></div>
  );
}

function NewPassword({ db, onDone }: { db: Db; onDone: () => void }) {
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  return (
    <div className="landing"><form className="lcard" onSubmit={async (e) => { e.preventDefault(); const { error } = await db.auth.updateUser({ password: pw }); if (error) setMsg(error.message); else onDone(); }}>
      <h1>Choose a new password</h1>
      <div className="fields"><label>New password<input type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></label></div>
      <button className="btn" type="submit">Save password</button>
      {msg && <p className="err" role="alert">{msg}</p>}
    </form></div>
  );
}
