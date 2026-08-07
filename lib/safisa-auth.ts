import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  listSafisaOrders,
  SafisaPortalAccessError,
} from "@/lib/safisa-portal-data";
import type { SafisaOrderList } from "@/lib/safisa-portal-types";

export type SafisaSession = {
  userId: string;
  displayName: string;
  orderList: SafisaOrderList;
};

export async function requireSafisaSession(): Promise<SafisaSession> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) redirect("/safisa/login");

  let orderList: SafisaOrderList;
  try {
    orderList = await listSafisaOrders(supabase);
  } catch (portalError) {
    if (portalError instanceof SafisaPortalAccessError) {
      redirect("/safisa/login?error=unauthorized");
    }
    throw portalError;
  }

  const metadata = data.user.user_metadata;
  const metadataName =
    typeof metadata?.full_name === "string"
      ? metadata.full_name.trim()
      : typeof metadata?.name === "string"
        ? metadata.name.trim()
        : "";

  return {
    userId: data.user.id,
    displayName: metadataName || "Usuário Safisa",
    orderList,
  };
}
