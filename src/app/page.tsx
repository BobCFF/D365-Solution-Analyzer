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

  useEffect(() => {
    db.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [db]);

  if (!ready) return null;
  if (!session) return <Login db={db} />;
  return <Dashboard token={session.access_token} email={session.user.email ?? ""} onSignOut={() => db.auth.signOut()} />;
}

function Login({ db }: { db: ReturnType<typeof browserClient> }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const go = async (signUp: boolean) => {
    const { error } = signUp ? await db.auth.signUp({ email, password: pw }) : await db.auth.signInWithPassword({ email, password: pw });
    setMsg(error?.message ?? (signUp ? "Check your email to confirm your account, then sign in." : ""));
  };
  return (
    <div className="landing"><form className="lcard" onSubmit={(e) => { e.preventDefault(); go(false); }}>
      <div className="row spread"><h1>D365 Solution Analyzer</h1><ThemeCycle /></div>
      <p className="muted">Load Dynamics 365 / Dataverse solutions and patches, find deployment problems, and compare versions.</p>
      <div className="row">
        <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn" type="submit">Sign in</button>
        <button className="btn ghost" type="button" onClick={() => go(true)}>Sign up</button>
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="lnote"><span aria-hidden="true">🛡</span><span>Solution packages are unpacked in your browser; only parsed metadata is stored, in a workspace only you can read.</span></div>
      <div className="lver">v{APP_VERSION}</div>
    </form></div>
  );
}
