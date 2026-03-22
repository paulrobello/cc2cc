// dashboard/src/components/manual-send-bar/manual-send-bar.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManualSendBar } from "./manual-send-bar";
import type { InstanceState } from "@/types/dashboard";

const mockSendMessage = jest.fn().mockResolvedValue(undefined);
const mockSendBroadcast = jest.fn().mockResolvedValue(undefined);

jest.mock("@/hooks/use-ws", () => ({
  useWs: () => ({
    sendMessage: mockSendMessage,
    sendBroadcast: mockSendBroadcast,
  }),
}));

const INSTANCES: InstanceState[] = [
  {
    instanceId: "paul@mac:cc2cc/abc",
    project: "cc2cc",
    status: "online",
    connectedAt: new Date().toISOString(),
    queueDepth: 0,
  },
];

describe("ManualSendBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockSendBroadcast.mockResolvedValue(undefined);
  });

  it("renders target selector, textarea, and send button", () => {
    render(<ManualSendBar instances={INSTANCES} disabled={false} />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("calls sendBroadcast when target is broadcast", async () => {
    const user = userEvent.setup();
    render(<ManualSendBar instances={INSTANCES} disabled={false} />);

    await user.type(screen.getByRole("textbox"), "Hello Claude");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockSendBroadcast).toHaveBeenCalledWith(
        expect.any(String),
        "Hello Claude",
      );
    });
  });

  it("disables send button when disabled prop is true", () => {
    render(<ManualSendBar instances={INSTANCES} disabled={true} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("clears textarea after successful send", async () => {
    const user = userEvent.setup();
    render(<ManualSendBar instances={INSTANCES} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("calls onError when sendBroadcast throws", async () => {
    const user = userEvent.setup();
    const onError = jest.fn();
    const err = new Error("network error");
    mockSendBroadcast.mockRejectedValueOnce(err);
    render(
      <ManualSendBar instances={INSTANCES} disabled={false} onError={onError} />,
    );
    await user.type(screen.getByRole("textbox"), "Hello");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
  });
});
