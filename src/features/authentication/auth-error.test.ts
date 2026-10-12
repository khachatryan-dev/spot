import { describe, expect, it } from "vitest";

import { authErrorKey } from "./auth-error";

describe("authErrorKey", () => {
  it("maps Better Auth errors to messages people understand", () => {
    expect(authErrorKey({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("invalidCredentials");
    expect(authErrorKey({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe("emailTaken");
    expect(authErrorKey({ code: "FAILED_TO_CREATE_SESSION" })).toBe("accountSuspended");
    expect(authErrorKey({ status: 429 })).toBe("rateLimited");
    expect(authErrorKey({ code: "SOMETHING_ELSE" })).toBe("generic");
    expect(authErrorKey(null)).toBe("generic");
  });
});
