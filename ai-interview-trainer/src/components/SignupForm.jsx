import { useState } from "react";
import { registerUser } from "../services/api";

export function SignupForm({ onSignupSuccess }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const res = await registerUser(form);
    setLoading(false);

    if (res.ok) {
      setMessage("✅ Signup successful! Redirecting to login...");
      setTimeout(() => {
        onSignupSuccess();
      }, 800);
    } else {
      setMessage(`❌ ${res.message || "Signup failed"}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        name="name"
        value={form.name}
        onChange={handleChange}
        type="text"
        placeholder="Full Name"
        className="w-full p-2 border rounded-md"
      />
      <input
        name="email"
        value={form.email}
        onChange={handleChange}
        type="email"
        placeholder="Email"
        className="w-full p-2 border rounded-md"
      />
      <input
        name="password"
        value={form.password}
        onChange={handleChange}
        type="password"
        placeholder="Password"
        className="w-full p-2 border rounded-md"
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 transition"
      >
        {loading ? "Signing up..." : "Sign Up"}
      </button>

      {message && <p className="text-center text-sm mt-2">{message}</p>}
    </form>
  );
}
