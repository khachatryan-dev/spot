import { PageSkeleton } from "@/components/shared/page-skeleton";

/*
 * Guests are often on slow mobile data, so show the shape of the menu at once.
 * Only here: a loading boundary streams a 200 before the page runs, so pages
 * that answer 404 for authorization (dashboard, admin) must not have one.
 */
export default function Loading() {
  return <PageSkeleton />;
}
