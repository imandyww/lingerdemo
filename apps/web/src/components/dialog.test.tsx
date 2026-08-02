import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("traps keyboard focus and closes with Escape", () => {
    const close = vi.fn();
    render(<main><button>Outside</button><Dialog open title="Review memory" onClose={close}><button>First action</button><button>Last action</button></Dialog></main>);
    const closeButton = screen.getByRole("button", { name: "Close dialog" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last action" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
