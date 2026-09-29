import { createRoot } from "react-dom/client";
import StudioWebApp from "./app";

export function renderWebApp(): void {
  const root = document.getElementById("kodety-studio-root");
  if (!root) throw new Error("Onun Kodety root element was not found.");
  createRoot(root).render(<StudioWebApp />);
}
