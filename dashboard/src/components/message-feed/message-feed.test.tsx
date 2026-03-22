// dashboard/src/components/message-feed/message-feed.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageFeed } from "./message-feed";
import type { FeedMessage } from "@/types/dashboard";
import { MessageType } from "@cc2cc/shared";

function makeMsg(
  overrides: Partial<FeedMessage["message"]> = {},
): FeedMessage {
  return {
    message: {
      messageId: "test-id-1",
      from: "paul@mac:cc2cc/abc",
      to: "alice@srv:api/def",
      type: MessageType.task,
      content: "Do the thing",
      timestamp: new Date().toISOString(),
      ...overrides,
    },
    receivedAt: new Date(),
    isBroadcast: false,
  };
}

describe("MessageFeed", () => {
  it("renders messages", () => {
    const feed = [makeMsg()];
    render(<MessageFeed feed={feed} filterInstanceId={null} />);
    expect(screen.getByText("Do the thing")).toBeInTheDocument();
  });

  it("shows type filter chips", () => {
    render(<MessageFeed feed={[]} filterInstanceId={null} />);
    expect(screen.getByRole("button", { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /task/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /result/i })).toBeInTheDocument();
  });

  it("filters messages by type when chip is clicked", () => {
    const feed = [
      makeMsg({ type: MessageType.task, content: "Task message", messageId: "id-1" }),
      makeMsg({ type: MessageType.result, content: "Result message", messageId: "id-2" }),
    ];
    render(<MessageFeed feed={feed} filterInstanceId={null} />);
    fireEvent.click(screen.getByRole("button", { name: /result/i }));
    expect(screen.getByText("Result message")).toBeInTheDocument();
    expect(screen.queryByText("Task message")).not.toBeInTheDocument();
  });

  it("filters by instance when filterInstanceId is provided", () => {
    const feed = [
      makeMsg({ from: "paul@mac:cc2cc/abc", content: "Paul message", messageId: "id-1" }),
      makeMsg({ from: "alice@srv:api/def", content: "Alice message", messageId: "id-2" }),
    ];
    render(<MessageFeed feed={feed} filterInstanceId="paul@mac:cc2cc/abc" />);
    expect(screen.getByText("Paul message")).toBeInTheDocument();
    expect(screen.queryByText("Alice message")).not.toBeInTheDocument();
  });

  it("applies amber styling for task messages", () => {
    render(<MessageFeed feed={[makeMsg()]} filterInstanceId={null} />);
    const row = screen.getByTestId("message-row-test-id-1");
    expect(row).toHaveClass("border-l-amber-500");
  });
});
