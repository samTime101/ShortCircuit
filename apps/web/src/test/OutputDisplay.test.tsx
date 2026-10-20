import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { OutputDisplay } from "../components/OutputDisplay";

describe("output displays", () => {
  it("shows the value as a number by default", () => {
    const { container } = render(
      <OutputDisplay mode="number" binary="1010" decimal="10" width={4} />,
    );
    expect(container.querySelector(".binary-value")?.textContent).toBe("1010");
    expect(container.querySelector(".decimal-value")?.textContent).toBe("#10");
  });

  it("draws one led per bit", () => {
    const { container } = render(
      <OutputDisplay mode="led" binary="1010" decimal="10" width={4} />,
    );
    const leds = container.querySelectorAll(".display-leds i");
    expect(leds).toHaveLength(4);
    expect(container.querySelectorAll(".display-leds i.is-on")).toHaveLength(2);
  });

  it("draws a seven-segment digit", () => {
    const { container } = render(
      <OutputDisplay mode="seven" binary="0011" decimal="3" width={4} />,
    );
    const svg = container.querySelector(".display-seven");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("digit 3");
    expect(container.querySelectorAll(".display-seven path.is-on").length).toBe(5);
  });

  it("draws a bar and a grid", () => {
    const bar = render(<OutputDisplay mode="bar" binary="1100" decimal="12" width={4} />);
    expect(bar.container.querySelector(".display-bar i")?.getAttribute("style")).toContain("75%");
    bar.unmount();

    const grid = render(<OutputDisplay mode="grid" binary="11110000" decimal="240" width={8} />);
    expect(grid.container.querySelectorAll(".display-grid i")).toHaveLength(8);
    expect(grid.container.querySelectorAll(".display-grid i.is-on")).toHaveLength(4);
  });
});
