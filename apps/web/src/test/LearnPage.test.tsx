import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LESSONS } from "@shortcircuit/engine";
import { LearnPage } from "../pages/LearnPage";

describe("learn page", () => {
  it("lists every lesson", () => {
    render(<LearnPage source="" onOpenInStudio={() => {}} />);
    const list = document.querySelector<HTMLElement>(".learn-list")!;
    expect(within(list).getAllByRole("button")).toHaveLength(LESSONS.length);
  });

  it("checks an answer against the lesson checks", async () => {
    const lesson = LESSONS.find((entry) => entry.id === "and")!;
    render(<LearnPage source={lesson.solution} onOpenInStudio={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /the and gate/i }));
    await userEvent.click(screen.getByRole("button", { name: /check my answer/i }));
    expect(screen.getByText(/that works/i)).toBeInTheDocument();
  });

  it("explains a wrong answer", async () => {
    const lesson = LESSONS.find((entry) => entry.id === "and")!;
    render(<LearnPage source={lesson.starter} onOpenInStudio={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /the and gate/i }));
    await userEvent.click(screen.getByRole("button", { name: /check my answer/i }));
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });

  it("opens the starter in the studio", async () => {
    const onOpenInStudio = vi.fn();
    const lesson = LESSONS[0]!;
    render(<LearnPage source="" onOpenInStudio={onOpenInStudio} />);
    await userEvent.click(screen.getByRole("button", { name: /open in studio/i }));
    expect(onOpenInStudio).toHaveBeenCalledWith(lesson.starter);
  });

  it("shows the glossary", async () => {
    render(<LearnPage source="" onOpenInStudio={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /glossary/i }));
    expect(screen.getByText("Signal")).toBeInTheDocument();
    expect(screen.getByText(/named value that carries/)).toBeInTheDocument();
  });
});
