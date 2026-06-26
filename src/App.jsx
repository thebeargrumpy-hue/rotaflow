import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import RotaSystem from "./components/RotaSystem";
import Login from "./components/Login";

export default function App() {
  const [session,  setSession]  = useState(undefined); // undefined = loading
  const [userRole, setUserRole] = useState(null);

  async function loadProfile(session) {
    if (!session) { setUserRole(null); return; }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    setUserRole(profile?.role ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      loadProfile(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      loadProfile(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{
          position: "fixed",
          top: 12,
          right: 16,
          zIndex: 9999,
          padding: "5px 14px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
          letterSpacing: "-0.1px",
        }}
        onMouseEnter={e => e.target.style.background = "rgba(255,255,255,0.22)"}
        onMouseLeave={e => e.target.style.background = "rgba(255,255,255,0.12)"}
      >
        Sign out
      </button>
      <RotaSystem user={session.user} userRole={userRole} />
    </>
  );
}
