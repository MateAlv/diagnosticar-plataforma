// src/app/layout.tsx
import "./globals.css";
import { Roboto, Sora, Space_Grotesk } from "next/font/google";
import AuthProvider from "./auth-provider";

const roboto = Roboto({ subsets: ["latin"], weight: ["400","500","700"], display: "swap" });
const sora   = Sora({   subsets: ["latin"], weight: ["400","600","700","800"], display: "swap", variable: "--font-sora" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400","500","600","700"], display: "swap", variable: "--font-space" });

export const metadata = {
  title: "LUCAI — Chat",
  description: "Login + Chat",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body
        id="lucai-app"
        className={`${roboto.className} ${sora.variable} ${spaceGrotesk.variable}`}
        style={{ background: "#0b0b0b", color: "var(--lu-text)" }}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
