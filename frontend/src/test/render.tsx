import type { ReactElement } from "react";
import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import { TooltipProvider } from "../components/ui/tooltip";

export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => <TooltipProvider delayDuration={0}>{children}</TooltipProvider>,
    ...options,
  });
}
