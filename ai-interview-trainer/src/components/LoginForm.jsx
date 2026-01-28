// src/components/LoginForm.jsx
import { useState } from "react";
import { loginUser } from "../services/api";

export function LoginForm({ onLoginSuccess }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const res = await loginUser(form);
    setLoading(false);

    if (res.ok) {
      // loginUser may return token inside res.data or at top-level depending on implementation
      const token = res.data?.token ?? res.token ?? res.token ?? null;
      const refreshToken = res.data?.refreshToken ?? res.refreshToken ?? null;
      const user =
        res.data?.data?.user ?? // if API returned { data: { user: ... } }
        res.data?.user ??
        res.user ??
        null;

      if (token) localStorage.setItem("token", token);
      if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
      if (user) localStorage.setItem("user", JSON.stringify(user));

      setMessage("✅ Login successful! Redirecting...");
      setTimeout(() => onLoginSuccess && onLoginSuccess(res), 700);
    } else {
      // show server message if provided
      setMessage(`❌ ${res.message || res.error || "Invalid credentials"}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input name="email" value={form.email} onChange={handleChange} type="email" placeholder="Email" className="w-full p-2 border rounded-md" />
      <input name="password" value={form.password} onChange={handleChange} type="password" placeholder="Password" className="w-full p-2 border rounded-md" />

      <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 transition">
        {loading ? "Logging in..." : "Login"}
      </button>

      {message && <p className="text-center text-sm mt-2">{message}</p>}
    </form>
  );
}
