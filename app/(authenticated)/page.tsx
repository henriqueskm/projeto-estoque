import { AssistantHome } from "@/components/assistant-home";
import { loadHomeData } from "@/lib/home-data";

export default async function HomePage() {
  const homeResult = await loadHomeData();

  return (
    <AssistantHome
      summary={homeResult.data?.summary ?? null}
      stockError={homeResult.error}
    />
  );
}
