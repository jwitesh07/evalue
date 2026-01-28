// src/components/Navbar.jsx
import React from "react";

export default function Navbar({ currentScreen, setCurrentScreen, user, onLogout }) {
  const isHome = currentScreen === "home";
  const isDashboard = currentScreen === "dashboard";

  return (
    <nav className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-16">
          {/* 🌈 Brand / Logo */}
          <div
            onClick={() => setCurrentScreen("home")}
            className="text-2xl font-extrabold bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text text-transparent cursor-pointer select-none"
          >
            evalue
          </div>

          {/* 🧭 Navigation / User info */}
          <div className="flex items-center gap-4">
            {/* Primary nav tabs */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => setCurrentScreen("home")}
                className={`px-3 py-1.5 text-sm rounded-md border transition-all ${
                  isHome
                    ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                    : "text-gray-600 border-transparent hover:bg-gray-50"
                }`}
              >
                Home
              </button>

              <button
                onClick={() => setCurrentScreen("dashboard")}
                className={`px-3 py-1.5 text-sm rounded-md border transition-all ${
                  isDashboard
                    ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                    : "text-gray-600 border-transparent hover:bg-gray-50"
                }`}
              >
                Dashboard
              </button>
            </div>

            {/* User greeting */}
            {user && (
              <span className="text-gray-600 text-sm hidden md:block">
                Hi,{" "}
                <span className="font-medium text-indigo-600">
                  {user.name}
                </span>
              </span>
            )}

            {/* Logout button */}
            {onLogout && (
              <button
                onClick={onLogout}
                className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
