import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button, Tooltip } from "./ui";
import { TooltipProvider } from "./ui/tooltip";

describe("Tooltip", () => {
  it("shows its label on hover and keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip label="Remove graph">
          <Button aria-label="Remove graph">Remove</Button>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Remove graph" });
    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Remove graph");

    await user.unhover(trigger);
    trigger.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Remove graph");
  });
});
