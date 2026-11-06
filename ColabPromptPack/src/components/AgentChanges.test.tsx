import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentChanges } from "./AgentChanges";

afterEach(cleanup);

it("shows before/after content and sync status without an Apply approval", () => {
  render(<AgentChanges changes={[{
    proposal: { proposalId: "patch", summary: "Updated Markdown", createdAt: 1, updates: [{ cellPath: "cell_0", relativePath: "Cell 1", previousContent: "Before text", newContent: "After text" }] },
    status: "applied", result: { success: true, results: [{ cellPath: "cell_0", applied: true }] },
  }]} retry={vi.fn()} discard={vi.fn()} />);
  expect(screen.getByText("Synced to Colab")).toBeInTheDocument();
  expect(screen.getByText("Before text")).toBeInTheDocument();
  expect(screen.getByText("After text")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("Synced to Colab")).not.toBeVisible();
  fireEvent.click(screen.getByText("Notebook changes (1)"));
  expect(screen.getByText("Synced to Colab")).toBeVisible();
});

it("offers retry and discard only for failed syncs", () => {
  const retry = vi.fn();
  const discard = vi.fn();
  render(<AgentChanges changes={[{
    proposal: { proposalId: "patch", summary: "Conflict", createdAt: 1, updates: [{ cellPath: "cell_0", newContent: "Agent text" }] },
    status: "conflict", result: { success: false, results: [{ cellPath: "cell_0", applied: false, reason: "base_hash_mismatch" }] },
  }]} retry={retry.mockResolvedValue(undefined)} discard={discard} />);
  expect(screen.getByText(/Both versions have been kept/)).toBeInTheDocument();
  expect(screen.getByText("Notebook changes need attention")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard unsynced edits" }));
  expect(retry).toHaveBeenCalledWith("patch");
  expect(discard).toHaveBeenCalledWith("patch");
});
