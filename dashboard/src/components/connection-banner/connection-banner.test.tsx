// dashboard/src/components/connection-banner/connection-banner.test.tsx
import { render, screen } from "@testing-library/react";
import { ConnectionBanner } from "./connection-banner";

describe("ConnectionBanner", () => {
  it("renders green pill when online", () => {
    render(<ConnectionBanner state="online" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("hub online");
    expect(pill).toHaveClass("bg-green-500");
  });

  it("renders yellow pill when reconnecting", () => {
    render(<ConnectionBanner state="reconnecting" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("reconnecting\u2026");
    expect(pill).toHaveClass("bg-yellow-500");
  });

  it("renders red pill when disconnected", () => {
    render(<ConnectionBanner state="disconnected" />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("disconnected");
    expect(pill).toHaveClass("bg-red-500");
  });
});
