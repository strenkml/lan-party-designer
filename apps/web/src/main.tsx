import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient } from "./lib/queries";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
