import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicTermSignature } from "@/components/public-term-signature";

export const metadata: Metadata = {
  title: "Assinatura de ficha | EPIS+",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function TermSignaturePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  return <PublicTermSignature token={token} />;
}
