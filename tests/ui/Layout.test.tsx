// squadrules-compat-surface: falls back to the existing on-disk config-dir path segment "kairos"
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { Layout } from "@/components/Layout";

function renderLayout(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]} initialIndex={0}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<span>Home content</span>} />
          <Route path="kairos" element={<span>SQUADRULES content</span>} />
          <Route path="account" element={<span>Account content</span>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Layout", () => {
  it("renders skip link to main content", () => {
    renderLayout();
    const skip = screen.getByText("skipToMain");
    expect(skip).toBeInTheDocument();
    expect(skip).toHaveAttribute("href", "#main");
  });

  it("renders sidebar nav and main landmark", () => {
    renderLayout();
    expect(screen.getByRole("complementary", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("main", { hidden: false })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("renders Home, SQUADRULES and Account nav links", () => {
    renderLayout();
    expect(screen.getByRole("link", { name: "nav.home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "nav.kairos" })).toHaveAttribute("href", "/kairos");
    expect(screen.getByRole("link", { name: "nav.account" })).toHaveAttribute("href", "/account");
  });

  it("renders outlet content", () => {
    renderLayout();
    expect(screen.getByText("Home content")).toBeInTheDocument();
  });

  it("sets aria-current on active nav link", () => {
    renderLayout("/");
    const homeLink = screen.getByRole("link", { name: "nav.home" });
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });
});
