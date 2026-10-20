import { useRoute } from "./lib/route";
import { Toaster } from "./lib/ui";
import { EventPage } from "./pages/EventPage";
import { HomePage } from "./pages/HomePage";
import { PeoplePage } from "./pages/PeoplePage";
import { VenuePage } from "./pages/VenuePage";

export function App() {
  const route = useRoute();
  return (
    <>
      {route.page === "home" && <HomePage />}
      {route.page === "people" && <PeoplePage />}
      {route.page === "venue" && <VenuePage key={route.id} id={route.id} />}
      {route.page === "event" && <EventPage key={route.id} id={route.id} tab={route.tab} />}
      <Toaster />
    </>
  );
}
