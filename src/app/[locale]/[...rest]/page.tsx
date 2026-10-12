import { notFound } from "next/navigation";

/** Unknown URLs get the translated 404 (not-found.tsx) inside the app layout. */
export default function CatchAll() {
  notFound();
}
