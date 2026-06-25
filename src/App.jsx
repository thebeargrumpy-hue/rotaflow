import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import RotaSystem from "./components/RotaSystem";
import Login from "./components/Login";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Still checking session — render nothing to avoid flash
  if (session === undefined) return null;

  if (!session) return <Login />;

  return <RotaSystem user={session.user} />;
}
