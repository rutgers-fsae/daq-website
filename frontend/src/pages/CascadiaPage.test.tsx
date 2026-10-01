import { fireEvent, render, screen } from "@testing-library/react";
import { CascadiaPage } from "./CascadiaPage";

it("explains unsupported USB access, lists the catalog and filters parameters", () => {
  render(<CascadiaPage />);
  expect(screen.getByText(/Web Serial is unavailable/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Choose USB port & connect" }),
  ).toBeDisabled();
  expect(screen.getByText("129 · Motor torque limit")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(85);
  expect(screen.getAllByRole("button", { name: "Edit" })[0]).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Search parameters" }), {
    target: { value: "gamma" },
  });
  expect(screen.getByText("152 · Gamma adjust")).toBeInTheDocument();
  expect(
    screen.queryByText("129 · Motor torque limit"),
  ).not.toBeInTheDocument();
});
