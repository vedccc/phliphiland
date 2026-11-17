import { describe, it, expect } from "vitest";
import { isAnswerableReservation } from "../trigger/helpers/reservation-status.js";

describe("isAnswerableReservation", () => {
  it("answers confirmed, checked-in and checked-out guests", () => {
    expect(isAnswerableReservation("confirmed")).toBe(true);
    expect(isAnswerableReservation("checked_in")).toBe(true);
    expect(isAnswerableReservation("checked_out")).toBe(true);
    expect(isAnswerableReservation(" Confirmed ")).toBe(true);
  });

  it("never answers inquiries", () => {
    expect(isAnswerableReservation("inquiry")).toBe(false);
  });

  it("does not answer requests to book, declined, expired or cancelled", () => {
    for (const s of ["reserved", "declined", "expired", "canceled", "cancelled", "closed"]) {
      expect(isAnswerableReservation(s)).toBe(false);
    }
  });

  it("fails closed on a missing or unknown status", () => {
    expect(isAnswerableReservation(undefined)).toBe(false);
    expect(isAnswerableReservation(null)).toBe(false);
    expect(isAnswerableReservation("")).toBe(false);
    expect(isAnswerableReservation("some_new_status")).toBe(false);
  });
});
