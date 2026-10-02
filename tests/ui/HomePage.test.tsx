import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomePage } from "@/pages/HomePage";

function renderHomePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("HomePage", () => {
  it("renders page title and search form", () => {
    renderHomePage();
    expect(screen.getByRole("heading", { name: "home.title", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("home.searchLabel")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "home.searchLabel" })).toBeInTheDocument();
  });

  it("search input has visible label and hint", () => {
    renderHomePage();
    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("aria-describedby", "home-search-hint");
    expect(document.querySelector('label[for="home-search-query"]')).toBeInTheDocument();
  });

  it("renders spaces section and links to Browse", () => {
    renderHomePage();
    expect(screen.getByLabelText("home.statsLabel")).toBeInTheDocument();
    const browseLink = screen.getByRole("link", { name: "home.goToBrowse" });
    expect(browseLink).toHaveAttribute("href", "/squadrules");
    expect(screen.getByRole("link", { name: "home.cardBrowseCta" })).toHaveAttribute("href", "/squadrules");
  });
});
