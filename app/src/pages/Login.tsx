import { useState } from "react";
import { useNavigate } from "react-router-dom";
import CareerOSLogo from "../components/CareerOSLogo";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body = mode === "register"
        ? { email, password, name }
        : { email, password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (mode === "register" ? "Registration failed" : "Login failed"));
      } else {
        navigate("/");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-icon"><CareerOSLogo size={20} fill="var(--primary-foreground)" /></div>
          <div>
            <div className="logo-name">CareerOS</div>
            <div className="logo-sub">Job Feed</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {mode === "register" && (
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                autoFocus
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus={mode === "login"}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? (mode === "register" ? "Creating account…" : "Signing in…")
              : (mode === "register" ? "Create account →" : "Sign in →")}
          </button>
        </form>
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
          {mode === "login" ? (
            <>Don't have an account?{" "}
              <button
                type="button"
                className="login-toggle-btn"
                onClick={() => { setMode("register"); setError(""); }}
              >
                Register
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button
                type="button"
                className="login-toggle-btn"
                onClick={() => { setMode("login"); setError(""); }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
