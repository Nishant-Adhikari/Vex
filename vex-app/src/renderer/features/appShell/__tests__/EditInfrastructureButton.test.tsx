import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const mockOpenWizard = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { openWizard: typeof mockOpenWizard }) => unknown) =>
    selector({ openWizard: mockOpenWizard }),
}));

const { EditInfrastructureButton } = await import("../EditInfrastructureButton.js");

describe("EditInfrastructureButton", () => {
  it("opens the wizard in reconfigure mode", () => {
    mockOpenWizard.mockReset();
    const { getByRole } = render(<EditInfrastructureButton />);

    fireEvent.click(getByRole("button", { name: /Edit infrastructure/i }));

    expect(mockOpenWizard).toHaveBeenCalledWith("reconfigure");
  });
});
