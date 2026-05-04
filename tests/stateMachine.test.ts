import { describe, expect, it } from "vitest";
import { canTransition } from "../apps/bot/src/domain/stateMachine.js";

describe("user state machine", () => {
  it("allows the happy path from onboarding to review", () => {
    expect(canTransition("NEW_USER", "ONBOARDING_GOAL")).toBe(true);
    expect(canTransition("ONBOARDING_GOAL", "ONBOARDING_STYLE")).toBe(true);
    expect(canTransition("ONBOARDING_STYLE", "ONBOARDING_FREQUENCY")).toBe(true);
    expect(canTransition("READY", "WAITING_FOR_WEEKLY_INPUT")).toBe(true);
    expect(canTransition("WAITING_FOR_WEEKLY_INPUT", "GENERATING_QUESTIONS")).toBe(true);
    expect(canTransition("GENERATING_QUESTIONS", "WAITING_FOR_ANSWERS")).toBe(true);
    expect(canTransition("WAITING_FOR_ANSWERS", "GENERATING_CHAPTER")).toBe(true);
    expect(canTransition("GENERATING_CHAPTER", "REVIEWING_CHAPTER")).toBe(true);
  });

  it("does not allow jumping from new user to generated chapter", () => {
    expect(canTransition("NEW_USER", "REVIEWING_CHAPTER")).toBe(false);
  });

  it("allows commands to interrupt into ready state", () => {
    expect(canTransition("GENERATING_QUESTIONS", "READY")).toBe(true);
  });
});
