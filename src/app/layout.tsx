import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "EPIS+ | Gestão inteligente",
  description: "Controle de EPIs e EPCs",
  icons: { icon: "/epis-plus-icon.png", apple: "/epis-plus-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><AppShell>{children}</AppShell></body></html>;
}
