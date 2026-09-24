"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function AdminLogin() {
  const [state, action, pending] = useActionState<{ error?: boolean }, FormData>(login, {});
  return (
    <div className="container section" style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: "2.2rem" }}>Admin</h1>
      <form action={action} className="panel stack">
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" required autoFocus />
        </div>
        {state.error && <p className="notice notice-red">Wrong password (or ADMIN_PASSWORD is not set).</p>}
        <button className="btn btn-primary btn-block" disabled={pending}>
          Sign in
        </button>
      </form>
    </div>
  );
}
