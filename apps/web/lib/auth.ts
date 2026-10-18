import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Enums } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type Staff = { id: string; name: string; role: Enums<"app_role"> };

/** The signed-in staff member, or a redirect. Deduplicated per request. */
export const getStaff = cache(async (): Promise<Staff> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id, full_name, role").eq("id", userId).single();
  if (!profile) redirect("/login?error=no-profile");
  return { id: profile.id, name: profile.full_name, role: profile.role };
});

export function canReview(staff: Staff) {
  return staff.role === "analyst" || staff.role === "admin";
}
