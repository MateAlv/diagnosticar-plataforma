// src/app/layout.tsx
import "./globals.css";
import localFont from "next/font/local";
import AuthProvider from "./auth-provider";

// Vendored rather than fetched from Google at build time.
//
// `next/font/google` downloads the families during `next build`, so every
// image build needed fonts.googleapis.com to be reachable — and when it was
// not, the build failed with "Can't resolve
// '@vercel/turbopack-next/internal/font/google/font'", which names a module
// resolution problem rather than the network call that actually failed.
//
// These are the latin subsets of the same three families, variable-weight, so
// one file covers every weight the design uses (90 KB for all three).
const roboto = localFont({
    src: "../../public/fonts/roboto-variable.woff2",
    weight: "100 900",
    display: "swap",
});
const sora = localFont({
    src: "../../public/fonts/sora-variable.woff2",
    weight: "400 800",
    display: "swap",
    variable: "--font-sora",
});
const spaceGrotesk = localFont({
    src: "../../public/fonts/space-grotesk-variable.woff2",
    weight: "300 700",
    display: "swap",
    variable: "--font-space",
});

export const metadata = {
  title: "Diagnostic.ar",
  description: "Plataforma de orientación diagnóstica para EPoFs.",
  icons: {
    icon: "/icon.svg",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body
        id="lucai-app"
        className={`${roboto.className} ${sora.variable} ${spaceGrotesk.variable} theme-medphenai`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
