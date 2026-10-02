// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { RunsPage } from "@/pages/RunsPage";
import { useRunSessions } from "@/hooks/useRunSession";
import type { RunSession } from "@/hooks/useRunSession";

const minimalSession: RunSession = {
  id: "uri-a:2024-01-01T00:00:00.000Z",
  adapter_uri: "kairos://adapter/abc",
  started_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  status: "running",
  current_layer: { uri: "kairos://layer/22222222-2222-2222-2222-222222222222", content: "", mimeType: "text/plain" },
  contract: { type: "comment", comment: { min_length: 10 } },
  history: [],
};

const mockRemove = vi.fn();

vi.mock("@/hooks/useRunSession", () => ({
  useRunSessions: vi.fn(),
}));

describe("RunsPage", () => {
  beforeEach(() => {
    mockRemove.mockClear();
    vi.mocked(useRunSessions).mockReturnValue({
      sessions: [],
      remove: mockRemove,
      refresh: vi.fn(),
      upsert: vi.fn(),
    });
  });

  it("shows empty state when no sessions", () => {
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "runs.title" })).toBeInTheDocument();
    expect(screen.getByText("runs.subtitle")).toBeInTheDocument();
    expect(screen.getByText("runs.empty")).toBeInTheDocument();
  });

  it("shows session list when sessions are provided", () => {
    vi.mocked(useRunSessions).mockReturnValue({
      sessions: [minimalSession],
      remove: mockRemove,
      refresh: vi.fn(),
      upsert: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "runs.title" })).toBeInTheDocument();
    expect(screen.getByText("kairos://adapter/abc")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "runs.listLabel" })).toBeInTheDocument();
    const resumeLink = screen.getByRole("link", { name: "runs.resume" });
    expect(resumeLink).toHaveAttribute(
      "href",
      "/protocols/kairos%3A%2F%2Fadapter%2Fabc/run?session=uri-a%3A2024-01-01T00%3A00%3A00.000Z"
    );
    expect(screen.getByRole("button", { name: "runs.remove" })).toBeInTheDocument();
  });

  it("remove button calls remove with session id", () => {
    vi.mocked(useRunSessions).mockReturnValue({
      sessions: [minimalSession],
      remove: mockRemove,
      refresh: vi.fn(),
      upsert: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );
    const removeBtn = screen.getByRole("button", { name: "runs.remove" });
    fireEvent.click(removeBtn);
    expect(mockRemove).toHaveBeenCalledWith(minimalSession.id);
  });
});
