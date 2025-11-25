"use client";

import { AuthProvider } from "../lib/auth-context";

export default function RootAuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
