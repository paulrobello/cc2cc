// dashboard/src/components/instance-sidebar/instance-sidebar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { InstanceSidebar } from "./instance-sidebar";
import type { InstanceState } from "@/types/dashboard";

const INSTANCES: Map<string, InstanceState> = new Map([
  [
    "paul@mac:cc2cc/abc",
    {
      instanceId: "paul@mac:cc2cc/abc",
      project: "cc2cc",
      status: "online",
      connectedAt: new Date().toISOString(),
      queueDepth: 3,
    },
  ],
  [
    "alice@srv:api/def",
    {
      instanceId: "alice@srv:api/def",
      project: "api",
      status: "offline",
      connectedAt: new Date().toISOString(),
      queueDepth: 0,
    },
  ],
]);

describe("InstanceSidebar", () => {
  it("renders all instances including offline", () => {
    render(
      <InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText("paul@mac:cc2cc")).toBeInTheDocument();
    expect(screen.getByText("alice@srv:api")).toBeInTheDocument();
  });

  it("shows queue depth badge for instance with queued messages", () => {
    render(
      <InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("calls onSelect with instanceId when clicked", () => {
    const onSelect = jest.fn();
    render(
      <InstanceSidebar instances={INSTANCES} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("paul@mac:cc2cc"));
    expect(onSelect).toHaveBeenCalledWith("paul@mac:cc2cc/abc");
  });

  it("highlights the selected instance", () => {
    render(
      <InstanceSidebar
        instances={INSTANCES}
        selectedId="paul@mac:cc2cc/abc"
        onSelect={() => {}}
      />,
    );
    const item = screen.getByRole("button", { name: /paul@mac:cc2cc/ });
    expect(item).toHaveClass("bg-zinc-800");
  });
});
