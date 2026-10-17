import type { Metadata } from "next";
import { Suspense } from "react";

import { EditProfile } from "@/components/edit-profile";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Edit profile" };

// `params` is request-time data, so it is read inside a Suspense boundary (Cache Components).
async function EditProfileForParams({ params }: Pick<PageProps<"/profiles/[id]">, "params">) {
  const { id } = await params;
  return <EditProfile id={id} />;
}

export default function EditProfilePage({ params }: PageProps<"/profiles/[id]">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <EditProfileForParams params={params} />
      </Suspense>
    </div>
  );
}
