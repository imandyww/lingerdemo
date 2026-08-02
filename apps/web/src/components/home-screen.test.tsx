import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./home-screen";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it("hands an approved voice session to the canonical conversation route", () => {
    render(<HomeScreen />);

    fireEvent.click(screen.getByRole("checkbox", { name: "I’m ready for Linger to listen while the radio is on." }));
    fireEvent.click(screen.getByRole("switch", { name: "Switch voice session on" }));

    expect(window.sessionStorage.getItem("linger:recording-consent")).toBe("true");
    expect(window.sessionStorage.getItem("linger:language")).toBe("en-US");
    expect(window.sessionStorage.getItem("linger:start-requested")).toBe("true");
    expect(push).toHaveBeenCalledWith("/conversation");
  });

  it("does not leave the root route without consent", () => {
    render(<HomeScreen />);

    fireEvent.click(screen.getByRole("switch", { name: "Switch voice session on" }));

    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });
});
